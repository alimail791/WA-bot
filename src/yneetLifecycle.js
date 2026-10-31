// YNeet lifecycle WhatsApp messages, from real activity in app.yneet.in:
//   welcome   right after sign-up (checked every 10 minutes, 8 AM–9:30 PM IST)
//   verify    20 h–3 days after sign-up, still unverified (Class 9+ on the trial)
//   parent    2+ days after sign-up, no parent email saved yet
//   refer     10+ days after sign-up and actually using YNeet (a test or 20+ questions)
//   missyou   no activity for 5+ days (again only after a new 5-day break, max once in 21 days)
// One lifecycle message per student per day, and none on a day the trial journey
// (yneetJourney.js) already messaged them. Each kind is sent once (kv yneet-life:<user>:<kind>).
// Inside WhatsApp's 24-hour window: a free message with a button. Outside it: the
// approved template in TEMPLATE_YNEET_<KIND>; no template set → nothing is sent.
import { db } from './store.js';
import { send } from './providers/index.js';
import { within24h } from './engine.js';
import * as yneet from './yneetBridge.js';
import { DAY, HOUR } from './util.js';

const APP = () => process.env.YNEET_APP_URL || 'https://app.yneet.in';
const SITE = () => process.env.YNEET_SITE_URL || 'https://www.yneet.in';
const JUNIOR = ['6th', '7th', '8th'];
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const waPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? '91' + d : null; };
const istDay = (t = Date.now()) => new Date(t + 5.5 * HOUR).toISOString().slice(0, 10);
const istStartOfDay = (t = Date.now()) => new Date(Date.parse(istDay(t) + 'T00:00:00Z') - 5.5 * HOUR);

export function compose(kind, c) {
  const n = first(c.name);
  const junior = JUNIOR.includes(c.classLevel);
  switch (kind) {
    case 'welcome': return {
      text: junior
        ? `Hi ${n}, welcome to YNeet! 🎉\n\nYNeet is free for Class 6–8: daily science puzzles, a short daily quiz from your syllabus and 3-minute concept videos.\n\nAny doubt, just reply here.`
        : `Hi ${n}, welcome to YNeet! 🎉\n\nYour 30 days of full access are on, free. Best way to start: take one 20-minute chapter test today and see your weak chapters.\n\nAny doubt about NEET or the app, just reply here.`,
      url: APP(), label: 'Open YNeet', params: [n],
    };
    case 'verify': return {
      text: `Hi ${n}, please confirm your WhatsApp number or email on YNeet. It takes 30 seconds and keeps your free trial running.`,
      url: `${APP()}/verify`, label: 'Confirm now', params: [n],
    };
    case 'parent': return {
      text: `Hi ${n}, add your parent's WhatsApp number or email in YNeet (Profile → Parent updates). They'll get a short weekly report of your tests and progress.`,
      url: `${APP()}/profile#parent-updates`, label: 'Add parent', params: [n],
    };
    case 'refer': {
      const link = `${SITE()}/register?ref=${c.referralCode}`;
      return {
        text: `Hi ${n}, enjoying YNeet? Share it with your NEET friends 🙌\n\nWhen a friend joins with your link and takes a plan, you get 1 month of YNeet free.\n\nYour link: ${link}`,
        url: `${APP()}/referral`, label: 'See my referrals', params: [n, link],
      };
    }
    case 'missyou': {
      const days = Math.max(5, Math.floor((Date.now() - new Date(c.lastActive || c.createdAt).getTime()) / DAY));
      return {
        text: `Hi ${n}, we miss you on YNeet! It's been ${days} days since your last practice. A 20-minute chapter test today keeps your NEET prep on track. 💪`,
        url: APP(), label: 'Practise now', params: [n, String(days)],
      };
    }
    default: return null;
  }
}

// Which lifecycle message (if any) this student is due, by priority.
export function dueKind(c, now = Date.now()) {
  const age = now - new Date(c.createdAt).getTime();
  const junior = JUNIOR.includes(c.classLevel);
  const onTrial = ['TRIAL_30D', 'NONE', null, undefined].includes(c.plan);
  const active = c.lastActive ? now - new Date(c.lastActive).getTime() : null;
  const due = [];
  if (c.isVerified === false && !junior && onTrial && age >= 20 * HOUR && age < 3 * DAY) due.push('verify');
  if (!c.parentEmail && age >= 2 * DAY) due.push('parent');
  if (c.referralCode && !junior && age >= 10 * DAY && (c.tests > 0 || c.practiced >= 20)) due.push('refer');
  const idleFor = active ?? age;
  if (age >= 5 * DAY && idleFor >= 5 * DAY && idleFor < 45 * DAY) due.push('missyou');
  return due;
}

async function deliver(kind, c, phone, now) {
  const u = await db.users.findOne({ product: 'yneet', phone });
  if (u?.optedOut) return 'opted-out';
  const m = compose(kind, c);
  const tpl = process.env[`TEMPLATE_YNEET_${kind.toUpperCase()}`];
  let res;
  try {
    if (u && within24h(u)) res = await send('yneet', phone, { type: 'link', text: m.text, url: m.url, label: m.label });
    else if (tpl) res = await send('yneet', phone, { type: 'template', name: tpl, params: m.params, direct: true });
    else return 'no-template';
  } catch (e) { res = { ok: false, status: 'error', body: e.message }; }
  if (res && res.ok === false) { console.warn('[yneet-life] send failed', kind, phone, res.status, String(res.body || '').slice(0, 200)); return 'failed'; }
  await db.events.insertOne({ product: 'yneet', phone, type: 'lifecycle', kind, at: new Date(now) });
  return 'sent';
}

const messagedToday = async (phone, now) =>
  (await db.events.count({ product: 'yneet', phone, type: { $in: ['lifecycle', 'trial_nudge'] }, at: { $gte: istStartOfDay(now) } })) > 0;

/** Welcome: every 10 minutes during the day; night sign-ups are welcomed next morning. */
export async function welcomeTick(now = Date.now()) {
  if (!yneet.enabled()) return { sent: 0 };
  const h = new Date(now + 5.5 * HOUR).getUTCHours() + new Date(now + 5.5 * HOUR).getUTCMinutes() / 60;
  if (h < 8 || h > 21.5) return { sent: 0, quiet: true };
  let sent = 0;
  for (const c of await yneet.newStudents(36)) {
    if (now - new Date(c.createdAt).getTime() < 5 * 60e3) continue; // let them finish signing in first
    const phone = waPhone(c.phone);
    const key = `yneet-life:${c.userId}:welcome`;
    if (!phone || await db.kv.findOne({ key })) continue;
    const r = await deliver('welcome', c, phone, now);
    if (r === 'no-template' || r === 'failed') continue; // retry next tick
    await db.kv.insertOne({ key, at: new Date(now), result: r });
    if (r === 'sent') sent++;
  }
  return { sent };
}

/** Verify / parent / refer / miss-you: once a day, at most one per student. */
export async function lifecycleDaily(now = Date.now()) {
  if (!yneet.enabled()) return { sent: 0 };
  let sent = 0;
  const counts = {};
  for (const c of await yneet.lifecycleStudents()) {
    const phone = waPhone(c.phone);
    if (!phone) continue;
    for (const kind of dueKind(c, now)) {
      // miss-you can repeat after a NEW break: key it on the last activity day; plus a 21-day gap
      const key = kind === 'missyou' ? `yneet-life:${c.userId}:missyou:${istDay(new Date(c.lastActive || c.createdAt).getTime())}` : `yneet-life:${c.userId}:${kind}`;
      if (await db.kv.findOne({ key })) continue;
      if (kind === 'missyou' && await db.events.count({ product: 'yneet', phone, type: 'lifecycle', kind: 'missyou', at: { $gte: new Date(now - 21 * DAY) } })) continue;
      if (await messagedToday(phone, now)) break;
      const r = await deliver(kind, c, phone, now);
      if (r === 'no-template' || r === 'failed') continue; // try the next kind; this one again tomorrow
      await db.kv.insertOne({ key, at: new Date(now), result: r });
      if (r === 'sent') { sent++; counts[kind] = (counts[kind] || 0) + 1; }
      break; // one per student per day
    }
  }
  return { sent, counts };
}

/** Start-up log: how many students each message is due for today (nothing is sent). */
export async function previewLifecycle(now = Date.now()) {
  if (!yneet.enabled()) return null;
  const list = await yneet.lifecycleStudents();
  const due = {};
  for (const c of list) for (const k of dueKind(c, now)) due[k] = (due[k] || 0) + 1;
  return { students: list.length, withPhone: list.filter((c) => waPhone(c.phone)).length, due, newLast36h: (await yneet.newStudents(36)).length };
}
