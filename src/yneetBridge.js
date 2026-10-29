// Optional link to app.yneet.in (PostgreSQL, Prisma tables "users", "profiles", "subscriptions", "referrals").
// When YNEET_DATABASE_URL is set:
//   • a student's YNeet web subscription also unlocks premium features on WhatsApp (matched by phone)
//   • a plan bought on WhatsApp is written to their YNeet subscription, so app.yneet.in unlocks too
//   • YNeet's own referral rule runs: when a referred student buys MONTHLY, the referrer gets 30 days free
// Without it, WhatsApp plans work on WhatsApp only.
import { randomBytes } from 'node:crypto';

let pool = null;
let impl = null; // tests can swap in a fake
const cache = new Map(); // phone -> { at, value }

export function enabled() { return !!(impl || process.env.YNEET_DATABASE_URL); }
export function setImpl(fake) { impl = fake; cache.clear(); }

async function q(sql, params) {
  if (!pool) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: process.env.YNEET_DATABASE_URL, max: 3, ssl: process.env.YNEET_DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
  }
  return (await pool.query(sql, params)).rows;
}

// Start-up check: proves the link works and shows how many students it can see
export async function check() {
  if (impl || !process.env.YNEET_DATABASE_URL) return null;
  const [r] = await q(`SELECT count(*)::int AS students,
    count(*) FILTER (WHERE coalesce(phone, '') <> '')::int AS "withPhone" FROM users`);
  const [s] = await q(`SELECT count(*)::int AS active FROM subscriptions WHERE status = 'active' AND "endDate" > now()`);
  return { ...r, activeSubscriptions: s.active };
}

const last10 = (phone) => String(phone).replace(/\D/g, '').slice(-10);

// Find the YNeet student for a WhatsApp number, with their class and subscription
export async function lookup(phone) {
  if (impl) return impl.lookup(phone);
  if (!enabled()) return null;
  const hit = cache.get(phone);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.value;
  const p10 = last10(phone);
  const rows = await q(
    `SELECT u.id, u.name, p.class AS "classLevel", s.plan, s.status, s."endDate"
       FROM users u
       LEFT JOIN profiles p ON p."userId" = u.id
       LEFT JOIN subscriptions s ON s."userId" = u.id
      WHERE right(regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g'), 10) = $1
         OR right(regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g'), 10) = $1
      ORDER BY u."createdAt" DESC LIMIT 1`, [p10]);
  const r = rows[0];
  const value = r ? { userId: r.id, name: r.name, classLevel: r.classLevel, active: r.status === 'active' && r.endDate && new Date(r.endDate) > new Date(), endDate: r.endDate, plan: r.plan } : null;
  cache.set(phone, { at: Date.now(), value });
  return value;
}

/** Write a WhatsApp purchase into the student's YNeet subscription. planKey: TRIAL_30D | MONTHLY */
export async function grant({ phone, planKey, start, end, amountPaise, paymentId }) {
  if (impl) return impl.grant({ phone, planKey, start, end, amountPaise, paymentId });
  if (!enabled()) return false;
  cache.delete(phone);
  const student = await lookup(phone);
  cache.delete(phone);
  if (!student) return false;
  await q(
    `INSERT INTO subscriptions (id, "userId", plan, status, "startDate", "endDate", amount, "razorpayPaymentId", "expiryReminderSent", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, false, now(), now())
     ON CONFLICT ("userId") DO UPDATE SET plan = EXCLUDED.plan, status = 'active', "startDate" = EXCLUDED."startDate",
       "endDate" = EXCLUDED."endDate", amount = EXCLUDED.amount, "razorpayPaymentId" = EXCLUDED."razorpayPaymentId",
       "expiryReminderSent" = false, "updatedAt" = now()`,
    ['wa' + randomBytes(10).toString('hex'), student.userId, planKey, start, end, amountPaise, paymentId || null]);
  if (planKey === 'MONTHLY') await referralReward(student.userId).catch((e) => console.warn('[yneet] referral reward failed', e.message));
  return true;
}

// Same rule as app.yneet.in: first MONTHLY purchase by a referred student → referrer gets 30 days free
async function referralReward(userId) {
  const [ref] = await q(`SELECT id, "referrerId" FROM referrals WHERE "referredId" = $1 AND qualified = false`, [userId]);
  if (!ref) return;
  await q(`UPDATE referrals SET qualified = true WHERE id = $1`, [ref.id]);
  const [sub] = await q(`SELECT status, "startDate", "endDate" FROM subscriptions WHERE "userId" = $1`, [ref.referrerId]);
  const active = sub?.status === 'active' && sub.endDate && new Date(sub.endDate) > new Date();
  const start = active ? new Date(sub.endDate) : new Date();
  const end = new Date(start.getTime() + 30 * 86400e3);
  await q(
    `INSERT INTO subscriptions (id, "userId", plan, status, "startDate", "endDate", amount, "expiryReminderSent", "createdAt", "updatedAt")
     VALUES ($1, $2, 'REFERRAL_FREE', 'active', $3, $4, 0, false, now(), now())
     ON CONFLICT ("userId") DO UPDATE SET plan = 'REFERRAL_FREE', status = 'active', "startDate" = $3, "endDate" = $4, amount = 0, "expiryReminderSent" = false, "updatedAt" = now()`,
    ['wa' + randomBytes(10).toString('hex'), ref.referrerId, active ? sub.startDate : start, end]);
  await q(`UPDATE referrals SET "rewardGranted" = true WHERE id = $1`, [ref.id]);
}

// ---- 30-day trial journey (see yneetJourney.js) ----

/** Students on the free 30-day trial who started within the last 34 days. */
export async function trialCandidates() {
  if (impl) return impl.trialCandidates ? impl.trialCandidates() : [];
  if (!enabled()) return [];
  return q(
    `SELECT u.id AS "userId", u.name, coalesce(nullif(u.phone, ''), p.phone) AS phone, p.class AS "classLevel",
            s."startDate", s."endDate"
       FROM subscriptions s
       JOIN users u ON u.id = s."userId"
       LEFT JOIN profiles p ON p."userId" = u.id
      WHERE s.plan = 'TRIAL_30D' AND s."startDate" IS NOT NULL
        AND s."startDate" > now() - interval '34 days'`);
}

/** What a student did since `since`: practice, tests, accuracy, active days, mock scores, weakest chapter. */
export async function trialStats(userId, since) {
  if (impl) return impl.trialStats ? impl.trialStats(userId, since) : null;
  if (!enabled()) return null;
  const [a] = await q(
    `SELECT
       (SELECT count(*)::int FROM practice_stats WHERE "userId" = $1 AND "solvedAt" >= $2) AS practiced,
       (SELECT count(*)::int FROM practice_stats WHERE "userId" = $1 AND "solvedAt" >= $2 AND correct) AS "practiceRight",
       (SELECT count(*)::int FROM attempts WHERE "userId" = $1 AND status = 'submitted' AND "submittedAt" >= $2) AS tests,
       (SELECT count(*)::int FROM attempt_responses r JOIN attempts t ON t.id = r."attemptId"
          WHERE t."userId" = $1 AND t."submittedAt" >= $2 AND r.selected IS NOT NULL) AS answered,
       (SELECT count(*)::int FROM attempt_responses r JOIN attempts t ON t.id = r."attemptId"
          WHERE t."userId" = $1 AND t."submittedAt" >= $2 AND r."isCorrect") AS "answeredRight",
       (SELECT count(DISTINCT d)::int FROM (
          SELECT ("solvedAt" + interval '330 minutes')::date AS d FROM practice_stats WHERE "userId" = $1 AND "solvedAt" >= $2
          UNION SELECT ("submittedAt" + interval '330 minutes')::date FROM attempts WHERE "userId" = $1 AND "submittedAt" >= $2
          UNION SELECT ("createdAt" + interval '330 minutes')::date FROM quiz_results WHERE "userId" = $1 AND "createdAt" >= $2) x) AS "activeDays"`,
    [userId, since]);
  const mocks = await q(
    `SELECT score FROM attempts WHERE "userId" = $1 AND status = 'submitted' AND "submittedAt" >= $2 AND "totalMarks" >= 600
      ORDER BY "submittedAt" ASC`, [userId, since]);
  const [weak] = await q(
    `SELECT qs.chapter, sum(m.count)::int AS n FROM mistakes m JOIN questions qs ON qs.id = m."questionId"
      WHERE m."userId" = $1 AND m."lastSeen" >= $2 AND coalesce(qs.chapter, '') <> ''
      GROUP BY qs.chapter ORDER BY n DESC LIMIT 1`, [userId, since]);
  const solved = a.practiced + a.answered;
  const right = a.practiceRight + a.answeredRight;
  return {
    solved, tests: a.tests, activeDays: a.activeDays,
    accuracy: solved ? Math.round((right / solved) * 100) : null,
    firstMock: mocks.length ? mocks[0].score : null,
    latestMock: mocks.length > 1 ? mocks[mocks.length - 1].score : null,
    weakChapter: weak?.chapter || null,
  };
}
