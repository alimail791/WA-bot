// YNeet 30-day free trial → paid plan. Once a day (11:15 AM IST) each trial student gets at most one
// message for the stage they are in, built from their real activity in app.yneet.in:
//   d3   day 3–5, only if they haven't practised or taken a test yet
//   d7   day 7–9   week-1 summary + weakest chapter
//   d20  day 20–22 10 days left, mock score so far
//   d27  day 27–29 trial ends in 3 days, plan prices
//   ended  0–3 days after the trial ended without a plan
// Inside WhatsApp's 24-hour window it's a free message with a button; outside it, the approved
// template named in TEMPLATE_YNEET_TRIAL_<STAGE> (see README). No template set → nothing is sent.
// Each stage goes out once per student (kv key yneet-trial:<userId>:<stage>).
import { db } from './store.js';
import { send } from './providers/index.js';
import { within24h } from './engine.js';
import * as yneet from './yneetBridge.js';
import { DAY } from './util.js';

const APP = () => process.env.YNEET_APP_URL || 'https://app.yneet.in';
const JUNIOR = ['6th', '7th', '8th'];

export function stageFor(c, now = Date.now()) {
  const day = Math.floor((now - new Date(c.startDate).getTime()) / DAY);
  const end = c.endDate ? new Date(c.endDate).getTime() : null;
  if (end && now >= end) return now - end < 3 * DAY ? 'ended' : null;
  if (day >= 27 && day <= 29) return 'd27';
  if (day >= 20 && day <= 22) return 'd20';
  if (day >= 7 && day <= 9) return 'd7';
  if (day >= 3 && day <= 5) return 'd3';
  return null;
}

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const waPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '91' + d : null; };

// Text for the free (in-window) message, and params for the template (same order as the README).
export function compose(stage, name, s) {
  const n = first(name);
  const pricing = `${APP()}/pricing`;
  switch (stage) {
    case 'd3': return {
      text: `Hi ${n}, your YNeet free trial is on, but you haven't taken a test yet.\n\nStart with one 20-minute chapter test. You'll see your score and every explanation straight away.`,
      url: APP(), label: 'Take a chapter test', params: [n],
    };
    case 'd7': {
      const acc = s.accuracy != null ? `${s.accuracy}%` : '-';
      const weak = s.weakChapter || 'your weakest chapter';
      return {
        text: `Week 1 done, ${n}!\n\nYou solved ${s.solved} questions with ${acc} accuracy.${s.weakChapter ? `\nWeakest chapter: ${s.weakChapter}.` : ''}\n\nPractise ${weak} today. 20 minutes is enough.`,
        url: `${APP()}/practice`, label: 'Practise now', params: [n, String(s.solved), acc, weak],
      };
    }
    case 'd20': {
      const score = s.latestMock != null ? `${s.firstMock} → ${s.latestMock}/720` : s.firstMock != null ? `${s.firstMock}/720` : 'not taken yet';
      return {
        text: `${n}, 10 days left in your YNeet free trial.\n\nFull mock score: ${score}.\nTake one full NEET mock this week to see how far you've come.`,
        url: `${APP()}/mock`, label: 'Start a full mock', params: [n, score],
      };
    }
    case 'd27': return {
      text: `${n}, your YNeet free trial ends in 3 days.\n\nThis month: ${s.activeDays} days studied, ${s.tests} tests.\n\nKeep going:\n• ₹399 for 1 month (Class 11–12)\n• or choose your months\n• ₹3,199 for a full year\n\nYour mistakes, notes and streak stay saved.`,
      url: pricing, label: 'See plans', params: [n, String(s.activeDays), String(s.tests)],
    };
    case 'ended': return {
      text: `${n}, your YNeet free trial has ended.\n\nYour tests, mistake notebook and streak are saved. Pick a plan to carry on from where you stopped.`,
      url: pricing, label: 'Continue YNeet', params: [n],
    };
    default: return null;
  }
}

export async function yneetTrialJourney(now = Date.now()) {
  if (!yneet.enabled()) return { sent: 0, skipped: 0 };
  const list = await yneet.trialCandidates();
  let sent = 0, skipped = 0;
  for (const c of list) {
    if (JUNIOR.includes(c.classLevel)) continue;
    const stage = stageFor(c, now);
    const phone = waPhone(c.phone);
    if (!stage || !phone) continue;
    const key = `yneet-trial:${c.userId}:${stage}`;
    if (await db.kv.findOne({ key })) continue;
    const s = await yneet.trialStats(c.userId, new Date(c.startDate));
    if (!s) continue;
    if (stage === 'd3' && (s.solved > 0 || s.tests > 0)) { await db.kv.insertOne({ key, at: new Date(now), skipped: 'active' }); continue; }
    const u = await db.users.findOne({ product: 'yneet', phone });
    if (u?.optedOut) { await db.kv.insertOne({ key, at: new Date(now), skipped: 'opted-out' }); continue; }
    const m = compose(stage, c.name, s);
    const tpl = process.env[`TEMPLATE_YNEET_TRIAL_${stage.toUpperCase()}`];
    let res;
    try {
      if (u && within24h(u)) res = await send('yneet', phone, { type: 'link', text: m.text, url: m.url, label: m.label });
      else if (tpl) res = await send('yneet', phone, { type: 'template', name: tpl, params: m.params, direct: true });
      else { skipped++; continue; } // no template yet: try again tomorrow while the stage window is open
    } catch (e) { res = { ok: false, status: 'error', body: e.message }; }
    if (res && res.ok === false) { console.warn('[yneet-trial] send failed', stage, phone, res.status, String(res.body || '').slice(0, 200)); skipped++; continue; }
    await db.kv.insertOne({ key, at: new Date(now), stage });
    await db.events.insertOne({ product: 'yneet', phone, type: 'trial_nudge', stage, at: new Date(now) });
    sent++;
  }
  return { sent, skipped };
}
