// YNeet: NEET student flow.
// Funnel: Hi → daily 3-question quiz (habit) → free full mock via magic link → free score
//         → paid analysis (₹49) or the 10-mock pack (best value) or season pass.
// Retention: streak rewards, referral credits, 7 PM reminder, weekly parent report.
import { db } from '../store.js';
import { config } from '../config.js';
import { pickQuestions } from '../questions.js';
import { createMagicLink } from '../magic.js';
import { createOrder } from '../payments.js';
import { refCodeFor, maskPhone, estimateNeetRank, fmtNum, waLink } from '../util.js';
import { rupees } from '../products.js';
import { startChatQuiz, answerQuestion, bumpStreak, todayCount, offerFooter, priceLine, pendingOrder } from './common.js';

const NEET_DATE = process.env.NEET_DATE || '2027-05-02';

const hasSeason = (u) => u.plan?.id === 'season' && new Date(u.plan.until) > new Date();
const credits = (u) => u.credits?.analysis || 0;

export async function handle(ctx, input) {
  const { replyId, upper, text } = input;
  const state = ctx.session.data?.state;

  // New student who came from a friend's referral link ("Hi REF ABC123")
  const ref = upper.match(/\bREF\s+([A-Z0-9]{6})\b/);
  if (ref && ctx.isNew) {
    const referrer = await db.users.findOne({ product: 'yneet', refCode: ref[1] });
    if (referrer && referrer.phone !== ctx.phone) await ctx.setUser({ referredBy: referrer.phone });
  }
  if (!ctx.user.refCode) await ctx.setUser({ refCode: refCodeFor('yneet', ctx.phone) });

  if (replyId.startsWith('ans:') && state === 'quiz') {
    const done = await answerQuestion(ctx, replyId);
    if (done) await dailyQuizDone(ctx, done);
    return;
  }
  if (state === 'await_parent' && !replyId) return saveParent(ctx, text);

  const cmd = replyId || ({ QUIZ: 'y:quiz', MOCK: 'y:mock', PLANS: 'y:plans', REPORT: 'y:report', REFER: 'y:refer', PARENT: 'y:parent', UNLOCK: 'y:unlock' })[upper] || '';

  if (cmd === 'y:quiz') return startDailyQuiz(ctx);
  if (cmd === 'y:mock') return startMock(ctx);
  if (cmd === 'y:plans') return showPlans(ctx);
  if (cmd === 'y:more') return moreMenu(ctx);
  if (cmd === 'y:report') return myReport(ctx);
  if (cmd === 'y:refer') return refer(ctx);
  if (cmd === 'y:parent') { await ctx.go('await_parent'); return ctx.say('Send your parent\'s 10-digit mobile number. They\'ll get a short progress report every Sunday.'); }
  if (cmd === 'y:remind') { await ctx.setUser({ dailyOptIn: true }); return ctx.say('Done ✅ I\'ll send your quiz every evening at 7 PM. Reply STOP anytime to turn it off.'); }
  if (cmd === 'y:unlock') return unlockLatest(ctx);
  if (cmd.startsWith('y:use:')) return useCredit(ctx, cmd.slice(6));
  if (cmd.startsWith('buy:')) return buy(ctx, cmd.slice(4));

  // Anything else: if they left a payment unfinished, bring it back first
  const pending = await pendingOrder(ctx);
  if (pending && !ctx.isNew) {
    await ctx.link(`You were unlocking: ${pending.title} for ${rupees(pending.amount)}. Tap to finish.`, pending.link, 'Pay now');
  }
  return menu(ctx);
}

async function menu(ctx) {
  const u = ctx.user;
  const name = u.name ? u.name.split(' ')[0] : '';
  const practised = await todayCount('yneet', 'quiz_done');
  const lines = [
    ctx.isNew
      ? `Welcome to YNeet${name ? ', ' + name : ''}! 👋\nYour number ${maskPhone(ctx.phone)} is your account. No password, no app.`
      : `Hi${name ? ' ' + name : ''}! 👋`,
  ];
  if (u.streak?.count > 1) lines.push(`🔥 ${u.streak.count}-day streak. Keep it going!`);
  if (credits(u)) lines.push(`🎁 You have ${credits(u)} free analysis ${credits(u) > 1 ? 'credits' : 'credit'}.`);
  if (practised) lines.push(`${practised} students practised today.`);
  lines.push('', 'What would you like to do?');
  await ctx.buttons(lines.join('\n'), [
    ['y:quiz', '📝 Daily quiz'],
    ['y:mock', u.freeMockUsed ? '🧪 Mock test' : '🧪 Free mock test'],
    ['y:more', '⭐ Plans & more'],
  ]);
}

async function moreMenu(ctx) {
  await ctx.list('More options', 'Open', [{
    title: 'YNeet', rows: [
      { id: 'y:plans', title: 'Plans & prices', description: 'Mock packs and season pass' },
      { id: 'y:report', title: 'My progress', description: 'Scores from your recent tests' },
      { id: 'y:refer', title: 'Invite a friend', description: 'You both get a free analysis' },
      { id: 'y:parent', title: 'Add parent\'s number', description: 'Weekly progress report every Sunday' },
      { id: 'y:remind', title: 'Daily 7 PM reminder', description: 'Get the quiz every evening' },
    ],
  }]);
}

async function startDailyQuiz(ctx) {
  await startChatQuiz(ctx, { n: ctx.cfg.dailyQuizSize, tag: 'daily' });
}

async function dailyQuizDone(ctx, quiz) {
  await ctx.track('quiz_done', { score: quiz.score, of: quiz.qids.length });
  const streak = await bumpStreak(ctx);
  const msgs = [`Today's score: ${quiz.score}/${quiz.qids.length}`, `🔥 Streak: ${streak.count} day${streak.count > 1 ? 's' : ''}`];

  if (streak.count % ctx.cfg.streakReward === 0 && streak.rewarded !== false) {
    await ctx.setUser({}, { $inc: { 'credits.analysis': 1 } });
    msgs.push(`🎁 ${ctx.cfg.streakReward}-day streak reward: 1 free full analysis added!`);
  } else {
    const left = ctx.cfg.streakReward - (streak.count % ctx.cfg.streakReward);
    msgs.push(`${left} more day${left > 1 ? 's' : ''} to earn a free full analysis.`);
  }
  if (quiz.wrong.length) msgs.push(`Revise: ${[...new Set(quiz.wrong)].slice(0, 2).join(', ')}`);

  // Referral reward on the friend's first quiz
  if (ctx.user.referredBy && !ctx.user.refRewarded) {
    await ctx.setUser({ refRewarded: true }, { $inc: { 'credits.analysis': ctx.cfg.referralReward } });
    await db.users.updateOne({ product: 'yneet', phone: ctx.user.referredBy }, { $inc: { 'credits.analysis': ctx.cfg.referralReward, referrals: 1 } });
    msgs.push('🎁 Your friend\'s invite gave you 1 free analysis.');
  }
  await ctx.say(msgs.join('\n'));

  const btns = [['y:mock', ctx.user.freeMockUsed ? '🧪 Take a mock' : '🧪 Free full mock']];
  if (!ctx.user.dailyOptIn) btns.push(['y:remind', '⏰ Remind me 7 PM']);
  btns.push(['y:refer', '👥 Invite a friend']);
  await ctx.buttons(ctx.user.freeMockUsed ? 'Ready for a full mock?' : 'Your first full NEET mock is free. It shows where you stand today.', btns);
}

async function startMock(ctx) {
  const u = ctx.user;
  let paidWith = null;
  if (!u.freeMockUsed) paidWith = 'free';
  else if (hasSeason(u)) paidWith = 'season';
  else if ((u.mockCredits || 0) > 0) paidWith = 'credit';
  if (!paidWith) {
    await ctx.say('You\'ve used your free mock. Get more mocks with full analysis:');
    return showPlans(ctx);
  }
  const qs = await pickQuestions('yneet', ctx.cfg.mockSize, { exclude: u.seenQ || [] });
  if (!qs.length) return ctx.say('Mock tests are being prepared. Please try again soon.');
  const n = (u.mocksTaken || 0) + 1;
  const url = await createMagicLink({
    product: 'yneet', phone: ctx.phone, kind: 'mock', ref: `mock-${n}`, title: `NEET Mock ${n}`,
    qids: qs.map((q) => q._id), durationMin: Math.max(20, Math.round(qs.length * 1.07)), ttlMin: 30, meta: { paidWith },
  });
  const patch = { mocksTaken: n };
  if (paidWith === 'free') patch.freeMockUsed = true;
  await ctx.setUser(patch, paidWith === 'credit' ? { $inc: { mockCredits: -1 } } : {});
  await ctx.link(`🧪 NEET Mock ${n} · ${qs.length} questions\nYou'll be logged in automatically. The link works for 30 minutes.`, url, 'Start test');
}

// Called after the web test is submitted
export async function onAttempt(ctx, a) {
  const net = Math.max(0, a.correct * 4 - (a.answered - a.correct));
  const score = Math.round((net / (a.total * 4)) * 720);
  await db.attempts.updateOne({ _id: a._id }, { $set: { score720: score } });
  const weak = a.weak[0];
  await ctx.track('mock_done', { score });
  await ctx.say(`📊 ${a.title} result\nScore: ${score}/720\nCorrect: ${a.correct} of ${a.total}${weak ? `\nWeakest topic: ${weak}` : ''}`);

  if (hasSeason(ctx.user)) return sendAnalysis(ctx, { ...a, score720: score });
  if (credits(ctx.user) > 0) {
    return ctx.buttons(`You have ${credits(ctx.user)} free analysis credit. Use it to see your chapter-wise accuracy and estimated rank?`, [[`y:use:${a._id}`, '🎁 Use free credit']]);
  }
  await ctx.setSession({ lastAttemptId: a._id });
  return showPlans(ctx, a._id, true);
}

async function showPlans(ctx, attemptId = ctx.session.data?.lastAttemptId, afterTest = false) {
  const o = ctx.cfg.offers;
  const tag = attemptId ? `:${attemptId}` : '';
  const rows = [
    ...(attemptId ? [{ id: `buy:analysis${tag}`, title: `Analysis · ${rupees(o.analysis.price)}`, description: 'This test: chapter accuracy, estimated rank, what to revise' }] : []),
    { id: `buy:pack10${tag}`, title: `⭐ 10 mocks · ${rupees(o.pack10.price)}`, description: `Best value. Was ${rupees(o.pack10.anchor)}. Analysis for every mock${attemptId ? ', including this one' : ''}.` },
    { id: `buy:season${tag}`, title: `Season pass · ${rupees(o.season.price)}`, description: `Unlimited mocks till NEET + parent reports. Was ${rupees(o.season.anchor)}.` },
  ];
  const body = afterTest
    ? 'Your full analysis is ready to unlock: chapter-wise accuracy, estimated all-India rank and a revision list.\n\nMost students pick the 10-mock pack: it costs ₹20 per mock and includes this analysis.'
    : `Plans for NEET ${NEET_DATE.slice(0, 4)}:\n• 10 mocks + analysis: ${priceLine(o.pack10)}\n• Season pass: ${priceLine(o.season)}`;
  await ctx.list(body, 'See options', [{ title: 'Choose a plan', rows }]);
  const f = offerFooter();
  if (f) await ctx.say(`⏳ ${f}`);
}

async function buy(ctx, arg) {
  const [offerId, attemptId] = arg.split(':');
  const offer = ctx.cfg.offers[offerId];
  if (!offer) return menu(ctx);
  const order = await createOrder({
    product: 'yneet', phone: ctx.phone, item: offerId, title: `YNeet ${offer.title}`, amount: offer.price, meta: { attemptId: attemptId || null },
  });
  await ctx.link(`${offer.title} · ${rupees(offer.price)}\nPay with any UPI app. Your ${offerId === 'analysis' ? 'report' : 'plan'} arrives here right after payment.`, order.link, 'Pay by UPI');
}

export async function onPaid(ctx, order) {
  const { attemptId } = order.meta || {};
  if (order.item === 'analysis') {
    await ctx.say(`✅ Payment received: ${rupees(order.amount)}`);
    if (attemptId) return sendAnalysis(ctx, await db.attempts.findOne({ _id: attemptId }));
  }
  if (order.item === 'pack10') {
    await ctx.setUser({}, { $inc: { mockCredits: 10, 'credits.analysis': 10 } });
    await ctx.say(`✅ Payment received: ${rupees(order.amount)}\n10 mocks with analysis added to your account.`);
    if (attemptId) await useCredit(ctx, attemptId, true);
  }
  if (order.item === 'season') {
    await ctx.setUser({ plan: { id: 'season', since: new Date(), until: new Date(NEET_DATE + 'T23:59:59+05:30') } });
    await ctx.say(`✅ Payment received: ${rupees(order.amount)}\nSeason pass active till NEET. Unlimited mocks with full analysis.`);
    if (attemptId) await sendAnalysis(ctx, await db.attempts.findOne({ _id: attemptId }));
    if (!ctx.user.parentPhone) await ctx.buttons('Want a weekly report sent to your parent?', [['y:parent', '👪 Add parent']]);
  }
  await ctx.buttons('What next?', [['y:mock', '🧪 Start a mock'], ['y:quiz', '📝 Daily quiz']]);
}

async function useCredit(ctx, attemptId, silent = false) {
  const a = await db.attempts.findOne({ _id: attemptId, phone: ctx.phone });
  if (!a) return ctx.say('I couldn\'t find that test. Send MOCK to take a new one.');
  if (a.analysisUnlocked) return sendAnalysis(ctx, a);
  if (credits(ctx.user) <= 0) return showPlans(ctx, attemptId, true);
  await ctx.setUser({}, { $inc: { 'credits.analysis': -1 } });
  if (!silent) await ctx.say('🎁 Free credit used.');
  return sendAnalysis(ctx, a);
}

async function unlockLatest(ctx) {
  const [a] = await db.attempts.find({ product: 'yneet', phone: ctx.phone }, { sort: { at: -1 }, limit: 1 });
  if (!a) return ctx.say('You haven\'t taken a mock yet. Send MOCK to start one.');
  if (credits(ctx.user) > 0 || a.analysisUnlocked) return useCredit(ctx, a._id);
  return showPlans(ctx, a._id, true);
}

async function sendAnalysis(ctx, a) {
  if (!a) return;
  await db.attempts.updateOne({ _id: a._id }, { $set: { analysisUnlocked: true } });
  const subj = Object.entries(a.bySubject || {}).map(([s, v]) => `${s}: ${Math.round((v.correct / v.total) * 100)}% (${v.correct}/${v.total})`);
  const [lo, hi] = estimateNeetRank(a.score720 ?? 0);
  const lines = [
    `📊 Full analysis · ${a.title}`,
    `Score: ${a.score720}/720`,
    ...subj,
    '',
    `Estimated rank range: ${fmtNum(lo)} – ${fmtNum(hi)}`,
    '(Estimate based on past NEET score-to-rank trends. Real ranks depend on the year.)',
  ];
  if (a.weak?.length) lines.push('', `Revise first: ${a.weak.slice(0, 3).join(', ')}`);
  lines.push('', 'Tip: take one mock every week. Students who do this see their weak topics shrink fastest.');
  await ctx.say(lines.join('\n'));
}

async function myReport(ctx) {
  const list = await db.attempts.find({ product: 'yneet', phone: ctx.phone }, { sort: { at: -1 }, limit: 5 });
  if (!list.length) return ctx.buttons('No mock tests yet. Your first one is free.', [['y:mock', '🧪 Free mock test']]);
  const lines = ['📈 Your recent mocks', ...list.map((a) => `${a.title}: ${a.score720 ?? '-'}/720`)];
  if (ctx.user.streak?.count) lines.push('', `🔥 Quiz streak: ${ctx.user.streak.count} days`);
  await ctx.buttons(lines.join('\n'), [['y:mock', '🧪 Next mock'], ['y:unlock', '🔓 Latest analysis']]);
}

async function refer(ctx) {
  const link = waLink(config.wa.displayNumbers.yneet, `Hi REF ${ctx.user.refCode}`);
  const shareText = `I'm practising NEET on WhatsApp with YNeet: daily quiz + a free full mock. Try it: ${link || 'message YNeet and send REF ' + ctx.user.refCode}`;
  await ctx.say(`👥 Invite friends. When a friend takes their first quiz, you BOTH get a free full analysis (worth ${rupees(ctx.cfg.offers.analysis.price)}).\n\nForward the message below to your friends or class group 👇`);
  await ctx.say(shareText);
}

async function saveParent(ctx, text) {
  const digits = String(text).replace(/\D/g, '');
  const num = digits.length === 10 ? '91' + digits : digits.length === 12 && digits.startsWith('91') ? digits : null;
  if (!num) return ctx.say('That doesn\'t look like a mobile number. Send 10 digits, like 9876543210. Or send MENU to skip.');
  if (num === ctx.phone) return ctx.say('That\'s your own number. Please send your parent\'s number, or MENU to skip.');
  await ctx.setUser({ parentPhone: num });
  await ctx.go('idle');
  await ctx.say(`✅ Saved. Your parent (${maskPhone(num)}) will get a short report every Sunday: tests taken, scores and topics to revise.`);
  return menu(ctx);
}
