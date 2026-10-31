// ClassCoach teacher journey on WhatsApp. Every 30 minutes (9 AM–9 PM IST) each classcoach.in teacher
// with a phone gets at most one of these, chosen from their real account data:
//   welcome  first 3 days after signing up (once)
//   verify   from 20 hours after signup, within 14 days, if the phone or email isn't verified (once);
//            tapping "Verify my number" (or sending VERIFY) marks the phone verified on classcoach.in
//   miss     5–30 days since their last visit (once per absence)
//   refer    active in the last 3 days and signed up 7+ days ago (at most once a month)
// At most one journey message per teacher per day. Inside WhatsApp's 24-hour window it's a free
// message with a button; outside it, the approved template in TEMPLATE_CC_<STAGE> (see README).
// No template set → that stage waits. STOP opts a teacher out of all of them.
import { db } from './store.js';
import { send } from './providers/index.js';
import { within24h } from './engine.js';
import * as cc from './classcoachBridge.js';
import { DAY } from './util.js';

const SITE = () => (process.env.CLASSCOACH_SITE_URL || 'https://www.classcoach.in').replace(/\/$/, '');
const HOUR = 60 * 60 * 1000;
const TEMPLATE_ENV = { welcome: 'TEMPLATE_CC_WELCOME', verify: 'TEMPLATE_CC_VERIFY', miss: 'TEMPLATE_CC_MISS_YOU', refer: 'TEMPLATE_CC_REFER' };

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const waPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '91' + d : null; };
const ms = (iso) => { if (!iso) return null; const s = String(iso); const t = new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z').getTime(); return Number.isFinite(t) ? t : null; };
const istDay = (t) => new Date(t + 5.5 * HOUR).toISOString().slice(0, 10);

// Which stage (and its once-only key) applies to this teacher now, or null.
export function stageFor(t, now = Date.now()) {
  const created = ms(t.createdAt);
  if (!created) return null;
  const age = now - created;
  const lastSeen = ms(t.lastActiveAt) || created;
  const idle = now - lastSeen;
  const out = [];
  if (age < 3 * DAY) out.push({ stage: 'welcome', key: 'welcome' });
  if (age >= 20 * HOUR && age < 14 * DAY && (!t.phoneVerified || !t.emailVerified)) out.push({ stage: 'verify', key: 'verify' });
  if (idle >= 5 * DAY && idle < 30 * DAY) out.push({ stage: 'miss', key: `miss:${istDay(lastSeen)}` });
  if (age >= 7 * DAY && idle < 3 * DAY && t.referralUrl) out.push({ stage: 'refer', key: `refer:${istDay(now).slice(0, 7)}` });
  return out; // in priority order; the runner sends the first one not already sent
}

function rewardLine(t) {
  return t.kind === 'teacher'
    ? 'For every 2 teachers who buy a plan through your link, you get 2 months free.'
    : 'For every teacher or institute that buys a plan through your link, your institute gets 40% off its next plan.';
}

// Free (in-window) message, and the template params in README order.
export function compose(stage, t, now = Date.now()) {
  const n = first(t.name);
  const site = SITE();
  switch (stage) {
    case 'welcome': return {
      text: `Welcome to ClassCoach, ${n}! 🎉\n\nYour free trial is active. Get started in 3 steps:\n1️⃣ Create your class\n2️⃣ Make your first test with AI in 1 minute\n3️⃣ Share the class code with your students\n\nResults are graded automatically, and parents can get reports on WhatsApp.\n\nNeed help? Just reply to this message.`,
      url: `${site}/dashboard`, label: 'Open ClassCoach', params: [n],
    };
    case 'verify': {
      const email = t.emailVerified ? 'Your email is already verified.' : 'Please also verify your email in Settings on classcoach.in.';
      return {
        text: `Hi ${n}, please confirm this is your WhatsApp number for ClassCoach.\n\nTap "Verify my number" below. We'll use it only for class results and important account alerts.\n\n${email}`,
        button: { id: 'cc:verify', title: 'Verify my number' }, params: [n, email],
      };
    }
    case 'miss': {
      const days = Math.max(5, Math.floor((now - (ms(t.lastActiveAt) || ms(t.createdAt))) / DAY));
      const waiting = t.students > 0 ? `your ${t.students} students` : 'your classes';
      return {
        text: `Hi ${n}, we miss you on ClassCoach! 👋\n\nIt's been ${days} days since your last visit, and ${waiting} are waiting.\n\nMake a quick test with AI in 1 minute, or run a 5-minute Live Quiz in your next class.\n\nReply STOP to stop these messages.`,
        url: `${site}/dashboard`, label: 'Open ClassCoach', params: [n, String(days), waiting],
      };
    }
    case 'refer': return {
      text: `Hi ${n}, enjoying ClassCoach? 🙌\n\nShare it with other teachers and institutes.\n${rewardLine(t)}\n\nYour invite link:\n${t.referralUrl}\n\nReply STOP to stop these messages.`,
      url: t.referralUrl, label: 'Copy my invite link', params: [n, rewardLine(t), t.referralUrl],
    };
    default: return null;
  }
}

async function sendStage(phone, stage, m, u) {
  const tpl = process.env[TEMPLATE_ENV[stage]];
  if (u && within24h(u)) {
    if (stage === 'verify') return send('classcoach', phone, { type: 'buttons', text: m.text, buttons: [m.button] });
    return send('classcoach', phone, { type: 'link', text: m.text, url: m.url, label: m.label });
  }
  if (!tpl) return null; // no approved template yet: try again next run
  return send('classcoach', phone, { type: 'template', name: tpl, params: m.params, ...(stage === 'verify' ? { buttons: ['cc:verify'] } : {}), direct: true });
}

export async function classcoachJourney(now = Date.now()) {
  if (!cc.enabled()) return { sent: 0, skipped: 0 };
  const list = await cc.journeyCandidates();
  const today = istDay(now);
  let sent = 0, skipped = 0;
  for (const t of list) {
    const phone = waPhone(t.phone);
    if (!phone) continue;
    const stages = stageFor(t, now) || [];
    if (!stages.length) continue;
    if (await db.kv.findOne({ key: `cc-journey-day:${t.id}:${today}` })) continue;
    const u = await db.users.findOne({ product: 'classcoach', phone });
    if (u?.optedOut) continue;
    for (const { stage, key } of stages) {
      const doneKey = `cc-journey:${t.id}:${key}`;
      if (await db.kv.findOne({ key: doneKey })) continue;
      if (stage === 'verify' && t.phoneVerified && t.emailVerified) continue;
      const m = compose(stage, t, now);
      let res;
      try { res = await sendStage(phone, stage, m, u); } catch (e) { res = { ok: false, status: 'error', body: e.message }; }
      if (res === null) { skipped++; continue; } // template not configured: try the next stage
      if (res && res.ok === false) { console.warn('[cc-journey] send failed', stage, phone, res.status, String(res.body || '').slice(0, 200)); skipped++; break; }
      await db.kv.insertOne({ key: doneKey, at: new Date(now), stage });
      await db.kv.insertOne({ key: `cc-journey-day:${t.id}:${today}`, at: new Date(now), stage });
      await db.events.insertOne({ product: 'classcoach', phone, type: 'cc_journey', stage, at: new Date(now) });
      sent++;
      break;
    }
  }
  return { sent, skipped };
}

// Dry run for the start-up log: how many teachers are in each stage right now.
export async function previewJourney(now = Date.now()) {
  if (!cc.enabled()) return null;
  const list = await cc.journeyCandidates();
  const stages = {};
  for (const t of list) for (const { stage } of stageFor(t, now) || []) stages[stage] = (stages[stage] || 0) + 1;
  const templates = Object.fromEntries(Object.entries(TEMPLATE_ENV).map(([k, v]) => [k, process.env[v] ? 'set' : 'missing']));
  return { teachers: list.length, withPhone: list.filter((t) => waPhone(t.phone)).length, stages, templates };
}
