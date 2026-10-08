// YNeet on WhatsApp — the NEET question bank shared with app.yneet.in, with the same plans and prices.
// Free: daily 3-question quiz, quick chapter practice in chat, 1 full NEET mock, 1 chapter test a day.
// Paid (₹99 for 5 days, or monthly by class till month-end): unlimited NEET-pattern mocks, chapter tests,
// PYQ papers, full analysis with estimated rank. Web subscribers on app.yneet.in are recognised by phone.
// Habit and growth: streaks, mistake revision, weekly leaderboard, parent reports, referrals.
import { db } from '../store.js';
import { config } from '../config.js';
import { pickQuestions } from '../questions.js';
import { createMagicLink } from '../magic.js';
import { createOrder } from '../payments.js';
import { send } from '../providers/index.js';
import { refCodeFor, maskPhone, estimateNeetRank, fmtNum, waLink, istDate, DAY } from '../util.js';
import { rupees } from '../products.js';
import { within24h } from '../engine.js';
import { chapters, pyqYears } from '../bank.js';
import * as bridge from '../yneetBridge.js';
import { startChatQuiz, answerQuestion, bumpStreak, todayCount, offerFooter, pendingOrder } from './common.js';

const SUBJECTS = ['Physics', 'Chemistry', 'Biology'];
const SUBJ_ICON = { Physics: '⚛️', Chemistry: '🧪', Biology: '🧬' };
const active = (until) => until && new Date(until) > new Date();
const credits = (u) => u.credits?.test || 0;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

// Last moment of the current month, India time (YNeet's monthly plan always ends at month-end)
export function endOfMonthIST(from = new Date()) {
  const ist = new Date(from.getTime() + 5.5 * 3600e3);
  const end = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - 5.5 * 3600e3 - 1000;
  return new Date(end);
}
const monthlyPrice = (cfg, cls) => cfg.monthlyByClass[cls] ?? cfg.monthlyByClass['12th'];

async function access(ctx) {
  const u = ctx.user;
  if (active(u.plan?.until)) return { ok: true, until: u.plan.until, via: 'whatsapp' };
  if (bridge.enabled()) {
    try {
      const web = await bridge.lookup(ctx.phone);
      if (web?.classLevel && !u.classLevel) await ctx.setUser({ classLevel: web.classLevel });
      if (web?.active) return { ok: true, until: web.endDate, via: 'web' };
    } catch (e) { console.warn('[yneet] web lookup failed', e.message); }
  }
  return { ok: false };
}

export async function handle(ctx, input) {
  const { replyId, upper, text } = input;
  const state = ctx.session.data?.state;

  // Invited by a friend ("Hi REF ABC123")
  const ref = upper.match(/\bREF\s+([A-Z0-9]{6})\b/);
  if (ref && ctx.isNew) {
    const referrer = await db.users.findOne({ product: 'yneet', refCode: ref[1] });
    if (referrer && referrer.phone !== ctx.phone) await ctx.setUser({ referredBy: referrer.phone });
  }
  if (!ctx.user.refCode) await ctx.setUser({ refCode: refCodeFor('yneet', ctx.phone) });

  if (replyId.startsWith('ans:') && state === 'quiz') {
    const done = await answerQuestion(ctx, replyId);
    if (done) await quizDone(ctx, done);
    return;
  }
  if (state === 'await_parent' && !replyId) return saveParent(ctx, text);

  const textCmd = {
    QUIZ: 'y:quiz', MOCK: 'y:mock', PLANS: 'y:plans', REPORT: 'y:report', REFER: 'y:refer', PARENT: 'y:parent',
    CHAPTER: 'y:chap', CHAPTERS: 'y:chap', PYQ: 'y:pyq', MISTAKES: 'y:mist', RANK: 'y:board', LEADERBOARD: 'y:board', CLASS: 'y:class', UNLOCK: 'y:plans',
  }[upper];
  const cmd = replyId || textCmd || '';
  const [, verb, a, b] = cmd.split(':');

  if (verb === 'cls') return setClass(ctx, a);
  if (!ctx.user.classLevel && !['class', 'quiz'].includes(verb) && !cmd.startsWith('ans:')) return askClass(ctx, true);

  switch (verb) {
    case 'quiz': return startChatQuiz(ctx, { n: ctx.cfg.dailyQuizSize, tag: 'daily', exclude: undefined });
    case 'mock': return startMock(ctx);
    case 'more': return moreMenu(ctx);
    case 'chap': return pickSubject(ctx);
    case 'subj': return listChapters(ctx, a, Number(b) || 0);
    case 'ch': return chapterCard(ctx, a, Number(b));
    case 'chq': return chapterQuick(ctx, a, Number(b));
    case 'cht': return chapterTest(ctx, a, Number(b));
    case 'pyq': return listYears(ctx, Number(a) || 0);
    case 'yr': return pyqTest(ctx, Number(a));
    case 'mist': return reviseMistakes(ctx);
    case 'board': return leaderboard(ctx);
    case 'report': return myReport(ctx);
    case 'plans': return showPlans(ctx);
    case 'buy': return buy(ctx, a);
    case 'refer': return refer(ctx);
    case 'class': return askClass(ctx, false);
    case 'remind': await ctx.setUser({ dailyOptIn: true }); return ctx.say('Done ✅ Your quiz comes every evening at 7 PM. Reply STOP anytime to turn it off.');
    case 'parent': await ctx.go('await_parent'); return ctx.say('Send your parent\'s 10-digit mobile number. They\'ll get a short progress report every Sunday.');
    default: break;
  }

  const pending = await pendingOrder(ctx);
  if (pending && !ctx.isNew) await ctx.link(`You were buying: ${pending.title} for ${rupees(pending.amount)}. Tap to finish.`, pending.link, 'Pay now');
  return menu(ctx);
}

// ---- Menus ----------------------------------------------------------------
async function askClass(ctx, first) {
  await ctx.list(
    first ? `Welcome to YNeet! 👋\nNEET practice from 3,600+ questions and real PYQs, right here on WhatsApp.\nYour number ${maskPhone(ctx.phone)} is your account.\n\nWhich class are you in?` : 'Which class are you in?',
    'Choose class', [{ title: 'Class', rows: ctx.cfg.classes.map((c) => ({ id: `y:cls:${c}`, title: c === 'Dropper' ? 'Dropper (repeater)' : `Class ${c}`, description: `Monthly plan ${rupees(monthlyPrice(ctx.cfg, c))}` })) }]);
}

async function setClass(ctx, cls) {
  if (!ctx.cfg.classes.includes(cls)) return askClass(ctx, false);
  await ctx.setUser({ classLevel: cls });
  if (['6th', '7th', '8th', '9th', '10th'].includes(cls)) await ctx.say(`Class ${cls} saved. The question bank follows the NEET (Class 11–12) syllabus, so start with easy questions and chapter practice to build a head start.`);
  return menu(ctx);
}

async function menu(ctx) {
  const u = ctx.user;
  const acc = await access(ctx);
  const name = u.name ? u.name.split(' ')[0] : '';
  const practised = await todayCount('yneet', 'quiz_done');
  const lines = [`Hi${name ? ' ' + name : ''}! 👋`];
  if (acc.ok) lines.push(`✅ Full access till ${fmtDate(acc.until)}${acc.via === 'web' ? ' (your YNeet plan)' : ''}`);
  if (u.streak?.count > 1) lines.push(`🔥 ${u.streak.count}-day streak`);
  if (credits(u)) lines.push(`🎁 ${credits(u)} free premium test${credits(u) > 1 ? 's' : ''}`);
  if ((u.mistakes || []).length) lines.push(`📌 ${u.mistakes.length} questions to revise`);
  if (practised) lines.push(`${practised} students practised today.`);
  lines.push('', 'What would you like to do?');
  await ctx.buttons(lines.join('\n'), [
    ['y:quiz', '📝 Daily quiz'],
    ['y:mock', !acc.ok && !u.freeMockUsed ? '🧪 Free NEET mock' : '🧪 NEET mock'],
    ['y:more', '⭐ More'],
  ]);
}

async function moreMenu(ctx) {
  const u = ctx.user;
  await ctx.list('Choose an option', 'Open', [{
    title: 'YNeet', rows: [
      { id: 'y:chap', title: '📚 Chapter practice', description: 'Physics, Chemistry, Biology: 98 chapters' },
      { id: 'y:pyq', title: '📜 Previous year papers', description: 'NEET PYQs 2016 onwards' },
      { id: 'y:mist', title: '📌 Revise mistakes', description: `${(u.mistakes || []).length} questions you got wrong` },
      { id: 'y:report', title: '📈 My progress', description: 'Scores and weak chapters' },
      { id: 'y:board', title: '🏆 Leaderboard', description: 'This week\'s top mock scores' },
      { id: 'y:plans', title: '💎 Plans & prices', description: `₹99 for 5 days · Monthly ${rupees(monthlyPrice(ctx.cfg, u.classLevel))}` },
      { id: 'y:refer', title: '👥 Invite friends', description: 'Free tests and a free month' },
      { id: 'y:parent', title: '👪 Parent report', description: 'Weekly progress to your parent' },
      { id: 'y:remind', title: '⏰ Daily 7 PM quiz', description: 'Keep your streak going' },
      { id: 'y:class', title: '🎓 Change class', description: u.classLevel ? `Now: ${u.classLevel}` : 'Set your class' },
    ],
  }]);
}

// ---- Premium test access -------------------------------------------------
// Returns how this test is unlocked ('plan' | 'free' | 'credit') or null after showing plans
async function unlock(ctx, kind) {
  const u = ctx.user;
  if ((await access(ctx)).ok) return 'plan';
  if (kind === 'mock' && !u.freeMockUsed) return 'free';
  if (kind === 'chapter' && !(u.chapterDay?.day === istDate() && u.chapterDay.count >= ctx.cfg.free.chapterTestsPerDay)) return 'free';
  if (credits(u) > 0) return 'credit';
  const why = { mock: 'You\'ve used your free NEET mock.', chapter: 'You\'ve used today\'s free chapter test.', pyq: 'Previous year papers are part of full access.' }[kind];
  await ctx.say(`${why} Unlock everything: unlimited mocks, chapter tests, PYQ papers and full analysis.`);
  await showPlans(ctx);
  return null;
}

async function consume(ctx, how, kind) {
  if (how === 'credit') await ctx.setUser({}, { $inc: { 'credits.test': -1 } });
  if (how === 'free' && kind === 'mock') await ctx.setUser({ freeMockUsed: true });
  if (kind === 'chapter') {
    const today = istDate();
    const c = ctx.user.chapterDay?.day === today ? ctx.user.chapterDay.count : 0;
    await ctx.setUser({ chapterDay: { day: today, count: c + 1 } });
  }
}

// ---- Daily quiz, mistakes ---------------------------------------------------
async function quizDone(ctx, quiz) {
  const tag = quiz.tag || '';
  await rememberMistakes(ctx, quiz.wrongIds || [], tag === 'mistakes' ? quiz.qids : []);
  if (tag === 'mistakes') {
    const left = (ctx.user.mistakes || []).length;
    return ctx.buttons(`Revision done: ${quiz.score}/${quiz.qids.length} correct. ${left ? `${left} questions left to revise.` : 'All mistakes cleared! 🎉'}`, [
      ...(left ? [['y:mist', '📌 Revise more']] : []), ['y:mock', '🧪 Take a mock'], ['y:more', '⭐ More'],
    ]);
  }
  if (tag.startsWith('chq:')) {
    const [, s, i] = tag.split(':');
    return ctx.buttons(`Score: ${quiz.score}/${quiz.qids.length}${quiz.wrong.length ? `\nRevise: ${[...new Set(quiz.wrong)].slice(0, 2).join(', ')}` : ''}`, [
      [`y:chq:${s}:${i}`, '🔁 5 more'], [`y:cht:${s}:${i}`, `📝 ${ctx.cfg.chapterTestSize}-Q test`], ['y:chap', 'Other chapters'],
    ]);
  }

  // Daily quiz
  await ctx.track('quiz_done', { score: quiz.score, of: quiz.qids.length });
  const streak = await bumpStreak(ctx);
  const msgs = [`Today's score: ${quiz.score}/${quiz.qids.length}`, `🔥 Streak: ${streak.count} day${streak.count > 1 ? 's' : ''}`];
  if (streak.count % ctx.cfg.streakReward === 0 && streak.rewarded !== false) {
    await ctx.setUser({}, { $inc: { 'credits.test': 1 } });
    msgs.push(`🎁 ${ctx.cfg.streakReward}-day streak reward: 1 free premium test added!`);
  } else {
    const left = ctx.cfg.streakReward - (streak.count % ctx.cfg.streakReward);
    msgs.push(`${left} more day${left > 1 ? 's' : ''} to earn a free premium test.`);
  }
  if (quiz.wrong.length) msgs.push(`Revise: ${[...new Set(quiz.wrong)].slice(0, 2).join(', ')}`);
  if (ctx.user.referredBy && !ctx.user.refRewarded) {
    const n = ctx.cfg.referralCredits;
    await ctx.setUser({ refRewarded: true }, { $inc: { 'credits.test': n } });
    const r = await db.users.updateOne({ product: 'yneet', phone: ctx.user.referredBy }, { $inc: { 'credits.test': n, referrals: 1 } });
    msgs.push('🎁 Your friend\'s invite gave you a free premium test.');
    if (r && within24h(r)) await send('yneet', r.phone, { type: 'text', text: '🎉 A friend you invited just took their first YNeet quiz. You both got a free premium test!' });
  }
  await ctx.say(msgs.join('\n'));
  const btns = [['y:mock', ctx.user.freeMockUsed ? '🧪 Take a mock' : '🧪 Free NEET mock']];
  btns.push(ctx.user.dailyOptIn ? ['y:chap', '📚 Chapter practice'] : ['y:remind', '⏰ Remind me 7 PM']);
  btns.push(['y:refer', '👥 Invite a friend']);
  await ctx.buttons(ctx.user.freeMockUsed ? 'Keep going:' : 'Your first full NEET mock (180 questions) is free. It shows exactly where you stand.', btns);
}

async function rememberMistakes(ctx, wrongIds, practisedIds) {
  const wrong = new Set(wrongIds);
  let list = (ctx.user.mistakes || []).filter((id) => !practisedIds.includes(id) || wrong.has(id));
  for (const id of wrongIds) if (!list.includes(id)) list.push(id);
  list = list.slice(-300);
  await ctx.setUser({ mistakes: list });
}

async function reviseMistakes(ctx) {
  const list = ctx.user.mistakes || [];
  if (!list.length) return ctx.buttons('No mistakes to revise yet. Questions you get wrong in quizzes and tests are saved here.', [['y:quiz', '📝 Daily quiz'], ['y:chap', '📚 Chapter practice']]);
  const qids = list.slice(-5).reverse();
  await ctx.say(`📌 Revising ${qids.length} of your ${list.length} saved mistakes. Get them right to clear them.`);
  return startChatQuiz(ctx, { qids, tag: 'mistakes' });
}

// ---- Chapter practice -----------------------------------------------------
async function pickSubject(ctx) {
  await ctx.buttons('📚 Chapter practice: pick a subject', SUBJECTS.map((s) => [`y:subj:${s[0]}:0`, `${SUBJ_ICON[s]} ${s}`]));
}
const subjectOf = (letter) => SUBJECTS.find((s) => s[0] === letter);

async function listChapters(ctx, letter, page) {
  const subject = subjectOf(letter);
  if (!subject) return pickSubject(ctx);
  const all = chapters(subject);
  const size = 9;
  const slice = all.slice(page * size, page * size + size);
  const rows = slice.map(([c, n], i) => ({ id: `y:ch:${letter}:${page * size + i}`, title: c, description: `${n} questions` }));
  if ((page + 1) * size < all.length) rows.push({ id: `y:subj:${letter}:${page + 1}`, title: '➡️ More chapters', description: `${all.length - (page + 1) * size} more` });
  else if (page > 0) rows.push({ id: `y:subj:${letter}:0`, title: '⬅️ First chapters' });
  await ctx.list(`${SUBJ_ICON[subject]} ${subject}: ${all.length} chapters${page ? ` (page ${page + 1})` : ''}`, 'Chapters', [{ title: subject, rows }]);
}

function chapterAt(letter, i) {
  const subject = subjectOf(letter);
  const ch = subject && chapters(subject)[i];
  return ch ? { subject, chapter: ch[0], count: ch[1] } : null;
}

async function chapterCard(ctx, letter, i) {
  const c = chapterAt(letter, i);
  if (!c) return pickSubject(ctx);
  const pyq = await db.questions.count({ product: 'yneet', subject: c.subject, topic: c.chapter, tags: 'pyq' });
  await ctx.buttons(`${SUBJ_ICON[c.subject]} ${c.chapter}\n${c.count} questions${pyq ? ` · ${pyq} from past NEET papers` : ''}`, [
    [`y:chq:${letter}:${i}`, '⚡ Quick 5 (free)'],
    [`y:cht:${letter}:${i}`, `📝 ${ctx.cfg.chapterTestSize}-Q test`],
    [`y:subj:${letter}:${Math.floor(i / 9)}`, 'Other chapters'],
  ]);
}

async function chapterQuick(ctx, letter, i) {
  const c = chapterAt(letter, i);
  if (!c) return pickSubject(ctx);
  const qs = await pickQuestions('yneet', 5, { subject: c.subject, where: { topic: c.chapter }, exclude: ctx.user.seenQ || [] });
  return startChatQuiz(ctx, { qids: qs.map((q) => q._id), tag: `chq:${letter}:${i}` });
}

async function chapterTest(ctx, letter, i) {
  const c = chapterAt(letter, i);
  if (!c) return pickSubject(ctx);
  const how = await unlock(ctx, 'chapter');
  if (!how) return;
  const qs = await pickQuestions('yneet', ctx.cfg.chapterTestSize, { subject: c.subject, where: { topic: c.chapter }, exclude: ctx.user.seenQ || [] });
  await consume(ctx, how, 'chapter');
  const url = await createMagicLink({ product: 'yneet', phone: ctx.phone, kind: 'chapter', ref: `${c.subject}:${c.chapter}`, title: `${c.chapter} · Chapter test`, qids: qs.map((q) => q._id), durationMin: Math.round(qs.length * 1.2), ttlMin: 30 });
  await ctx.link(`📝 ${c.chapter}\n${qs.length} questions · ${Math.round(qs.length * 1.2)} min · NEET marking${how === 'credit' ? '\n🎁 Free premium test used' : how === 'free' ? '\n(Today\'s free chapter test)' : ''}`, url, 'Start test');
}

// ---- PYQ papers ------------------------------------------------------------
async function listYears(ctx, page) {
  const years = pyqYears();
  const size = 9;
  const slice = years.slice(page * size, page * size + size);
  const rows = slice.map(([y, n]) => ({ id: `y:yr:${y}`, title: `NEET ${y}`, description: `${n} questions in the bank` }));
  if ((page + 1) * size < years.length) rows.push({ id: `y:pyq:${page + 1}`, title: '➡️ Older years' });
  await ctx.list(`📜 Previous year NEET questions\nEach test has ${ctx.cfg.pyqTestSize} real questions from that year, with explanations.`, 'Pick a year', [{ title: 'Years', rows }]);
}

async function pyqTest(ctx, year) {
  if (!year) return listYears(ctx, 0);
  const how = await unlock(ctx, 'pyq');
  if (!how) return;
  const qs = await pickQuestions('yneet', ctx.cfg.pyqTestSize, { where: { pyqYear: year }, exclude: ctx.user.seenQ || [] });
  if (!qs.length) return ctx.say(`No questions from NEET ${year} yet.`);
  await consume(ctx, how, 'pyq');
  const url = await createMagicLink({ product: 'yneet', phone: ctx.phone, kind: 'pyq', ref: String(year), title: `NEET ${year} PYQ test`, qids: qs.map((q) => q._id), durationMin: qs.length, ttlMin: 30 });
  await ctx.link(`📜 NEET ${year}: ${qs.length} previous year questions\n${qs.length} min · NEET marking${how === 'credit' ? '\n🎁 Free premium test used' : ''}`, url, 'Start test');
}

// ---- Full NEET mock ---------------------------------------------------------
async function startMock(ctx) {
  const how = await unlock(ctx, 'mock');
  if (!how) return;
  const seen = ctx.user.seenQ || [];
  const qs = [];
  for (const [subject, n] of Object.entries(ctx.cfg.mockPattern)) qs.push(...(await pickQuestions('yneet', n, { subject, exclude: seen })));
  if (!qs.length) return ctx.say('Mock tests are being prepared. Please try again soon.');
  const n = (ctx.user.mocksTaken || 0) + 1;
  await consume(ctx, how, 'mock');
  await ctx.setUser({ mocksTaken: n });
  const url = await createMagicLink({
    product: 'yneet', phone: ctx.phone, kind: 'mock', ref: `mock-${n}`, title: `NEET Mock ${n}`,
    qids: qs.map((q) => q._id), durationMin: ctx.cfg.mockMinutes, ttlMin: 30, meta: { how },
  });
  await ctx.link(`🧪 NEET Mock ${n}\n${qs.length} questions (Physics 45 · Chemistry 45 · Biology 90) · ${ctx.cfg.mockMinutes} min · +4/−1${how === 'free' ? '\nYour free mock 🎁' : how === 'credit' ? '\n🎁 Free premium test used' : ''}\nThe link works for 30 minutes; the timer starts when you open it.`, url, 'Start mock');
}

// Called after a web test is submitted
export async function onAttempt(ctx, a) {
  await rememberMistakes(ctx, a.wrongIds || [], []);
  const wrongAnswers = a.answered - a.correct;
  const net = Math.max(0, a.correct * 4 - wrongAnswers);
  const max = a.total * 4;
  const acc = await access(ctx);

  if (a.kind === 'mock') {
    const score = Math.round((net / max) * 720);
    await db.attempts.updateOne({ _id: a._id }, { $set: { score720: score } });
    await ctx.track('mock_done', { score });
    const subj = Object.entries(a.bySubject || {}).map(([s, v]) => `${SUBJ_ICON[s] || ''} ${s}: ${v.correct}/${v.total}`);
    const lines = [`📊 ${a.title}`, `Score: ${score}/720`, `Correct ${a.correct} · Wrong ${wrongAnswers} · Skipped ${a.total - a.answered}`, ...subj];
    if (acc.ok) {
      const [lo, hi] = estimateNeetRank(score);
      lines.push('', `Estimated rank range: ${fmtNum(lo)} – ${fmtNum(hi)}`, '(Estimate based on past NEET score-to-rank trends.)');
      if (a.weak?.length) lines.push(`Revise first: ${a.weak.slice(0, 3).join(', ')}`);
      lines.push(`📌 ${(a.wrongIds || []).length} wrong answers saved to "Revise mistakes".`);
      await ctx.say(lines.join('\n'));
      return ctx.buttons('Next step:', [['y:mist', '📌 Revise mistakes'], ['y:board', '🏆 Leaderboard'], ['y:mock', '🧪 Next mock']]);
    }
    if (a.weak?.[0]) lines.push(`Weakest chapter: ${a.weak[0]}`);
    await ctx.say(lines.join('\n'));
    return ctx.buttons(`🔓 Unlock your estimated NEET rank, chapter-wise revision list and unlimited mocks: ₹99 for 5 days.`, [['y:buy:trial5d', '₹99 · 5 days'], ['y:plans', 'All plans'], ['y:mist', '📌 Revise mistakes']]);
  }

  // Chapter and PYQ tests
  const pct = Math.round((a.correct / Math.max(1, a.total)) * 100);
  const lines = [`📊 ${a.title}`, `Score: ${net}/${max} (${a.correct}/${a.total} correct, ${pct}%)`];
  if (a.weak?.length) lines.push(`Weak topics: ${a.weak.slice(0, 3).join(', ')}`);
  lines.push('Explanations for every question are on the result page.');
  if (wrongAnswers) lines.push(`📌 ${(a.wrongIds || []).length} wrong answers saved for revision.`);
  await ctx.say(lines.join('\n'));
  await ctx.buttons('Next:', [['y:mist', '📌 Revise mistakes'], a.kind === 'pyq' ? ['y:pyq', '📜 Another year'] : ['y:chap', '📚 Another chapter'], ['y:mock', '🧪 Full mock']]);
}

// ---- Plans and payment ------------------------------------------------------
async function showPlans(ctx) {
  const u = ctx.user;
  const cls = u.classLevel || '12th';
  const t = ctx.cfg.trial;
  const m = monthlyPrice(ctx.cfg, cls);
  const acc = await access(ctx);
  const head = [`💎 YNeet full access (same plans as app.yneet.in)`, '• Unlimited NEET-pattern mocks (180 Qs)', '• Every chapter test and PYQ paper', '• Estimated rank and revision list', '• Weekly parent report'];
  if (acc.ok) head.push('', `✅ You have full access till ${fmtDate(acc.until)}.`);
  await ctx.list(head.join('\n'), 'See plans', [{
    title: 'Plans', rows: [
      { id: 'y:buy:trial5d', title: `${t.title} · ${rupees(t.price)}`, description: 'Try everything for 5 days' },
      { id: 'y:buy:monthly', title: `⭐ Monthly · ${rupees(m)}`, description: `Class ${cls} price · till ${fmtDate(endOfMonthIST())}` },
    ],
  }]);
  const f = offerFooter();
  if (f) await ctx.say(`⏳ ${f}`);
}

async function buy(ctx, id) {
  const cls = ctx.user.classLevel || '12th';
  const plan = id === 'monthly'
    ? { item: 'monthly', key: 'MONTHLY', title: `YNeet Monthly (Class ${cls})`, price: monthlyPrice(ctx.cfg, cls) }
    : { item: 'trial5d', key: 'TRIAL_5D', title: `YNeet ${ctx.cfg.trial.title}`, price: ctx.cfg.trial.price };
  const order = await createOrder({ product: 'yneet', phone: ctx.phone, item: plan.item, title: plan.title, amount: plan.price, meta: { key: plan.key, classLevel: cls } });
  await ctx.link(`${plan.title} · ${rupees(plan.price)}\nPay with any UPI app. Access starts right after payment${bridge.enabled() ? ', on WhatsApp and app.yneet.in' : ''}.`, order.link, 'Pay by UPI');
}

export async function onPaid(ctx, order) {
  const now = new Date();
  const current = active(ctx.user.plan?.until) ? new Date(ctx.user.plan.until) : now;
  const until = order.item === 'monthly' ? endOfMonthIST(current) : new Date(current.getTime() + ctx.cfg.trial.days * DAY);
  await ctx.setUser({ plan: { id: order.item, since: now, until } });
  let web = false;
  if (bridge.enabled()) {
    try {
      web = await bridge.grant({ phone: ctx.phone, planKey: order.meta?.key || (order.item === 'monthly' ? 'MONTHLY' : 'TRIAL_5D'), start: now, end: until, amountPaise: Math.round(order.amount * 100), paymentId: order.paymentId });
    } catch (e) { console.error('[yneet] could not update app.yneet.in subscription', e); }
  }
  await ctx.say(`✅ Payment received: ${rupees(order.amount)}\nFull access till ${fmtDate(until)}.${web ? '\nYour app.yneet.in account is unlocked too.' : bridge.enabled() ? `\nTo use app.yneet.in too, sign up there with this WhatsApp number (${maskPhone(ctx.phone)}).` : ''}`);

  // YNeet's referral rule: first monthly purchase by an invited student → inviter gets a free month
  if (order.item === 'monthly' && ctx.user.referredBy && !ctx.user.refPaidRewarded) {
    await ctx.setUser({ refPaidRewarded: true });
    const inv = await db.users.findOne({ product: 'yneet', phone: ctx.user.referredBy });
    if (inv) {
      const from = active(inv.plan?.until) ? new Date(inv.plan.until) : new Date();
      const plan = { id: inv.plan?.id || 'referral', since: inv.plan?.since || new Date(), until: new Date(from.getTime() + ctx.cfg.referralMonthDays * DAY) };
      const updated = await db.users.updateOne({ _id: inv._id }, { $set: { plan }, $inc: { paidReferrals: 1 } });
      if (within24h(updated)) await send('yneet', inv.phone, { type: 'text', text: `🎉 A friend you invited just bought YNeet Monthly. You got 1 month of full access free, till ${fmtDate(plan.until)}!` });
    }
  }
  if (!ctx.user.parentPhone) await ctx.buttons('Want a weekly progress report sent to your parent?', [['y:parent', '👪 Add parent'], ['y:mock', '🧪 Start a mock']]);
  else await ctx.buttons('What next?', [['y:mock', '🧪 Start a mock'], ['y:chap', '📚 Chapter test']]);
}

// ---- Progress, leaderboard, referrals, parents --------------------------------
async function myReport(ctx) {
  const list = await db.attempts.find({ product: 'yneet', phone: ctx.phone }, { sort: { at: -1 }, limit: 6 });
  if (!list.length) return ctx.buttons('No tests yet. Your first full NEET mock is free.', [['y:mock', '🧪 Free NEET mock'], ['y:chap', '📚 Chapter practice']]);
  const lines = ['📈 Your recent tests', ...list.map((a) => (a.kind === 'mock' ? `${a.title}: ${a.score720 ?? '-'}/720` : `${a.title}: ${a.correct}/${a.total}`))];
  const weak = {};
  for (const a of list) for (const w of a.weak || []) weak[w] = (weak[w] || 0) + 1;
  const top = Object.entries(weak).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w]) => w);
  if (top.length) lines.push('', `Weak chapters: ${top.join(', ')}`);
  if (ctx.user.streak?.count) lines.push(`🔥 Quiz streak: ${ctx.user.streak.count} days`);
  if ((ctx.user.mistakes || []).length) lines.push(`📌 ${ctx.user.mistakes.length} mistakes saved for revision`);
  await ctx.buttons(lines.join('\n'), [['y:mock', '🧪 Next mock'], ['y:mist', '📌 Revise mistakes'], ['y:board', '🏆 Leaderboard']]);
}

async function leaderboard(ctx) {
  const since = new Date(Date.now() - 7 * DAY);
  const atts = await db.attempts.find({ product: 'yneet', kind: 'mock', at: { $gte: since } });
  const best = new Map();
  for (const a of atts) if (!best.has(a.phone) || (a.score720 ?? 0) > (best.get(a.phone).score720 ?? 0)) best.set(a.phone, a);
  const ranked = [...best.values()].sort((x, y) => (y.score720 ?? 0) - (x.score720 ?? 0));
  if (!ranked.length) return ctx.buttons('🏆 No mocks taken this week yet. Be the first on the board!', [['y:mock', '🧪 Take a mock']]);
  const label = (a) => (a.name ? `${a.name.split(' ')[0]} ${a.name.split(' ')[1]?.[0] || ''}`.trim() : maskPhone(a.phone));
  const medal = ['🥇', '🥈', '🥉'];
  const lines = ['🏆 This week\'s top NEET mock scores', ...ranked.slice(0, 10).map((a, i) => `${medal[i] || `${i + 1}.`} ${label(a)}: ${a.score720}/720`)];
  const mine = ranked.findIndex((a) => a.phone === ctx.phone);
  lines.push('', mine >= 0 ? `You: #${mine + 1} of ${ranked.length} (${ranked[mine].score720}/720)` : `${ranked.length} students on the board. Take a mock to join!`);
  await ctx.buttons(lines.join('\n'), [['y:mock', '🧪 Take a mock'], ['y:refer', '👥 Challenge a friend']]);
}

async function refer(ctx) {
  const link = waLink(config.wa.displayNumbers.yneet, `Hi REF ${ctx.user.refCode}`);
  await ctx.say(`👥 Invite friends to YNeet\n• When a friend takes their first quiz, you BOTH get a free premium test (mock, chapter test or PYQ paper)\n• When a friend buys the Monthly plan, you get 1 month of full access free\n\nFriends who bought: ${ctx.user.paidReferrals || 0}\n\nForward the message below 👇`);
  await ctx.say(`I'm practising NEET on WhatsApp with YNeet: 3,600+ questions, real PYQs, chapter tests and a free full mock. Try it: ${link || 'message YNeet and send REF ' + ctx.user.refCode}`);
}

async function saveParent(ctx, text) {
  const digits = String(text).replace(/\D/g, '');
  const num = digits.length === 10 ? '91' + digits : digits.length === 12 && digits.startsWith('91') ? digits : null;
  if (!num) return ctx.say('That doesn\'t look like a mobile number. Send 10 digits, like 9876543210. Or send MENU to skip.');
  if (num === ctx.phone) return ctx.say('That\'s your own number. Please send your parent\'s number, or MENU to skip.');
  await ctx.setUser({ parentPhone: num });
  await ctx.go('idle');
  await ctx.say(`✅ Saved. Your parent (${maskPhone(num)}) will get a short report every Sunday: quizzes, mock scores and chapters to revise.`);
  return menu(ctx);
}
