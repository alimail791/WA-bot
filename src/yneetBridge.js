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

/** Write a WhatsApp purchase into the student's YNeet subscription. planKey: TRIAL_5D | MONTHLY */
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
