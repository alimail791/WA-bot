// ClassCoach: tutor-first flow. Tutors run their class from WhatsApp; students join with "JOIN CODE".
// Same plans and rules as classcoach.in: 1-month free trial (10 students), Starter/Growth/Pro for 3 months,
// NEET/JEE track monthly or yearly. When a plan ends, existing students stay but no new ones can join.
// Funnel: Hi → trial → quiz from a topic (or the 3,600-question NEET bank) in seconds → one link for the
//         class group → auto-graded results in chat → upgrade when the class fills up or the trial ends.
// Refer & earn ("CREF CODE"): every 2 invited teachers who buy a plan earn the inviter 3 months free.
import { db } from '../store.js';
import { config } from '../config.js';
import { pickQuestions, getQuestions } from '../questions.js';
import { createMagicLink } from '../magic.js';
import { createOrder } from '../payments.js';
import { send } from '../providers/index.js';
import { rupees } from '../products.js';
import { code as newCode, waLink, DAY, istDate, maskPhone, refCodeFor } from '../util.js';
import { within24h } from '../engine.js';
import { offerFooter } from './common.js';

const active = (until) => until && new Date(until) > new Date();
const onTrial = (u) => active(u.trialEndsAt) && !active(u.plan?.until);
const isPro = (u) => active(u.plan?.until) || active(u.trialEndsAt);
const hasNeetPack = (u) => active(u.trialEndsAt) || (active(u.plan?.until) && u.plan.track === 'neet_jee');
// Active plan → its size; trial → 10; expired → frozen at the current class size
const studentLimit = (u, cfg, current = 0) => (active(u.plan?.until) ? u.plan.students : active(u.trialEndsAt) ? cfg.trialStudents : current);
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const trialDaysLeft = (u) => Math.max(0, Math.ceil((new Date(u.trialEndsAt) - Date.now()) / DAY));
const isPackSubject = (s) => /^(NEET|JEE)/i.test(s);
const joinLink = (code) => waLink(config.wa.displayNumbers.classcoach, `JOIN ${code}`);

export async function handle(ctx, input) {
  const { replyId, upper, text } = input;
  const state = ctx.session.data?.state;

  // ---- Student side ----
  const join = upper.match(/^JOIN\s+([A-Z0-9]{4,8})$/);
  if (join) return studentJoin(ctx, join[1]);
  if (ctx.user.role === 'student') return studentHandle(ctx, input);

  // ---- Tutor side ----
  if (!ctx.user.role) {
    await ctx.setUser({ role: 'tutor', trialEndsAt: new Date(Date.now() + ctx.cfg.trialDays * DAY) });
  }
  if (!ctx.user.refCode) await ctx.setUser({ refCode: refCodeFor('classcoach', ctx.phone) });
  const cref = upper.match(/\bCREF\s+([A-Z0-9]{6})\b/);
  if (cref) await joinWithInvite(ctx, cref[1]);
  if (state === 'await_topic' && !replyId) return makeQuiz(ctx, ctx.session.data.subject, text);
  if (state === 'await_classname' && !replyId) return renameClass(ctx, text);

  const [, cmd, a] = replyId.split(':');
  if (replyId.startsWith('cc:')) {
    if (cmd === 'new') return chooseSubject(ctx);
    if (cmd === 'subj') return chooseTopic(ctx, a);
    if (cmd === 'any') return makeQuiz(ctx, ctx.session.data.subject, '');
    if (cmd === 'regen') return makeQuiz(ctx, ctx.session.data.subject, ctx.session.data.topic);
    if (cmd === 'send') return sendToClass(ctx);
    if (cmd === 'results') return results(ctx);
    if (cmd === 'remind') return remindPending(ctx);
    if (cmd === 'plans') return plans(ctx);
    if (cmd === 'buy') return buy(ctx, a);
    if (cmd === 'class') return classInfo(ctx);
    if (cmd === 'refer') return refer(ctx);
    if (cmd === 'rename') { await ctx.go('await_classname'); return ctx.say('Send the new class name, like "Class 10 Science · Evening batch".'); }
  }
  const cmdText = { QUIZ: 'new', RESULTS: 'results', PLANS: 'plans', CLASS: 'class', REFER: 'refer' }[upper];
  if (cmdText === 'refer') return refer(ctx);
  if (cmdText === 'new') return chooseSubject(ctx);
  if (cmdText === 'results') return results(ctx);
  if (cmdText === 'plans') return plans(ctx);
  if (cmdText === 'class') return classInfo(ctx);
  return tutorMenu(ctx);
}

async function getClass(ctx) {
  let c = await db.classes.findOne({ tutorPhone: ctx.phone });
  if (!c) {
    const first = ctx.user.name ? ctx.user.name.split(' ')[0] : 'My';
    c = await db.classes.insertOne({ code: newCode(5), tutorPhone: ctx.phone, tutorName: ctx.user.name || '', title: `${first}'s class`, students: [], quizzes: [], activeQuizId: null, createdAt: new Date() });
  }
  return c;
}

async function tutorMenu(ctx) {
  const u = ctx.user;
  const name = u.name ? u.name.split(' ')[0] : '';
  const lines = [];
  if (ctx.isNew) {
    lines.push(`Welcome to ClassCoach${name ? ', ' + name : ''}! 👋`, 'Make a quiz in seconds, send one link to your class group, and get every student\'s marks here. No app needed.', '', `🎁 Your 1-month free trial is on: up to ${ctx.cfg.trialStudents} students, reminders and the 3,600-question NEET bank.`);
  } else {
    lines.push(`Hi${name ? ' ' + name : ''}! 👋`);
    if (onTrial(u)) lines.push(`Free trial: ${trialDaysLeft(u)} day${trialDaysLeft(u) === 1 ? '' : 's'} left.`);
    else if (active(u.plan?.until)) lines.push(`${ctx.cfg.plans[u.plan.id]?.title || 'Plan'} active till ${fmtDate(u.plan.until)}.`);
    else lines.push('⚠️ Your plan has ended: existing students stay, new students can\'t join. Send PLANS to renew.');
  }
  lines.push('', 'What would you like to do?');
  await ctx.buttons(lines.join('\n'), [['cc:new', '✨ Make a quiz'], ['cc:results', '📊 Results'], ['cc:class', '👥 My class']]);
}

async function chooseSubject(ctx) {
  const all = await db.questions.find({ product: 'classcoach' });
  const counts = {};
  for (const q of all) counts[q.subject] = (counts[q.subject] || 0) + 1;
  const subjects = Object.keys(counts).sort((a, b) => isPackSubject(a) - isPackSubject(b) || a.localeCompare(b)).slice(0, 10);
  if (!subjects.length) return ctx.say('The question bank is empty. Upload questions first (see the admin guide).');
  await ctx.list('Pick a subject for your quiz:', 'Choose subject', [{
    title: 'Subjects', rows: subjects.map((s) => ({
      id: `cc:subj:${s}`, title: s,
      description: `${counts[s]} questions${isPackSubject(s) && !hasNeetPack(ctx.user) ? ' · 🔒 NEET/JEE plan' : isPackSubject(s) ? ' · NEET/JEE bank' : ''}`,
    })),
  }]);
}

async function chooseTopic(ctx, subject) {
  if (isPackSubject(subject) && !hasNeetPack(ctx.user)) {
    await ctx.say(`🔒 ${subject} is part of the NEET/JEE plans: 3,600+ chapter-wise PCB questions with PYQs from 2016 onwards.`);
    return plans(ctx);
  }
  await ctx.setSession({ state: 'await_topic', subject });
  await ctx.buttons(`Type a topic for ${subject}, like "Light" or "Trigonometry".\nOr tap below for mixed questions.`, [['cc:any', 'Any topic']]);
}

async function makeQuiz(ctx, subject, topic) {
  if (!subject) return chooseSubject(ctx);
  const qs = await pickQuestions('classcoach', ctx.cfg.quizSize, { subject, topic });
  if (!qs.length) return ctx.say(`No questions found for ${subject}. Try another subject.`);
  const c = await getClass(ctx);
  const quiz = { id: newCode(4), title: `${subject}${topic ? ' · ' + topic : ''}`, subject, topic: topic || '', qids: qs.map((q) => q._id), createdAt: new Date(), notified: {} };
  await ctx.setSession({ state: 'idle', topic: topic || '', draftQuiz: quiz });
  const matched = topic ? qs.filter((q) => (q.topic || '').toLowerCase().includes(topic.toLowerCase()) || q.question.toLowerCase().includes(topic.toLowerCase())).length : qs.length;
  const preview = qs.slice(0, 2).map((q, i) => `${i + 1}. ${q.question}`).join('\n');
  await ctx.buttons(
    `✨ Quiz ready: ${quiz.title}\n${qs.length} questions · auto-graded${topic && matched < qs.length ? `\n(${matched} matched "${topic}", rest are from ${subject})` : ''}\n\nPreview:\n${preview}\n\nClass: ${c.title} (${c.students.length} students)`,
    [['cc:send', '✅ Send to class'], ['cc:regen', '🔁 New questions'], ['cc:new', 'Change subject']],
  );
}

async function sendToClass(ctx) {
  const quiz = ctx.session.data?.draftQuiz;
  if (!quiz) return chooseSubject(ctx);
  const c = await getClass(ctx);
  await db.classes.updateOne({ _id: c._id }, { $push: { quizzes: quiz }, $set: { activeQuizId: quiz.id } });
  await ctx.setSession({ draftQuiz: null });
  await ctx.track('class_quiz_sent', { code: c.code, quiz: quiz.id, students: c.students.length });
  const link = joinLink(c.code);
  await ctx.say(`✅ Quiz is live. Forward the message below to your class WhatsApp group 👇`);
  await ctx.say(`📝 ${c.title}: new quiz on ${quiz.title}\n${quiz.qids.length} questions. Tap to start, no login needed:\n${link || `Message ClassCoach and send: JOIN ${c.code}`}`);

  // Students who already joined get it directly
  let direct = 0, tmpl = 0;
  for (const s of c.students) {
    const su = await db.users.findOne({ product: 'classcoach', phone: s.phone });
    if (within24h(su)) { await sendQuizLink(s.phone, c, quiz); direct++; }
    else if (process.env.TEMPLATE_CLASS_QUIZ) {
      await send('classcoach', s.phone, { type: 'template', name: process.env.TEMPLATE_CLASS_QUIZ, params: [c.title, quiz.title, `JOIN ${c.code}`] });
      tmpl++;
    }
  }
  if (direct || tmpl) await ctx.say(`Also sent directly to ${direct + tmpl} student${direct + tmpl > 1 ? 's' : ''} who joined earlier.`);
  await ctx.buttons('I\'ll message you as results come in.', [['cc:results', '📊 See results'], ['cc:new', '✨ Another quiz']]);
}

async function sendQuizLink(studentPhone, c, quiz) {
  const done = await db.attempts.findOne({ product: 'classcoach', phone: studentPhone, ref: `${c.code}:${quiz.id}` });
  if (done) return false;
  const url = await createMagicLink({ product: 'classcoach', phone: studentPhone, kind: 'class', ref: `${c.code}:${quiz.id}`, title: `${c.title} · ${quiz.title}`, qids: quiz.qids, durationMin: Math.max(10, Math.round(quiz.qids.length * 1.5)), ttlMin: 60 * 12 });
  await send('classcoach', studentPhone, { type: 'link', text: `📝 ${quiz.title}\nFrom ${c.tutorName || 'your teacher'} · ${quiz.qids.length} questions\nYour answers go straight to your teacher.`, url, label: 'Start quiz' });
  return true;
}

// ---- Students ----
async function studentJoin(ctx, code) {
  const c = await db.classes.findOne({ code });
  if (!c) return ctx.say(`I couldn't find class "${code}". Check the code with your teacher.`);
  if (c.tutorPhone === ctx.phone) return ctx.say('That\'s your own class. Forward the link to your students.');
  const tutor = await db.users.findOne({ product: 'classcoach', phone: c.tutorPhone });
  const already = c.students.some((s) => s.phone === ctx.phone);
  if (!already) {
    const limit = studentLimit(tutor, ctx.cfg, c.students.length);
    if (c.students.length >= limit + ctx.cfg.graceStudents) {
      await ctx.say(`${c.title} is full right now. Your teacher has been told, and you'll be added as soon as there's room.`);
      await upgradeNudge(tutor, c, true);
      return;
    }
    await db.classes.updateOne({ _id: c._id }, { $push: { students: { phone: ctx.phone, name: ctx.user.name || '', joinedAt: new Date() } } });
    if (c.students.length + 1 >= limit) await upgradeNudge(tutor, c, false);
  }
  if (ctx.user.role !== 'tutor') await ctx.setUser({ role: 'student', classCode: code });
  const quiz = c.quizzes.find((q) => q.id === c.activeQuizId);
  if (!already) await ctx.say(`✅ You joined ${c.title}${c.tutorName ? ' by ' + c.tutorName : ''}.\nYour number ${maskPhone(ctx.phone)} is your login.`);
  if (quiz) {
    const sent = await sendQuizLink(ctx.phone, c, quiz);
    if (!sent) await ctx.say('You\'ve already done the latest quiz. New quizzes from your teacher will come here.');
  } else await ctx.say('No quiz yet. Your teacher\'s quizzes will come here.');
}

async function studentHandle(ctx, input) {
  const c = await db.classes.findOne({ code: ctx.user.classCode });
  if (!c) return ctx.say('Send JOIN followed by your class code to join a class.');
  const quiz = c.quizzes.find((q) => q.id === c.activeQuizId);
  if (quiz && (await sendQuizLink(ctx.phone, c, quiz))) return;
  const mine = await db.attempts.find({ product: 'classcoach', phone: ctx.phone }, { sort: { at: -1 }, limit: 5 });
  const lines = [`${c.title}`, quiz ? 'You\'ve finished the latest quiz ✅' : 'No quiz right now.'];
  if (mine.length) lines.push('', 'Your recent scores:', ...mine.map((a) => `${a.title.split(' · ').slice(1).join(' · ') || a.title}: ${a.correct}/${a.total}`));
  await ctx.say(lines.join('\n'));
}

export async function onAttempt(ctx, a) {
  const [classCode, quizId] = a.ref.split(':');
  const c = await db.classes.findOne({ code: classCode });
  if (!c) return;
  const quiz = c.quizzes.find((q) => q.id === quizId);
  await ctx.say(`✅ Submitted: ${a.correct}/${a.total}${a.weak.length ? `\nRevise: ${a.weak.slice(0, 2).join(', ')}` : ''}\nYour teacher can see your answers.`);

  // Tell the tutor at the first result, at half the class and when everyone is done
  const n = await db.attempts.count({ product: 'classcoach', ref: a.ref });
  const total = Math.max(c.students.length, 1);
  const marks = [['first', n === 1], ['half', n >= Math.ceil(total / 2)], ['all', n >= total]];
  const hit = marks.filter(([k, ok]) => ok && !quiz.notified?.[k]).map(([k]) => k);
  if (!hit.length) return;
  const idx = c.quizzes.findIndex((q) => q.id === quizId);
  const notified = { ...(quiz.notified || {}) };
  hit.forEach((k) => (notified[k] = true));
  await db.classes.updateOne({ _id: c._id }, { $set: { [`quizzes.${idx}.notified`]: notified } });
  const tutor = await db.users.findOne({ product: 'classcoach', phone: c.tutorPhone });
  const msg = hit.includes('all') ? `🎉 Everyone in ${c.title} has finished "${quiz.title}".` : hit.includes('half') ? `📊 Half the class has finished "${quiz.title}" (${n}/${total}).` : `📥 First result in for "${quiz.title}": ${a.name || 'a student'} scored ${a.correct}/${a.total}.`;
  if (within24h(tutor)) await send('classcoach', c.tutorPhone, { type: 'buttons', text: msg, buttons: [{ id: 'cc:results', title: '📊 See results' }] });
  else if (process.env.TEMPLATE_CLASS_RESULTS) await send('classcoach', c.tutorPhone, { type: 'template', name: process.env.TEMPLATE_CLASS_RESULTS, params: [quiz.title, `${n}/${total}`] });
}

// ---- Tutor results and upgrades ----
async function results(ctx) {
  const c = await db.classes.findOne({ tutorPhone: ctx.phone });
  const quiz = c?.quizzes.find((q) => q.id === c.activeQuizId);
  if (!quiz) return ctx.buttons('No quiz sent yet.', [['cc:new', '✨ Make a quiz']]);
  const atts = await db.attempts.find({ product: 'classcoach', ref: `${c.code}:${quiz.id}` }, { sort: { correct: -1 } });
  const done = new Set(atts.map((x) => x.phone));
  const pending = c.students.filter((s) => !done.has(s.phone));
  const lines = [`📊 ${quiz.title}`, `Attempted: ${atts.length} of ${c.students.length}`];
  if (atts.length) {
    const avg = atts.reduce((s, x) => s + x.correct / x.total, 0) / atts.length;
    lines.push(`Class average: ${Math.round(avg * 100)}%`);
    lines.push(`Top: ${atts.slice(0, 3).map((x) => `${x.name || maskPhone(x.phone)} (${x.correct}/${x.total})`).join(', ')}`);
    // Hardest question = lowest share of correct answers
    const qs = await getQuestions(quiz.qids);
    const rate = qs.map((q, i) => ({ i, q, ok: atts.filter((x) => Number(x.answers?.[q._id]) === q.answer).length }));
    const hard = rate.sort((x, y) => x.ok - y.ok)[0];
    if (hard) lines.push(`Hardest: Q${quiz.qids.indexOf(hard.q._id) + 1} (${hard.q.topic || hard.q.subject}), ${hard.ok} of ${atts.length} correct`);
  }
  if (pending.length) lines.push(`Not attempted (${pending.length}): ${pending.slice(0, 8).map((s) => s.name || maskPhone(s.phone)).join(', ')}${pending.length > 8 ? '…' : ''}`);
  const btns = [];
  if (pending.length) btns.push(['cc:remind', isPro(ctx.user) ? `🔔 Remind ${pending.length}` : '🔒 Remind (Pro)']);
  btns.push(['cc:new', '✨ Next quiz']);
  await ctx.buttons(lines.join('\n'), btns);
}

async function remindPending(ctx) {
  if (!isPro(ctx.user)) {
    await ctx.say('Reminders are a Pro feature. Students who get a reminder are much more likely to finish the quiz.');
    return plans(ctx);
  }
  const c = await db.classes.findOne({ tutorPhone: ctx.phone });
  const quiz = c.quizzes.find((q) => q.id === c.activeQuizId);
  const done = new Set((await db.attempts.find({ product: 'classcoach', ref: `${c.code}:${quiz.id}` })).map((x) => x.phone));
  let sent = 0, unreachable = 0;
  for (const s of c.students.filter((x) => !done.has(x.phone))) {
    const su = await db.users.findOne({ product: 'classcoach', phone: s.phone });
    if (within24h(su)) { await sendQuizLink(s.phone, c, quiz); sent++; }
    else if (process.env.TEMPLATE_CLASS_QUIZ) { await send('classcoach', s.phone, { type: 'template', name: process.env.TEMPLATE_CLASS_QUIZ, params: [c.title, quiz.title, `JOIN ${c.code}`] }); sent++; }
    else unreachable++;
  }
  await ctx.say(`🔔 Reminder sent to ${sent} student${sent === 1 ? '' : 's'}.${unreachable ? `\n${unreachable} haven't messaged ClassCoach in the last 24 hours, so WhatsApp only allows an approved template message. Re-share the class link in your group to reach them.` : ''}`);
}

async function upgradeNudge(tutor, c, full) {
  const today = istDate();
  if (tutor.lastUpgradeNudge === today && !full) return;
  await db.users.updateOne({ product: 'classcoach', phone: tutor.phone }, { $set: { lastUpgradeNudge: today } });
  const cfg = (await import('../products.js')).products.classcoach;
  const limit = studentLimit(tutor, cfg, c.students.length);
  const text = full
    ? `⚠️ ${c.title} is full (${c.students.length} students). A new student just tried to join and is waiting.\nUpgrade to add everyone.`
    : `🎉 ${c.title} now has ${c.students.length + 1} of ${limit} students. Your class is full now.\nUpgrade so nobody is turned away.`;
  if (within24h(tutor)) await send('classcoach', tutor.phone, { type: 'buttons', text, buttons: [{ id: 'cc:plans', title: '⭐ See plans' }] });
  else if (process.env.TEMPLATE_UPGRADE) await send('classcoach', tutor.phone, { type: 'template', name: process.env.TEMPLATE_UPGRADE, params: [c.title, String(c.students.length)] });
}

async function plans(ctx) {
  const p = ctx.cfg.plans;
  const c = await db.classes.findOne({ tutorPhone: ctx.phone });
  const size = c?.students.length || 0;
  const fit = (x) => x.students >= Math.max(size, 1) && Object.values(p).filter((y) => y.track === x.track && y.months === x.months && y.students >= Math.max(size, 1)).sort((m, n) => m.students - n.students)[0]?.id === x.id;
  const rows = Object.values(p).map((x) => ({
    id: `cc:buy:${x.id}`,
    title: `${x.best ? '⭐ ' : ''}${x.title}`.slice(0, 24),
    description: `${rupees(x.price)} for ${x.months === 12 ? '12 months' : x.months === 1 ? '1 month' : `${x.months} months`}${x.months === 12 ? ' · 2 months free' : ''}${x.track === 'neet_jee' ? ' · NEET bank' : ''}${fit(x) && size ? ' · fits your class' : ''}`,
  }));
  const head = ['ClassCoach plans (same as classcoach.in)', '• General: Starter, Growth, Pro, each for 3 months', '• NEET/JEE: adds the 3,600-question NEET bank with PYQs'];
  if (onTrial(ctx.user)) head.push('', `Your free trial ends in ${trialDaysLeft(ctx.user)} days.`);
  else if (active(ctx.user.plan?.until)) head.push('', `Current plan runs till ${fmtDate(ctx.user.plan.until)}. Buying now adds on top.`);
  if (size) head.push(`Your class: ${size} students.`);
  await ctx.list(head.join('\n'), 'See plans', [{ title: 'Plans', rows }]);
  const f = offerFooter();
  if (f) await ctx.say(`⏳ ${f}`);
}

async function buy(ctx, planId) {
  const plan = ctx.cfg.plans[planId];
  if (!plan) return plans(ctx);
  const order = await createOrder({ product: 'classcoach', phone: ctx.phone, item: planId, title: `ClassCoach ${plan.title}`, amount: plan.price, meta: {} });
  await ctx.link(`${plan.title} · ${rupees(plan.price)} for ${plan.months === 1 ? '1 month' : `${plan.months} months`}\nPay with any UPI app. It turns on right after payment.`, order.link, 'Pay by UPI');
}

export async function onPaid(ctx, order) {
  const plan = ctx.cfg.plans[order.item];
  // Like classcoach.in: time left on the current plan is kept and the new plan stacks on top
  const from = active(ctx.user.plan?.until) ? new Date(ctx.user.plan.until) : new Date();
  const until = addMonths(from, plan.months);
  await ctx.setUser({ plan: { id: plan.id, students: plan.students, track: plan.track, until } });
  await ctx.say(`✅ Payment received: ${rupees(order.amount)}\n${plan.title} is active till ${fmtDate(until)}. Up to ${plan.students} students${plan.track === 'neet_jee' ? ', with the NEET/JEE question bank' : ''}. Thank you! 🙏`);
  if (!ctx.user.firstPlanBought) {
    await ctx.setUser({ firstPlanBought: true });
    if (ctx.user.referredBy) await rewardInviter(ctx);
  }
  await ctx.buttons('What next?', [['cc:new', '✨ Make a quiz'], ['cc:results', '📊 Results'], ['cc:refer', '🎁 Refer & earn']]);
}

// ---- Refer & earn (classcoach.in rule: every 2 invited teachers who buy → 3 months free) -----
async function joinWithInvite(ctx, code) {
  const u = ctx.user;
  const inviter = await db.users.findOne({ product: 'classcoach', refCode: code, role: 'tutor' });
  if (!inviter || inviter.phone === ctx.phone || u.referredBy || u.firstPlanBought) return;
  await ctx.setUser({ referredBy: inviter.phone });
  await ctx.say(`🤝 You were invited by a fellow teacher. Enjoy your free 1-month trial!`);
}

async function rewardInviter(ctx) {
  const r = ctx.cfg.referral;
  const inv = await db.users.findOne({ product: 'classcoach', phone: ctx.user.referredBy });
  if (!inv) return;
  const bought = await db.users.count({ product: 'classcoach', referredBy: inv.phone, firstPlanBought: true });
  const earned = Math.floor(bought / r.needed);
  const fresh = earned - (inv.referralRewardsGranted || 0);
  const patch = { referralRewardsGranted: earned, referrals: bought };
  let untilText = '';
  if (fresh > 0) {
    const months = r.rewardMonths * fresh;
    if (active(inv.plan?.until) || !active(inv.trialEndsAt)) {
      const from = active(inv.plan?.until) ? new Date(inv.plan.until) : new Date();
      const plan = inv.plan?.id ? { ...inv.plan } : { id: 'growth', students: ctx.cfg.plans.growth.students, track: 'general' };
      plan.until = addMonths(from, months);
      patch.plan = plan; untilText = fmtDate(plan.until);
    } else {
      patch.trialEndsAt = addMonths(inv.trialEndsAt, months); untilText = fmtDate(patch.trialEndsAt);
    }
  }
  const updated = await db.users.updateOne({ _id: inv._id }, { $set: patch });
  if (!within24h(updated)) return;
  const text = fresh > 0
    ? `🎉 Referral reward! ${bought} teachers you invited have bought ClassCoach. ${r.rewardMonths * fresh} months added free, now till ${untilText}.`
    : `🙌 A teacher you invited just bought ClassCoach. ${r.needed - (bought % r.needed)} more and you get ${r.rewardMonths} months free.`;
  await send('classcoach', inv.phone, { type: 'text', text });
}

async function refer(ctx) {
  const r = ctx.cfg.referral;
  const u = ctx.user;
  const link = waLink(config.wa.displayNumbers.classcoach, `Hi CREF ${u.refCode}`);
  const bought = await db.users.count({ product: 'classcoach', referredBy: ctx.phone, firstPlanBought: true });
  const toNext = r.needed - (bought % r.needed);
  await ctx.say(`🎁 Refer & earn\n• Teachers you invite get a free 1-month trial\n• Every ${r.needed} teachers who buy a plan = ${r.rewardMonths} months free for you\n• No limit: 8 teachers = a full year free\n\nTeachers who bought: ${bought} · ${toNext} more for your next ${r.rewardMonths} free months\n\nForward the message below to teacher friends and groups 👇`);
  await ctx.say(`I make class quizzes on WhatsApp in seconds with ClassCoach. Students answer from a link, marks come back to me automatically, no app needed. Try it free for a month with my link: ${link || 'message ClassCoach and send CREF ' + u.refCode}`);
}

async function classInfo(ctx) {
  const c = await getClass(ctx);
  const limit = studentLimit(ctx.user, ctx.cfg, c.students.length);
  await ctx.say(`👥 ${c.title}\nStudents: ${c.students.length} of ${limit}${onTrial(ctx.user) ? ' (free trial)' : ''}\nClass code: ${c.code}\n\nStudents join by tapping:\n${joinLink(c.code) || `Message ClassCoach and send: JOIN ${c.code}`}`);
  await ctx.buttons('Options', [['cc:rename', '✏️ Rename class'], ['cc:plans', '⭐ Plans'], ['cc:refer', '🎁 Refer & earn']]);
}

async function renameClass(ctx, text) {
  const title = String(text).trim().slice(0, 60);
  if (!title) return ctx.say('Send a class name, or MENU to cancel.');
  const c = await getClass(ctx);
  await db.classes.updateOne({ _id: c._id }, { $set: { title } });
  await ctx.go('idle');
  await ctx.say(`✅ Class renamed to "${title}".`);
  return tutorMenu(ctx);
}
