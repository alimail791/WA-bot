// Scheduled messages that bring people back. Free-form messages only go to people who messaged
// in the last 24 hours (WhatsApp rule). Outside that window, a Meta-approved template is used if configured.
import cron from 'node-cron';
import { db } from './store.js';
import { send } from './providers/index.js';
import { within24h } from './engine.js';
import { rupees } from './products.js';
import { istDate, DAY } from './util.js';

const T = (name) => process.env[name] || '';

// 1) Unfinished payments: one reminder 30–120 minutes after the link was sent
export async function nudgeAbandonedOrders(now = Date.now()) {
  const orders = await db.orders.find({ status: 'created', nudged: false, createdAt: { $lte: new Date(now - 30 * 60e3), $gte: new Date(now - 120 * 60e3) } });
  let sent = 0;
  for (const o of orders) {
    const u = await db.users.findOne({ product: o.product, phone: o.phone });
    await db.orders.updateOne({ _id: o._id }, { $set: { nudged: true } });
    if (!u || u.optedOut || !within24h(u)) continue;
    const paid = await db.orders.count({ product: o.product, phone: o.phone, status: 'paid', createdAt: { $gte: o.createdAt } });
    if (paid) continue;
    await send(o.product, o.phone, { type: 'link', text: `Your ${o.title} is waiting 🙂\n${rupees(o.amount)} · pay with any UPI app and it unlocks instantly.\nQuestions? Just reply here.`, url: o.link, label: 'Finish payment' });
    sent++;
  }
  return sent;
}

// 2) YNeet daily quiz at 7 PM for students who asked for it
export async function dailyQuizReminder() {
  const today = istDate();
  const users = await db.users.find({ product: 'yneet', dailyOptIn: true, optedOut: { $ne: true } });
  let free = 0, tmpl = 0;
  for (const u of users) {
    if (u.streak?.last === today) continue;
    const streak = u.streak?.count && u.streak.last === istDate(new Date(Date.now() - DAY)) ? u.streak.count : 0;
    if (within24h(u)) {
      await send('yneet', u.phone, { type: 'buttons', text: streak ? `🔥 Don't break your ${streak}-day streak! Today's 3 questions are ready.` : '📝 Today\'s 3 NEET questions are ready. 60 seconds.', buttons: [{ id: 'y:quiz', title: 'Start quiz' }] });
      free++;
    } else if (T('TEMPLATE_DAILY_QUIZ')) {
      await send('yneet', u.phone, { type: 'template', name: T('TEMPLATE_DAILY_QUIZ'), params: [String(streak)] });
      tmpl++;
    }
  }
  return { free, tmpl };
}

// 3) YNeet weekly parent report (Sunday 6 PM). Needs an approved template because parents don't message first.
export async function weeklyParentReports() {
  if (!T('TEMPLATE_PARENT_REPORT')) return 0;
  const users = await db.users.find({ product: 'yneet', parentPhone: { $exists: true }, optedOut: { $ne: true } });
  let n = 0;
  for (const u of users) {
    const since = new Date(Date.now() - 7 * DAY);
    const mocks = await db.attempts.find({ product: 'yneet', phone: u.phone, at: { $gte: since } });
    const quizzes = await db.events.count({ product: 'yneet', phone: u.phone, type: 'quiz_done', at: { $gte: since } });
    const best = mocks.reduce((m, a) => Math.max(m, a.score720 || 0), 0);
    const weak = [...new Set(mocks.flatMap((a) => a.weak || []))].slice(0, 2).join(', ') || '-';
    await send('yneet', u.parentPhone, { type: 'template', name: T('TEMPLATE_PARENT_REPORT'), params: [u.name || 'Your child', String(quizzes), String(mocks.length), best ? `${best}/720` : '-', weak] });
    n++;
  }
  return n;
}

// 4) ClassCoach trial ending in 2 days
export async function trialEndingReminders() {
  const from = new Date(Date.now() + 1 * DAY), to = new Date(Date.now() + 2 * DAY);
  const tutors = await db.users.find({ product: 'classcoach', role: 'tutor', trialEndsAt: { $gte: from, $lte: to }, trialReminded: { $ne: true } });
  for (const u of tutors) {
    if (u.plan?.until && new Date(u.plan.until) > new Date()) continue;
    await db.users.updateOne({ _id: u._id }, { $set: { trialReminded: true } });
    const c = await db.classes.findOne({ tutorPhone: u.phone });
    const size = c?.students.length || 0;
    const text = `⏳ Your ClassCoach free trial ends in 2 days.${size ? `\nYour class has ${size} students.` : ''}\nAfter that, students you have stay but new ones can't join. Plans start at ₹499 for 3 months.`;
    if (within24h(u)) await send('classcoach', u.phone, { type: 'buttons', text, buttons: [{ id: 'cc:plans', title: '⭐ See plans' }] });
    else if (T('TEMPLATE_TRIAL_ENDING')) await send('classcoach', u.phone, { type: 'template', name: T('TEMPLATE_TRIAL_ENDING'), params: [String(size)] });
  }
}

export function startCron() {
  const tz = { timezone: 'Asia/Kolkata' };
  const safe = (name, fn) => async () => { try { await fn(); } catch (e) { console.error(`[cron] ${name} failed`, e); } };
  cron.schedule('*/10 * * * *', safe('abandoned', nudgeAbandonedOrders), tz);
  cron.schedule('0 19 * * *', safe('daily-quiz', dailyQuizReminder), tz);
  cron.schedule('0 18 * * 0', safe('parent-report', weeklyParentReports), tz);
  cron.schedule('0 11 * * *', safe('trial-ending', trialEndingReminders), tz);
  cron.schedule('*/5 * * * *', safe('lead-campaign', async () => (await import('./leads.js')).campaignTick()), tz);
  cron.schedule('17 * * * *', safe('lead-onboarding', async () => (await import('./leads.js')).onboardingTick()), tz);
  cron.schedule('3 9 * * *', safe('lead-summary', async () => (await import('./leads.js')).dailySummary()), tz);
  cron.schedule('* * * * *', safe('live-start', async () => (await import('./flows/testmandi.js')).notifyLiveStarts()), tz);
}
