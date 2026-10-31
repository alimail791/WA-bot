// TestMandi account lifecycle on WhatsApp, read from testmandi.in's own users collection:
//   welcome   new account (created after this feature went live), within 3 days of signup
//   verify    once, ≥1 hour after the first login, if the email isn't verified or the phone isn't confirmed
//   refer     refer & earn reminder for active users: first 3 days after signup, then every 30 days, at most 3
//   missyou   lastActiveAt older than 5 days: once per absence (and only for absences under 30 days)
// Inside WhatsApp's 24-hour window it's a free message; outside it, the approved template named in
// TEMPLATE_TM_<KIND> (see README). No template set → nothing is sent and it's retried next run.
// Runs every 30 min between 10:00 and 20:00 IST. Each message is sent once (kv key tm-life:<userId>:<kind>).
import { db, otherDb } from './store.js';
import { send } from './providers/index.js';
import { within24h } from './engine.js';
import { DAY, HOUR } from './util.js';

const SITE = () => process.env.TESTMANDI_SITE_URL || 'https://testmandi.in';
const tmDbName = () => process.env.TESTMANDI_DB || 'testmandi';
export const enabled = () => process.env.TESTMANDI_SYNC === 'true' && process.env.TM_LIFECYCLE !== 'off';
const INACTIVE_DAYS = () => Number(process.env.INACTIVITY_DAYS || 5);
const MAX_PER_RUN = () => Number(process.env.TM_LIFECYCLE_MAX_PER_RUN || 50);

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
export const waPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? '91' + ten : null;
};
const ms = (v) => (v == null ? null : typeof v === 'number' ? v : new Date(v).getTime());

export function referReward(role) {
  if (role === 'seller') return '₹200 for every teacher who publishes a first test or student who makes a first purchase';
  if (role === 'advertiser') return 'your next ad free (up to 7 days) when a business you refer posts its first ad';
  return '50% off your next test when a friend you invite makes a first purchase';
}

// Which messages are due for this user right now, in send order.
export function dueKinds(u, now, launchedAt, done) {
  const created = ms(u.createdAt) || 0;
  const active = ms(u.lastActiveAt);
  const firstLogin = ms(u.firstLoginAt) || (active && active > created + 60_000 ? active : null);
  const out = [];
  if (!done.has('welcome') && created >= launchedAt && now - created < 3 * DAY) out.push('welcome');
  const needsVerify = u.emailVerified === false || !u.phoneVerified;
  if (!done.has('verify') && needsVerify && created >= launchedAt && firstLogin && now - firstLogin >= HOUR && now - created < 14 * DAY
    && (done.has('welcome') || out.includes('welcome') === false)) out.push('verify');
  if (active && now - active >= INACTIVE_DAYS() * DAY && now - active < 30 * DAY && !done.has(`missyou:${active}`)) out.push(`missyou:${active}`);
  const refers = [1, 2, 3].filter((i) => done.has(`refer${i}`));
  const lastRefer = done.lastRefer || 0;
  const activeRecently = active && now - active < INACTIVE_DAYS() * DAY;
  if (refers.length < 3 && u.referralCode && activeRecently && now - created >= 3 * DAY && now - lastRefer >= 30 * DAY) out.push(`refer${refers.length + 1}`);
  // One message per user per run; welcome/verify first, never two marketing messages back to back.
  return out.slice(0, 1);
}

export function compose(kind, u, now = Date.now()) {
  const n = first(u.name);
  const site = SITE();
  const k = kind.replace(/\d+$/, '').split(':')[0];
  switch (k) {
    case 'welcome': {
      const role = u.role === 'seller'
        ? `Next steps:\n1. Add your UPI or bank details for payouts\n2. Click + Create test (upload a CSV, generate with AI or scan a paper)\n3. Publish and share the link. You keep 80% of every sale.`
        : u.role === 'advertiser'
          ? `Open Ads Studio, write your ad, pick the homepage or an exam page and the days. It goes live as soon as you pay.`
          : `Start with a free practice test. You get your score, rank, topic-wise analysis and every explanation straight away.`;
      return { text: `Hi ${n}, welcome to TestMandi! 🎉\n\n${role}\n\nYou can also buy and take tests right here on WhatsApp. Reply STOP to stop these messages.`, url: site, label: 'Open TestMandi', params: [n], buttons: ['tm:browse'] };
    }
    case 'verify': {
      const email = u.emailVerified === false;
      const phone = !u.phoneVerified;
      const lines = [];
      if (email) lines.push(`📧 Verify your email: log in at ${site} and enter the code we emailed you (or tap "Resend code").`);
      if (phone) lines.push('📱 Is this WhatsApp number yours? Tap "Yes, it\'s me" to confirm it for order and test updates.');
      return {
        text: `Hi ${n}, one step left to finish your TestMandi account:\n\n${lines.join('\n\n')}`,
        params: [n], buttons: phone ? ['tm:phoneok'] : [], phoneButton: phone, email,
        tpl: email ? 'TEMPLATE_TM_VERIFY_EMAIL' : 'TEMPLATE_TM_VERIFY_PHONE',
      };
    }
    case 'refer': {
      const reward = referReward(u.role);
      const link = `${site}/?ref=${encodeURIComponent(u.referralCode)}`;
      return { text: `🎁 ${n}, invite friends to TestMandi and earn.\n\nShare your code ${u.referralCode} and get ${reward}.\n\nYour link: ${link}`, url: link, label: 'Share my link', params: [n, u.referralCode, reward], buttons: ['tm:refer'] };
    }
    case 'missyou': {
      const days = Math.max(INACTIVE_DAYS(), Math.floor((now - ms(u.lastActiveAt)) / DAY));
      const role = u.role === 'seller' ? 'Students are browsing tests every day. Publish a new test or run a coupon to get more sales.'
        : u.role === 'advertiser' ? 'Students are preparing right now. Put your ad back on the homepage or an exam page.'
          : 'New tests are added every week. One 20-minute chapter test today keeps your preparation on track.';
      return { text: `We miss you, ${n}! 👋 It's been ${days} days since your last visit to TestMandi.\n\n${role}`, url: site, label: 'Back to TestMandi', params: [n, String(days)], buttons: ['tm:browse'] };
    }
    default: return null;
  }
}

const TEMPLATE_ENV = { welcome: 'TEMPLATE_TM_WELCOME', refer: 'TEMPLATE_TM_REFER', missyou: 'TEMPLATE_TM_MISS_YOU' };

async function launchTime(now) {
  if (process.env.TM_LIFECYCLE_SINCE) return ms(process.env.TM_LIFECYCLE_SINCE);
  const k = await db.kv.findOne({ key: 'tm-life:launched' });
  if (k) return ms(k.at);
  await db.kv.insertOne({ key: 'tm-life:launched', at: new Date(now) });
  return now;
}

async function doneFor(userId, active) {
  const keys = ['welcome', 'verify', 'refer1', 'refer2', 'refer3', ...(active ? [`missyou:${active}`] : [])];
  const done = new Set();
  let lastRefer = 0;
  for (const k of keys) {
    const r = await db.kv.findOne({ key: `tm-life:${userId}:${k}` });
    if (r) { done.add(k); if (k.startsWith('refer')) lastRefer = Math.max(lastRefer, ms(r.at)); }
  }
  done.lastRefer = lastRefer;
  return done;
}

// Send one lifecycle message. Returns 'sent' | 'waiting' (no template yet) | 'failed' | 'skipped'.
async function deliver(kind, u, phone, now) {
  const m = compose(kind, u, now);
  const base = kind.replace(/\d+$/, '').split(':')[0];
  const botUser = await db.users.findOne({ product: 'testmandi', phone });
  if (botUser?.optedOut) return 'skipped';
  const tpl = process.env[m.tpl || TEMPLATE_ENV[base]];
  let res;
  try {
    if (botUser && within24h(botUser)) {
      res = m.phoneButton
        ? await send('testmandi', phone, { type: 'buttons', text: m.text, buttons: [{ id: 'tm:phoneok', title: "Yes, it's me" }, { id: 'tm:phoneno', title: 'Not my number' }] })
        : m.url ? await send('testmandi', phone, { type: 'link', text: m.text, url: m.url, label: m.label })
          : await send('testmandi', phone, { type: 'text', text: m.text });
    } else if (tpl) {
      res = await send('testmandi', phone, { type: 'template', name: tpl, params: m.params, buttons: m.buttons, direct: true });
    } else return 'waiting';
  } catch (e) { res = { ok: false, status: 'error', body: e.message }; }
  if (res && res.ok === false) { console.warn('[tm-life] send failed', kind, phone, res.status, String(res.body || '').slice(0, 200)); return 'failed'; }
  // Replies to the template's buttons should land in TestMandi on the shared number
  await db.sessions.updateOne({ product: '_shared', phone }, { $set: { pick: 'testmandi' } }, { upsert: true });
  return 'sent';
}

export async function tmLifecycle(now = Date.now(), { source } = {}) {
  if (!source && !enabled()) return { sent: 0, waiting: 0 };
  const hourIST = new Date(now + 5.5 * HOUR).getUTCHours();
  if (!source && (hourIST < 10 || hourIST >= 20)) return { sent: 0, waiting: 0, quiet: true };
  const launchedAt = await launchTime(now);
  const users = source || await otherDb(tmDbName())?.collection('users')
    .find({ role: { $in: ['buyer', 'seller', 'advertiser'] }, phone: { $nin: [null, ''] }, waLifecycleOptOut: { $ne: true } })
    .project({ id: 1, role: 1, name: 1, phone: 1, emailVerified: 1, phoneVerified: 1, createdAt: 1, firstLoginAt: 1, lastActiveAt: 1, referralCode: 1 })
    .toArray() || [];
  let sent = 0, waiting = 0, failed = 0;
  for (const u of users) {
    if (sent >= MAX_PER_RUN()) break;
    const phone = waPhone(u.phone);
    if (!phone || !u.id) continue;
    const done = await doneFor(u.id, ms(u.lastActiveAt));
    const [kind] = dueKinds(u, now, launchedAt, done);
    if (!kind) continue;
    const r = await deliver(kind, u, phone, now);
    if (r === 'waiting') { waiting++; continue; }
    if (r === 'failed') { failed++; continue; }
    await db.kv.insertOne({ key: `tm-life:${u.id}:${kind}`, at: new Date(now), ...(r === 'skipped' ? { skipped: 'opted-out' } : {}) });
    if (r === 'sent') {
      await db.events.insertOne({ product: 'testmandi', phone, type: 'tm_lifecycle', kind: kind.split(':')[0], at: new Date(now) });
      sent++;
    }
  }
  return { sent, waiting, failed };
}

// "Yes, it's me" on the verify message: mark the phone confirmed on testmandi.in.
export async function confirmPhone(phone, yes = true) {
  const tm = otherDb(tmDbName());
  if (!tm) return 0;
  const ten = String(phone).replace(/\D/g, '').slice(-10);
  const variants = [ten, '91' + ten, '+91' + ten, '+91 ' + ten, '0' + ten];
  const r = await tm.collection('users').updateMany({ phone: { $in: variants } },
    yes ? { $set: { phoneVerified: true, phoneVerifiedAt: Date.now() } } : { $set: { phoneVerified: false, waLifecycleOptOut: true, phoneWrongReportedAt: Date.now() } });
  return r.modifiedCount;
}

// Start-up log: how many TestMandi users would get each message right now (nothing is sent).
export async function previewLifecycle(now = Date.now()) {
  if (!enabled()) return null;
  const tm = otherDb(tmDbName());
  if (!tm) return null;
  const users = await tm.collection('users').find({ role: { $in: ['buyer', 'seller', 'advertiser'] } })
    .project({ id: 1, role: 1, phone: 1, emailVerified: 1, phoneVerified: 1, createdAt: 1, firstLoginAt: 1, lastActiveAt: 1, referralCode: 1 }).toArray();
  const launchedAt = await launchTime(now);
  const due = {};
  let withPhone = 0;
  for (const u of users) {
    if (!waPhone(u.phone)) continue;
    withPhone++;
    const [kind] = dueKinds(u, now, launchedAt, await doneFor(u.id, ms(u.lastActiveAt)));
    if (kind) { const k = kind.replace(/\d+$/, '').split(':')[0]; due[k] = (due[k] || 0) + 1; }
  }
  const templates = Object.fromEntries(['TEMPLATE_TM_WELCOME', 'TEMPLATE_TM_VERIFY_EMAIL', 'TEMPLATE_TM_VERIFY_PHONE', 'TEMPLATE_TM_REFER', 'TEMPLATE_TM_MISS_YOU'].map((t) => [t, !!process.env[t]]));
  return { users: users.length, withPhone, due, templates };
}
