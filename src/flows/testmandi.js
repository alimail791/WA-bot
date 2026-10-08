// TestMandi: test marketplace flow.
// Funnel: seller's share link ("TEST CODE") → test card with real rating/attempts → free sample in chat
//         → UPI purchase → magic link → result with rank among buyers → rating → seller's bundle / similar tests.
// Sellers: instant sale alerts with their share, "SELLER" shows earnings and share links.
import { db } from '../store.js';
import { config } from '../config.js';
import { createMagicLink } from '../magic.js';
import { createOrder } from '../payments.js';
import { send } from '../providers/index.js';
import { rupees } from '../products.js';
import { maskPhone, fmtNum, waLink, istDate } from '../util.js';
import { within24h } from '../engine.js';
import { startChatQuiz, answerQuestion, pendingOrder } from './common.js';

const shareLink = (code) => waLink(config.wa.displayNumbers.testmandi, `TEST ${code}`);
const rating = (t) => (t.ratingCount >= 5 ? `⭐ ${(t.ratingSum / t.ratingCount).toFixed(1)} (${fmtNum(t.ratingCount)} ratings)` : '🆕 New test');
const owns = (u, code) => (u.purchases || []).includes(code);

export async function handle(ctx, input) {
  const { replyId, upper } = input;
  const state = ctx.session.data?.state;

  if (replyId.startsWith('ans:') && state === 'quiz') {
    const done = await answerQuestion(ctx, replyId);
    if (done) await sampleDone(ctx, done);
    return;
  }

  const m = upper.match(/^(?:TEST|BUY)\s+([A-Z0-9-]{3,})/);
  if (m) return showTest(ctx, m[1]);
  if (upper === 'SELLER' || upper === 'MY SALES') return sellerStats(ctx);

  const [cmd, a, b] = replyId.split(':').slice(1);
  if (replyId.startsWith('tm:')) {
    if (cmd === 'card') return showTest(ctx, a);
    if (cmd === 'sample') return startSample(ctx, a);
    if (cmd === 'buy') return buy(ctx, a);
    if (cmd === 'bundle') return buyBundle(ctx, a);
    if (cmd === 'start') return sendLink(ctx, a);
    if (cmd === 'rate') return rate(ctx, a, Number(b));
    if (cmd === 'browse') return browse(ctx);
    if (cmd === 'mine') return myTests(ctx);
    if (cmd === 'sell') return sellInfo(ctx);
    if (cmd === 'sales') return sellerStats(ctx);
  }

  const pending = await pendingOrder(ctx);
  if (pending && !ctx.isNew) await ctx.link(`You were buying: ${pending.title} for ${rupees(pending.amount)}. Tap to finish.`, pending.link, 'Pay now');
  return menu(ctx);
}

async function menu(ctx) {
  const isSeller = await db.tests.count({ sellerPhone: ctx.phone });
  await ctx.buttons(
    `${ctx.isNew ? 'Welcome to TestMandi! 👋\nMock tests from top teachers, right here on WhatsApp.\nYour number ' + maskPhone(ctx.phone) + ' is your account.' : 'Hi! 👋'}\n\nWhat would you like to do?`,
    [['tm:browse', '🔎 Browse tests'], ['tm:mine', '📚 My tests'], isSeller ? ['tm:sales', '💰 My sales'] : ['tm:sell', 'Sell your tests']],
  );
}

async function showTest(ctx, code) {
  const t = await db.tests.findOne({ code });
  if (!t) return ctx.say(`I couldn't find test "${code}". Check the code, or send MENU to browse tests.`);
  if (t.type === 'bundle') return showBundle(ctx, t);
  await ctx.track('test_view', { code });
  if (owns(ctx.user, code)) {
    const done = await db.attempts.findOne({ product: 'testmandi', phone: ctx.phone, ref: code });
    if (!done) return ctx.buttons(`You already own ${t.title}.`, [[`tm:start:${code}`, '▶️ Start test']]);
  }
  const lines = [
    `📘 ${t.title}`,
    `By ${t.sellerName} · ${rating(t)}`,
    `${t.qids.length} questions · ${t.durationMin} min${t.language ? ' · ' + t.language : ''}`,
  ];
  if (t.attemptsCount >= 10) lines.push(`${fmtNum(t.attemptsCount)} students have taken it`);
  lines.push('', `Price: ${t.anchor ? `${rupees(t.price)} (was ${rupees(t.anchor)})` : rupees(t.price)}`, 'Includes explanations and your rank among all buyers.');
  const bundle = await db.tests.findOne({ type: 'bundle', testCodes: code });
  const btns = [];
  if (ctx.cfg.freeSample > 0 && !(ctx.user.sampled || []).includes(code)) btns.push([`tm:sample:${code}`, `Try ${Math.min(ctx.cfg.freeSample, t.qids.length)} free Qs`]);
  btns.push([`tm:buy:${code}`, `Buy · ${rupees(t.price)}`]);
  if (bundle) btns.push([`tm:card:${bundle.code}`, `🎁 Pack of ${bundle.testCodes.length}`]);
  await ctx.buttons(lines.join('\n'), btns);
}

async function showBundle(ctx, b) {
  const tests = await db.tests.find({ code: { $in: b.testCodes } });
  const total = tests.reduce((s, t) => s + t.price, 0);
  const save = total - b.price;
  await ctx.buttons(
    `🎁 ${b.title}\nBy ${b.sellerName}\n${tests.map((t) => '• ' + t.title).join('\n')}\n\nPack price: ${rupees(b.price)}${save > 0 ? `\nBought one by one: ${rupees(total)}. You save ${rupees(save)}.` : ''}`,
    [[`tm:bundle:${b.code}`, `Buy pack · ${rupees(b.price)}`], ...(tests[0] ? [[`tm:card:${tests[0].code}`, 'See single test']] : [])],
  );
}

async function startSample(ctx, code) {
  const t = await db.tests.findOne({ code });
  if (!t) return menu(ctx);
  await ctx.setUser({ sampled: [...(ctx.user.sampled || []), code] });
  await ctx.say(`Free sample from ${t.title} 👇`);
  await startChatQuiz(ctx, { qids: t.qids.slice(0, ctx.cfg.freeSample), tag: `sample:${code}` });
}

async function sampleDone(ctx, quiz) {
  const code = quiz.tag.split(':')[1];
  const t = await db.tests.findOne({ code });
  await ctx.track('sample_done', { code, score: quiz.score });
  const buyers = await db.attempts.count({ product: 'testmandi', ref: code });
  await ctx.buttons(
    `Sample score: ${quiz.score}/${quiz.qids.length}\n\nThe full test has ${t.qids.length} questions with explanations${buyers >= 10 ? ` and your rank among ${fmtNum(buyers)} students` : ' and your rank among buyers'}.`,
    [[`tm:buy:${code}`, `Buy · ${rupees(t.price)}`], ['tm:browse', 'Other tests']],
  );
}

async function buy(ctx, code) {
  const t = await db.tests.findOne({ code });
  if (!t) return menu(ctx);
  if (owns(ctx.user, code)) return sendLink(ctx, code);
  const order = await createOrder({ product: 'testmandi', phone: ctx.phone, item: `test:${code}`, title: t.title, amount: t.price, meta: { code, sellerPhone: t.sellerPhone } });
  await ctx.link(`${t.title} · ${rupees(t.price)}\nPay with any UPI app. The test link arrives here right after payment.`, order.link, 'Pay by UPI');
}

async function buyBundle(ctx, code) {
  const b = await db.tests.findOne({ code, type: 'bundle' });
  if (!b) return menu(ctx);
  const order = await createOrder({ product: 'testmandi', phone: ctx.phone, item: `bundle:${code}`, title: b.title, amount: b.price, meta: { code, sellerPhone: b.sellerPhone } });
  await ctx.link(`${b.title} · ${rupees(b.price)}\nPay with any UPI app. All tests unlock right after payment.`, order.link, 'Pay by UPI');
}

export async function onPaid(ctx, order) {
  const { code, sellerPhone } = order.meta;
  const isBundle = order.item.startsWith('bundle:');
  const item = await db.tests.findOne({ code });
  const codes = isBundle ? item.testCodes : [code];
  await ctx.setUser({ purchases: [...new Set([...(ctx.user.purchases || []), ...codes])] });
  await db.tests.updateOne({ code }, { $inc: { salesCount: 1, revenue: order.amount } });
  await ctx.say(`✅ Payment received: ${rupees(order.amount)}`);
  if (isBundle) {
    const tests = await db.tests.find({ code: { $in: codes } });
    await ctx.list(`${item.title} unlocked. Pick a test to start:`, 'Start a test', [{ title: 'Your tests', rows: tests.map((t) => ({ id: `tm:start:${t.code}`, title: t.title, description: `${t.qids.length} Qs · ${t.durationMin} min` })) }]);
  } else {
    await sendLink(ctx, code);
  }
  await notifySeller(sellerPhone, item, order);
}

async function notifySeller(sellerPhone, item, order) {
  if (!sellerPhone) return;
  const share = Math.round(order.amount * (item.sellerShare ?? 0.7) * 100) / 100;
  const today = istDate();
  const seller = await db.users.updateOne(
    { product: 'testmandi', phone: sellerPhone },
    { $inc: { 'seller.earnings': share, 'seller.sales': 1 }, $setOnInsert: { createdAt: new Date(), credits: {} } },
    { upsert: true },
  );
  const day = seller.seller?.day === today ? seller.seller : { day: today, todaySales: 0, todayEarnings: 0 };
  day.todaySales += 1; day.todayEarnings = Math.round((day.todayEarnings + share) * 100) / 100;
  await db.users.updateOne({ product: 'testmandi', phone: sellerPhone }, { $set: { 'seller.day': today, 'seller.todaySales': day.todaySales, 'seller.todayEarnings': day.todayEarnings } });
  const text = `🔔 New sale · ${item.title}\nPrice ${rupees(order.amount)} · Your share ${rupees(share)}\nToday: ${day.todaySales} sale${day.todaySales > 1 ? 's' : ''} · ${rupees(day.todayEarnings)}\n\nShare this test to sell more:\n${shareLink(item.code) || 'TEST ' + item.code}`;
  if (within24h(seller)) await send('testmandi', sellerPhone, { type: 'text', text });
  else if (process.env.TEMPLATE_SELLER_SALE) {
    await send('testmandi', sellerPhone, { type: 'template', name: process.env.TEMPLATE_SELLER_SALE, params: [item.title, rupees(share), String(day.todaySales)] });
  }
}

async function sendLink(ctx, code) {
  const t = await db.tests.findOne({ code });
  if (!t || !owns(ctx.user, code)) return showTest(ctx, code);
  const url = await createMagicLink({ product: 'testmandi', phone: ctx.phone, kind: 'test', ref: code, title: t.title, qids: t.qids, durationMin: t.durationMin, ttlMin: 30 });
  await ctx.link(`▶️ ${t.title}\n${t.qids.length} questions · ${t.durationMin} min\nYou'll be logged in automatically. The link works for 30 minutes.`, url, 'Start test');
}

export async function onAttempt(ctx, a) {
  const t = await db.tests.findOne({ code: a.ref });
  await db.tests.updateOne({ code: a.ref }, { $inc: { attemptsCount: 1 } });
  const total = await db.attempts.count({ product: 'testmandi', ref: a.ref });
  const better = await db.attempts.count({ product: 'testmandi', ref: a.ref, correct: { $gt: a.correct } });
  const rank = better + 1;
  const lines = [`📊 ${a.title}`, `Score: ${a.correct}/${a.total}`, `Rank: ${fmtNum(rank)} of ${fmtNum(total)} students`];
  if (total >= 10) lines.push(`You're in the top ${Math.max(1, Math.ceil((rank / total) * 100))}%`);
  if (a.weak.length) lines.push(`Weak areas: ${a.weak.slice(0, 3).join(', ')}`);
  lines.push('', 'Explanations for every question are on the result page.');
  await ctx.say(lines.join('\n'));
  await ctx.buttons(`How was this test by ${t.sellerName}?`, [[`tm:rate:${a.ref}:5`, '⭐⭐⭐⭐⭐ Great'], [`tm:rate:${a.ref}:4`, '⭐⭐⭐⭐ Good'], [`tm:rate:${a.ref}:2`, '⭐⭐ Could be better']]);
}

async function rate(ctx, code, stars) {
  const rated = ctx.user.rated || [];
  if (!rated.includes(code) && stars >= 1 && stars <= 5) {
    await db.tests.updateOne({ code }, { $inc: { ratingSum: stars, ratingCount: 1 } });
    await ctx.setUser({ rated: [...rated, code] });
  }
  await ctx.say('Thanks for rating! 🙏');
  return recommend(ctx, code);
}

async function recommend(ctx, code) {
  const t = await db.tests.findOne({ code });
  const owned = ctx.user.purchases || [];
  const bundle = await db.tests.findOne({ type: 'bundle', testCodes: code });
  if (bundle && !bundle.testCodes.every((c) => owned.includes(c))) {
    const left = bundle.testCodes.filter((c) => !owned.includes(c)).length;
    await ctx.buttons(`Keep practising with ${t.sellerName}: ${left} more tests in "${bundle.title}".`, [[`tm:card:${bundle.code}`, '🎁 See the pack'], ['tm:browse', 'Browse more']]);
    return;
  }
  const more = (await db.tests.find({ sellerPhone: t.sellerPhone, type: { $ne: 'bundle' } }, { sort: { attemptsCount: -1 }, limit: 10 }))
    .filter((x) => !owned.includes(x.code)).slice(0, 5);
  if (!more.length) return browse(ctx);
  await ctx.list(`More tests by ${t.sellerName}:`, 'See tests', [{ title: t.sellerName, rows: more.map((x) => ({ id: `tm:card:${x.code}`, title: x.title, description: `${rupees(x.price)} · ${x.qids.length} Qs · ${rating(x)}` })) }]);
}

async function browse(ctx) {
  const tests = await db.tests.find({ type: { $ne: 'bundle' }, listed: { $ne: false } }, { sort: { attemptsCount: -1 }, limit: 10 });
  if (!tests.length) return ctx.say('No tests are listed yet. Check back soon!');
  await ctx.list('Popular tests on TestMandi:', 'See tests', [{ title: 'Popular', rows: tests.map((t) => ({ id: `tm:card:${t.code}`, title: t.title, description: `${rupees(t.price)} · ${t.sellerName} · ${rating(t)}` })) }]);
}

async function myTests(ctx) {
  const codes = ctx.user.purchases || [];
  if (!codes.length) return ctx.buttons('You haven\'t bought any tests yet.', [['tm:browse', '🔎 Browse tests']]);
  const tests = await db.tests.find({ code: { $in: codes } });
  await ctx.list('Your tests:', 'Open', [{ title: 'Purchased', rows: tests.slice(0, 10).map((t) => ({ id: `tm:start:${t.code}`, title: t.title, description: `${t.qids.length} Qs · tap to get a fresh link` })) }]);
}

async function sellInfo(ctx) {
  await ctx.say(`🧑‍🏫 Sell your tests on TestMandi\n• Keep ${Math.round(ctx.cfg.sellerShare * 100)}% of every sale\n• Each test gets a WhatsApp link students can buy from in one tap\n• Instant sale alerts and weekly UPI payouts\n\nSign up as a seller at ${ctx.cfg.webBase}`);
}

async function sellerStats(ctx) {
  const tests = await db.tests.find({ sellerPhone: ctx.phone }, { sort: { salesCount: -1 } });
  if (!tests.length) return sellInfo(ctx);
  const s = ctx.user.seller || {};
  const today = s.day === istDate() ? s : { todaySales: 0, todayEarnings: 0 };
  const lines = [
    '💰 Your TestMandi sales',
    `Today: ${today.todaySales} sales · ${rupees(today.todayEarnings || 0)}`,
    `All time: ${s.sales || 0} sales · ${rupees(s.earnings || 0)}`,
    '',
    'Share links (post these in your groups):',
    ...tests.slice(0, 8).map((t) => `• ${t.title} (${t.salesCount || 0} sold)\n  ${shareLink(t.code) || 'TEST ' + t.code}`),
  ];
  await ctx.say(lines.join('\n'));
}
