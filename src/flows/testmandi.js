// TestMandi: test marketplace flow.
// Funnel: seller's share link ("TEST CODE") or the catalogue (categories, search, pages) → test card with real
//         rating/attempts → free sample in chat → UPI purchase → magic link → rank among buyers → rating → more tests.
// Refer & earn: buyers invite friends ("TREF CODE": friend gets ₹ off, inviter gets wallet credit);
//               sellers invite teachers ("SREF CODE"). For sellers synced from testmandi.in the code is their
//               TestMandi referral code and TestMandi's own seller programme pays the bonus; bot-only sellers
//               earn a % of the invited seller's WhatsApp sales instead.
// Tests synced from testmandi.in record every WhatsApp sale in TestMandi, so sellers are paid via TestMandi payouts.
// Sellers: instant sale alerts with their share, "SELLER" shows earnings and share links.
import { db } from '../store.js';
import { config } from '../config.js';
import { createMagicLink } from '../magic.js';
import { createOrder } from '../payments.js';
import { send } from '../providers/index.js';
import { rupees } from '../products.js';
import { maskPhone, fmtNum, waLink, istDate, refCodeFor, DAY } from '../util.js';
import { within24h } from '../engine.js';
import { startChatQuiz, answerQuestion, pendingOrder, switchRows } from './common.js';
import { recordSaleInTestMandi, creditSellerReferral, recordLiveAttempt } from '../testmandiSync.js';

const shareLink = (code) => waLink(config.wa.displayNumbers.testmandi, `TEST ${code}`);
const rating = (t) => (t.ratingCount >= 5 ? `⭐ ${(t.ratingSum / t.ratingCount).toFixed(1)} (${fmtNum(t.ratingCount)})` : '🆕 New');
const owns = (u, code) => (u.purchases || []).includes(code);
const priceTag = (p) => (p > 0 ? rupees(p) : 'FREE');
const LISTED = { type: { $ne: 'bundle' }, listed: { $ne: false } };
const round2 = (n) => Math.round(n * 100) / 100;

// ---- Live tests (synced from testmandi.in scheduled tests) ----
const liveOpen = (l, now = Date.now()) => now >= l.start && now <= l.start + l.windowMin * 60e3;
const liveNext = (t, now = Date.now()) => (t.live || []).find((l) => l.start + l.windowMin * 60e3 >= now) || null;
export const fmtLive = (ms) => new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
const liveTag = (l) => (liveOpen(l) ? '🔴 LIVE now' : `🔴 Live ${fmtLive(l.start)}`);

export async function handle(ctx, input) {
  const { replyId, upper, text } = input;
  const state = ctx.session.data?.state;
  if (!ctx.user.refCode) await ctx.setUser({ refCode: refCodeFor('testmandi', ctx.phone) });

  if (replyId.startsWith('ans:') && state === 'quiz') {
    const done = await answerQuestion(ctx, replyId);
    if (done) await sampleDone(ctx, done);
    return;
  }

  // Referral links
  const tref = upper.match(/\bTREF\s+([A-Z0-9]{6})\b/);
  if (tref) return joinAsBuyer(ctx, tref[1]);
  const sref = upper.match(/\bSREF\s+([A-Z0-9]{4,10})\b/);
  if (sref) return joinAsSeller(ctx, sref[1]);

  const m = upper.match(/^(?:TEST|BUY)\s+([A-Z0-9-]{3,})/);
  if (m) return showTest(ctx, m[1]);
  if (upper === 'SELLER' || upper === 'MY SALES') return sellerStats(ctx);
  if (upper === 'REFER' || upper === 'WALLET') return referBuyer(ctx);
  if (upper === 'BROWSE' || upper === 'TESTS') return browse(ctx);
  if (upper === 'LIVE') return liveList(ctx);
  const search = upper.match(/^(?:SEARCH|FIND)\s+(.+)/);
  if (search) return runSearch(ctx, text.slice(text.indexOf(' ') + 1));
  if (state === 'await_search' && text && !replyId) return runSearch(ctx, text);

  if (replyId.startsWith('tm:')) {
    const [, cmd, a, b] = replyId.split(':');
    if (cmd === 'card') return showTest(ctx, a);
    if (cmd === 'sample') return startSample(ctx, a);
    if (cmd === 'buy') return buy(ctx, a);
    if (cmd === 'bundle') return buyBundle(ctx, a);
    if (cmd === 'start') return sendLink(ctx, a);
    if (cmd === 'rate') return rate(ctx, a, Number(b));
    if (cmd === 'browse') return browse(ctx);
    if (cmd === 'cats') return browse(ctx, Number(a) || 0);
    if (cmd === 'cat') return listTests(ctx, decodeURIComponent(a), Number(b) || 0);
    if (cmd === 'pop') return listTests(ctx, null, Number(a) || 0);
    if (cmd === 'search') { await ctx.go('await_search'); return ctx.say('🔍 Type what you\'re looking for, like "SSC GK", "NEET biology" or a teacher\'s name.'); }
    if (cmd === 'mine') return myTests(ctx);
    if (cmd === 'live') return liveList(ctx);
    if (cmd === 'more') return moreMenu(ctx);
    if (cmd === 'refer') return referBuyer(ctx);
    if (cmd === 'sell') return sellInfo(ctx);
    if (cmd === 'sales') return sellerStats(ctx);
  }

  const pending = await pendingOrder(ctx);
  if (pending && !ctx.isNew) await ctx.link(`You were buying: ${pending.title} for ${rupees(pending.amount)}. Tap to finish.`, pending.link, 'Pay now');
  return menu(ctx);
}

async function menu(ctx) {
  const n = await db.tests.count(LISTED);
  const wallet = ctx.user.wallet || 0;
  const lines = [ctx.isNew
    ? `Welcome to TestMandi! 👋\nMock tests from top teachers, right here on WhatsApp.\nYour number ${maskPhone(ctx.phone)} is your account.`
    : 'Hi! 👋'];
  if (n >= 5) lines.push(`${fmtNum(n)} tests available.`);
  if (wallet > 0) lines.push(`💰 Wallet: ${rupees(wallet)}, used automatically on your next test.`);
  lines.push('', 'What would you like to do?');
  await ctx.buttons(lines.join('\n'), [['tm:browse', '🔎 Browse tests'], ['tm:mine', '📚 My tests'], ['tm:more', '⭐ More']]);
}

async function moreMenu(ctx) {
  const isSeller = await db.tests.count({ sellerPhone: ctx.phone });
  const r = ctx.cfg.referral;
  await ctx.list('More options', 'Open', [{
    title: 'TestMandi', rows: [
      { id: 'tm:refer', title: '🎁 Refer & earn', description: `Friends get ${rupees(r.friendDiscount)} off, you get ${rupees(r.buyerReward)} per friend` },
      { id: 'tm:search', title: '🔍 Search tests', description: 'Find by exam, subject or teacher' },
      isSeller
        ? { id: 'tm:sales', title: '💰 My sales', description: 'Earnings, share links, invite teachers' }
        : { id: 'tm:sell', title: '🧑‍🏫 Sell your tests', description: `Keep ${Math.round(ctx.cfg.sellerShare * 100)}% of every sale` },
      ...switchRows(),
    ],
  }]);
}

// ---- Catalogue ----------------------------------------------------------
async function browse(ctx, page = 0) {
  await ctx.go('idle');
  const tests = await db.tests.find(LISTED);
  if (!tests.length) return ctx.say('No tests are listed yet. Check back soon!');
  const counts = {};
  for (const t of tests) { const c = t.category || 'Other'; counts[c] = (counts[c] || 0) + 1; }
  const cats = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const liveCount = await db.tests.count({ ...LISTED, liveUntil: { $gte: Date.now() } });
  if (cats.length <= 1 && !liveCount) return listTests(ctx, null, 0);
  // 10 rows max: first page has Popular + Search (+ Live), every page may have "More categories"
  const first = liveCount ? 6 : 7;
  const perPage = page === 0 ? first : 8;
  const start = page === 0 ? 0 : first + (page - 1) * 8;
  const slice = cats.slice(start, start + perPage);
  const more = start + perPage < cats.length;
  const rows = [
    ...(page === 0 && liveCount ? [{ id: 'tm:live', title: '🔴 Live tests', description: `${liveCount} live test${liveCount > 1 ? 's' : ''}: compete on one leaderboard` }] : []),
    ...(page === 0 ? [{ id: 'tm:pop:0', title: '🔥 Most popular', description: `Top tests across all ${fmtNum(tests.length)}` }] : []),
    ...slice.map(([c, n]) => ({ id: `tm:cat:${encodeURIComponent(c)}:0`, title: c, description: `${n} test${n > 1 ? 's' : ''}` })),
    ...(more ? [{ id: `tm:cats:${page + 1}`, title: '➡️ More categories', description: `${cats.length - start - perPage} more exams` }] : []),
    page === 0 ? { id: 'tm:search', title: '🔍 Search', description: 'Type an exam, subject or teacher' } : { id: 'tm:cats:0', title: '⬅️ Back to start' },
  ];
  await ctx.list(page === 0 ? `📚 ${fmtNum(tests.length)} tests in ${cats.length} exams. Pick one, or search:` : `More exams (page ${page + 1}):`, 'Categories', [{ title: 'Exams', rows }]);
}

async function liveList(ctx) {
  await ctx.go('idle');
  const now = Date.now();
  const tests = (await db.tests.find({ ...LISTED, liveUntil: { $gte: now } }))
    .map((t) => ({ t, l: liveNext(t, now) })).filter((x) => x.l).sort((a, b) => a.l.start - b.l.start).slice(0, 9);
  if (!tests.length) return ctx.buttons('No live tests are scheduled right now. Teachers schedule them on testmandi.in; check back soon.', [['tm:browse', '📚 Browse tests']]);
  await ctx.list('🔴 Live tests\nEveryone takes the test in the same window and gets ranked on one leaderboard. Buy before it starts; you\'ll get the link here when it opens.', 'See live tests', [{ title: 'Live tests', rows: [
    ...tests.map(({ t, l }) => ({ id: `tm:card:${t.code}`, title: t.title, description: `${liveOpen(l, now) ? 'LIVE now' : fmtLive(l.start)} · ${priceTag(t.price)} · ${t.sellerName}` })),
    { id: 'tm:browse', title: '⬅️ All categories' },
  ] }]);
}

async function listTests(ctx, category, page) {
  const size = ctx.cfg.pageSize;
  const filter = category ? { ...LISTED, category: category === 'Other' ? { $exists: false } : category } : LISTED;
  const tests = await db.tests.find(filter, { sort: { attemptsCount: -1 }, skip: page * size, limit: size + 1 });
  if (!tests.length) return page ? listTests(ctx, category, 0) : browse(ctx);
  const hasMore = tests.length > size;
  const total = await db.tests.count(filter);
  const rows = tests.slice(0, size).map((t) => ({ id: `tm:card:${t.code}`, title: t.title, description: `${priceTag(t.price)} · ${t.sellerName} · ${rating(t)}` }));
  if (hasMore) rows.push({ id: category ? `tm:cat:${encodeURIComponent(category)}:${page + 1}` : `tm:pop:${page + 1}`, title: '➡️ More tests', description: `Showing ${page * size + 1}–${page * size + size} of ${total}` });
  rows.push({ id: 'tm:browse', title: '⬅️ All categories' });
  await ctx.list(`${category || '🔥 Most popular'}${page ? ` · page ${page + 1}` : ''}\nTap a test to see details and try free questions.`, 'See tests', [{ title: (category || 'Popular').slice(0, 24), rows }]);
}

async function runSearch(ctx, query) {
  await ctx.go('idle');
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return browse(ctx);
  const all = await db.tests.find(LISTED, { sort: { attemptsCount: -1 } });
  const hits = all.filter((t) => {
    const hay = `${t.title} ${t.category || ''} ${t.sellerName || ''} ${t.code}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }).slice(0, 9);
  await ctx.track('search', { q: String(query).slice(0, 60), hits: hits.length });
  if (!hits.length) return ctx.buttons(`No tests found for "${query}". Try a shorter word, like the exam name.`, [['tm:search', '🔍 Search again'], ['tm:browse', '📚 Categories']]);
  await ctx.list(`🔍 ${hits.length} test${hits.length > 1 ? 's' : ''} for "${query}":`, 'See tests', [{ title: 'Results', rows: [
    ...hits.map((t) => ({ id: `tm:card:${t.code}`, title: t.title, description: `${priceTag(t.price)} · ${t.sellerName} · ${rating(t)}` })),
    { id: 'tm:browse', title: '⬅️ All categories' },
  ] }]);
}

// ---- Test card and purchase ----------------------------------------------
async function showTest(ctx, code) {
  const t = await db.tests.findOne({ code });
  if (!t) return ctx.say(`I couldn't find test "${code}". Check the code, or send BROWSE to see all tests.`);
  if (t.type === 'bundle') return showBundle(ctx, t);
  await ctx.track('test_view', { code });
  if (owns(ctx.user, code)) {
    const done = await db.attempts.findOne({ product: 'testmandi', phone: ctx.phone, ref: code });
    const ol = liveNext(t);
    if (ol && !liveOpen(ol)) return ctx.buttons(`You own ${t.title}.\n${liveTag(ol)}: I'll send your link here when it opens. You can also practise it now; only the live window counts for the leaderboard.`, [[`tm:start:${code}`, '▶️ Practise now'], ['tm:live', '🔴 Live tests']]);
    if (!done) return ctx.buttons(`You already own ${t.title}.${ol ? `\n${liveTag(ol)}: your attempt counts on the live leaderboard.` : ''}`, [[`tm:start:${code}`, '▶️ Start test']]);
  }
  const lines = [
    `📘 ${t.title}`,
    `By ${t.sellerName} · ${rating(t)}`,
    `${t.qids.length} questions · ${t.durationMin} min${t.language ? ' · ' + t.language : ''}`,
  ];
  if (t.attemptsCount >= 10) lines.push(`${fmtNum(t.attemptsCount)} students have taken it`);
  const nl = liveNext(t);
  if (nl) lines.push('', `${liveTag(nl)} · join within ${nl.windowMin} min of the start`, 'Buy now and the live link comes here the moment it opens.');
  if (t.price > 0) {
    lines.push('', `Price: ${t.anchor ? `${rupees(t.price)} (was ${rupees(t.anchor)})` : rupees(t.price)}`);
    const { discount, walletUse, pay } = priceFor(ctx, t.price);
    if (discount) lines.push(`🎁 Your friend's invite: ${rupees(discount)} off`);
    if (walletUse) lines.push(`💰 Wallet: −${rupees(walletUse)}`);
    if (discount || walletUse) lines.push(`You pay: ${priceTag(pay)}`);
  } else lines.push('', 'Price: FREE 🎉');
  lines.push('Includes explanations and your rank among everyone who took it.');
  const bundle = await db.tests.findOne({ type: 'bundle', testCodes: code });
  const btns = [];
  if (t.price > 0 && ctx.cfg.freeSample > 0 && !(ctx.user.sampled || []).includes(code)) btns.push([`tm:sample:${code}`, `Try ${Math.min(ctx.cfg.freeSample, t.qids.length)} free Qs`]);
  btns.push([`tm:buy:${code}`, t.price > 0 ? `Buy · ${priceTag(priceFor(ctx, t.price).pay)}` : '▶️ Start free test']);
  if (bundle) btns.push([`tm:card:${bundle.code}`, `🎁 Pack of ${bundle.testCodes.length}`]);
  await ctx.buttons(lines.join('\n'), btns);
}

// Friend discount (first purchase only) then wallet credit
function priceFor(ctx, price) {
  const u = ctx.user;
  const firstBuy = !(u.purchases || []).length;
  const discount = price > 0 && u.referredBy && !u.refDiscountUsed && firstBuy ? Math.min(ctx.cfg.referral.friendDiscount, price) : 0;
  const walletUse = Math.min(u.wallet || 0, price - discount);
  return { discount, walletUse, pay: round2(price - discount - walletUse) };
}

async function showBundle(ctx, b) {
  const tests = await db.tests.find({ code: { $in: b.testCodes } });
  const total = tests.reduce((s, t) => s + t.price, 0);
  const save = total - b.price;
  const { pay } = priceFor(ctx, b.price);
  await ctx.buttons(
    `🎁 ${b.title}\nBy ${b.sellerName}\n${tests.map((t) => '• ' + t.title).join('\n')}\n\nPack price: ${rupees(b.price)}${save > 0 ? `\nBought one by one: ${rupees(total)}. You save ${rupees(save)}.` : ''}${pay !== b.price ? `\nYou pay: ${priceTag(pay)}` : ''}`,
    [[`tm:bundle:${b.code}`, `Buy pack · ${priceTag(pay)}`], ...(tests[0] ? [[`tm:card:${tests[0].code}`, 'See single test']] : [])],
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
    [[`tm:buy:${code}`, `Buy · ${priceTag(priceFor(ctx, t.price).pay)}`], ['tm:browse', 'Other tests']],
  );
}

async function buy(ctx, code) {
  const t = await db.tests.findOne({ code });
  if (!t) return menu(ctx);
  if (owns(ctx.user, code)) return sendLink(ctx, code);
  return checkout(ctx, { item: `test:${code}`, code, title: t.title, price: t.price, sellerPhone: t.sellerPhone });
}

async function buyBundle(ctx, code) {
  const b = await db.tests.findOne({ code, type: 'bundle' });
  if (!b) return menu(ctx);
  return checkout(ctx, { item: `bundle:${code}`, code, title: b.title, price: b.price, sellerPhone: b.sellerPhone });
}

async function checkout(ctx, { item, code, title, price, sellerPhone }) {
  const { discount, walletUse, pay } = priceFor(ctx, price);
  const meta = { code, sellerPhone, listPrice: price, discount, walletUse };
  if (pay <= 0) {
    // Free test, or fully covered by discount and wallet: unlock without a payment link
    const order = await db.orders.insertOne({ product: 'testmandi', phone: ctx.phone, item, title, amount: 0, meta, status: 'paid', paidAt: new Date(), createdAt: new Date(), nudged: true });
    await ctx.track('paid', { item, amount: 0, listPrice: price });
    return onPaid(ctx, order);
  }
  const order = await createOrder({ product: 'testmandi', phone: ctx.phone, item, title, amount: pay, meta });
  const notes = [discount && `🎁 ${rupees(discount)} invite discount`, walletUse && `💰 ${rupees(walletUse)} from wallet`].filter(Boolean).join(' · ');
  await ctx.link(`${title} · ${rupees(pay)}${notes ? `\n${notes}` : ''}\nPay with any UPI app. ${item.startsWith('bundle:') ? 'All tests unlock' : 'The test link arrives here'} right after payment.`, order.link, 'Pay by UPI');
}

export async function onPaid(ctx, order) {
  const { code, sellerPhone, listPrice = order.amount, discount = 0, walletUse = 0 } = order.meta;
  const isBundle = order.item.startsWith('bundle:');
  const item = await db.tests.findOne({ code });
  const codes = isBundle ? item.testCodes : [code];
  const firstPurchase = !(ctx.user.purchases || []).length;
  const patch = { purchases: [...new Set([...(ctx.user.purchases || []), ...codes])] };
  if (discount) patch.refDiscountUsed = true;
  const inc = walletUse ? { wallet: -Math.min(walletUse, ctx.user.wallet || 0) } : {};
  await ctx.setUser(patch, Object.keys(inc).length ? { $inc: inc } : {});
  await db.tests.updateOne({ code }, { $inc: { salesCount: 1, revenue: listPrice } });
  if (listPrice > 0) await ctx.say(order.amount > 0 ? `✅ Payment received: ${rupees(order.amount)}` : '✅ Unlocked with your discount and wallet credit.');
  if (isBundle) {
    const tests = await db.tests.find({ code: { $in: codes } });
    await ctx.list(`${item.title} unlocked. Pick a test to start:`, 'Start a test', [{ title: 'Your tests', rows: tests.map((t) => ({ id: `tm:start:${t.code}`, title: t.title, description: `${t.qids.length} Qs · ${t.durationMin} min` })) }]);
  } else {
    await sendLink(ctx, code);
  }
  if (listPrice > 0) {
    if (item.tmId) {
      try { await recordSaleInTestMandi({ item, phone: ctx.phone, listPrice, paymentId: order.paymentId }); }
      catch (e) { console.error('[testmandi] could not record sale in TestMandi', order._id, e); }
    }
    await rewardBuyerReferrer(ctx, firstPurchase);
    await notifySeller(sellerPhone, item, listPrice);
  }
}

// ---- Referral rewards ----------------------------------------------------
async function rewardBuyerReferrer(ctx, firstPurchase) {
  const u = ctx.user;
  if (!firstPurchase || !u.referredBy || u.refRewarded) return;
  await ctx.setUser({ refRewarded: true });
  const inviter = await db.users.findOne({ product: 'testmandi', phone: u.referredBy });
  if (inviter?.tmEmail) {
    // Inviter is a TestMandi seller: same rule as testmandi.in, ₹200 straight to their payout balance
    const amount = ctx.cfg.referral.sellerReferrerReward;
    const ok = await creditSellerReferral({ email: inviter.tmEmail, amount, fromName: u.name || maskPhone(ctx.phone) }).catch((e) => { console.error('[testmandi] referral credit failed', e.message); return false; });
    const ref = await db.users.updateOne({ product: 'testmandi', phone: inviter.phone }, { $inc: { referrals: 1, 'seller.referralEarnings': ok ? amount : 0 } });
    if (ok && within24h(ref)) await send('testmandi', ref.phone, { type: 'text', text: `🎉 A student you invited just bought their first test.
${rupees(amount)} added to your TestMandi payout balance.

Invite more: send REFER` });
    return;
  }
  const reward = ctx.cfg.referral.buyerReward;
  const ref = await db.users.updateOne({ product: 'testmandi', phone: u.referredBy }, { $inc: { wallet: reward, referrals: 1 } });
  if (ref && within24h(ref)) {
    await send('testmandi', ref.phone, { type: 'text', text: `🎉 Your friend just bought their first test on TestMandi.\n${rupees(reward)} added to your wallet. Wallet: ${rupees(ref.wallet)}\n\nInvite more friends: send REFER` });
  }
}

async function notifySeller(sellerPhone, item, listPrice) {
  if (!sellerPhone) return;
  const share = round2(listPrice * (item.sellerShare ?? (await import('../products.js')).products.testmandi.sellerShare));
  const today = istDate();
  const seller = await db.users.updateOne(
    { product: 'testmandi', phone: sellerPhone },
    { $inc: { 'seller.earnings': share, 'seller.sales': 1 }, $setOnInsert: { createdAt: new Date(), credits: {} } },
    { upsert: true },
  );
  const day = seller.seller?.day === today ? seller.seller : { day: today, todaySales: 0, todayEarnings: 0 };
  day.todaySales += 1; day.todayEarnings = round2(day.todayEarnings + share);
  await db.users.updateOne({ product: 'testmandi', phone: sellerPhone }, { $set: { 'seller.day': today, 'seller.todaySales': day.todaySales, 'seller.todayEarnings': day.todayEarnings } });
  const text = `🔔 New sale · ${item.title}\nPrice ${rupees(listPrice)} · Your share ${rupees(share)}\nToday: ${day.todaySales} sale${day.todaySales > 1 ? 's' : ''} · ${rupees(day.todayEarnings)}\n\nShare this test to sell more:\n${shareLink(item.code) || 'TEST ' + item.code}`;
  if (within24h(seller)) await send('testmandi', sellerPhone, { type: 'text', text });
  else if (process.env.TEMPLATE_SELLER_SALE) {
    await send('testmandi', sellerPhone, { type: 'template', name: process.env.TEMPLATE_SELLER_SALE, params: [item.title, rupees(share), String(day.todaySales)] });
  }
  await sellerReferralBonus(seller, item, listPrice);
}

// The teacher who invited this seller earns a % of their sales for a limited time
async function sellerReferralBonus(seller, item, listPrice) {
  const r = (await import('../products.js')).products.testmandi.referral;
  if (item.source === 'testmandi') return; // TestMandi's own seller programme handles these
  if (!seller.sellerReferredBy || !seller.sellerReferredAt) return;
  if (Date.now() - new Date(seller.sellerReferredAt).getTime() > r.sellerBonusDays * DAY) return;
  const bonus = round2(listPrice * r.sellerBonusPct);
  if (bonus <= 0) return;
  const inviter = await db.users.updateOne(
    { product: 'testmandi', phone: seller.sellerReferredBy },
    { $inc: { 'seller.earnings': bonus, 'seller.referralEarnings': bonus } },
  );
  if (inviter && within24h(inviter)) {
    await send('testmandi', inviter.phone, { type: 'text', text: `💸 Referral bonus: ${rupees(bonus)}\nA teacher you invited just sold "${item.title}". You earn ${Math.round(r.sellerBonusPct * 100)}% of their sales.` });
  }
}

async function joinAsBuyer(ctx, code) {
  const u = ctx.user;
  const referrer = await db.users.findOne({ product: 'testmandi', refCode: code });
  const eligible = referrer && referrer.phone !== ctx.phone && !u.referredBy && !(u.purchases || []).length;
  if (eligible) {
    await ctx.setUser({ referredBy: referrer.phone });
    await ctx.say(`🎁 Welcome to TestMandi! Your friend's invite gives you ${rupees(ctx.cfg.referral.friendDiscount)} off your first test.`);
  }
  return browse(ctx);
}

async function joinAsSeller(ctx, code) {
  const u = ctx.user;
  const tmInviter = await db.users.findOne({ product: 'testmandi', tmReferralCode: code });
  if (tmInviter) {
    await ctx.setUser({ tmInviteCode: code });
    return ctx.say(`🧑‍🏫 Sell your tests on TestMandi\n• Keep ${Math.round(ctx.cfg.sellerShare * 100)}% of every sale, on the website and here on WhatsApp\n• Students buy from your WhatsApp test link in one tap\n• Payouts straight to your bank from your TestMandi dashboard\n\nSign up as a seller at ${ctx.cfg.webBase}:\n1. Use this WhatsApp number as your phone, so sale alerts reach you here\n2. Enter referral code *${code}* so ${tmInviter.tmName || 'the teacher who invited you'} gets credit`);
  }
  const inviter = await db.users.findOne({ product: 'testmandi', refCode: code });
  const alreadySelling = await db.tests.count({ sellerPhone: ctx.phone });
  if (inviter && inviter.phone !== ctx.phone && !u.sellerReferredBy && !alreadySelling) {
    await ctx.setUser({ sellerReferredBy: inviter.phone, sellerReferredAt: new Date() });
  }
  return sellInfo(ctx);
}

async function referBuyer(ctx) {
  const r = ctx.cfg.referral;
  const u = ctx.user;
  const link = waLink(config.wa.displayNumbers.testmandi, `Hi TREF ${u.refCode}`);
  if (u.tmEmail) {
    await ctx.say(`🎁 Refer & earn (seller)\n• Students you invite get ${rupees(r.friendDiscount)} off their first test\n• You get ${rupees(r.sellerReferrerReward)} in your TestMandi payout when they make their first purchase\n• Teachers who join with your code: ${rupees(r.sellerReferrerReward)} when they publish their first test\n\nYour code: ${u.tmReferralCode || '-'} · Students invited who bought: ${u.referrals || 0}\n\nForward the message below to students 👇`);
    return ctx.say(`Practise my mock tests on WhatsApp with TestMandi, with rank and explanations. Use my link and get ${rupees(r.friendDiscount)} off your first test: ${link || 'message TestMandi and send TREF ' + u.refCode}`);
  }
  await ctx.say(`🎁 Refer & earn\n• Your friend gets ${rupees(r.friendDiscount)} off their first test\n• You get ${rupees(r.buyerReward)} in your wallet when they buy\n• Wallet credit is used automatically on your next test\n\nFriends invited who bought: ${u.referrals || 0}\nWallet: ${rupees(u.wallet || 0)}\n\nForward the message below 👇`);
  await ctx.say(`I practise mock tests on WhatsApp with TestMandi: SSC, NEET, TNPSC and more, with rank and explanations. Use my link and get ${rupees(r.friendDiscount)} off your first test: ${link || 'message TestMandi and send TREF ' + u.refCode}`);
}

// ---- Tests, rating, recommendations --------------------------------------
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
  const session = (t?.live || []).find((l) => liveOpen(l, new Date(a.at).getTime()));
  if (session && t.tmId) {
    const ok = await recordLiveAttempt({ test: t, session, phone: ctx.phone, answersById: a.answers, correct: a.correct, total: a.total, timeSec: a.timeSec }).catch((e) => { console.error('[testmandi] live attempt failed', e.message); return false; });
    if (ok) lines.push('', `🔴 Counted on the live leaderboard: ${ctx.cfg.webBase}`);
  }
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
  const more = (await db.tests.find({ ...LISTED, sellerPhone: t.sellerPhone }, { sort: { attemptsCount: -1 }, limit: 10 }))
    .filter((x) => !owned.includes(x.code)).slice(0, 5);
  if (!more.length) return browse(ctx);
  await ctx.list(`More tests by ${t.sellerName}:`, 'See tests', [{ title: 'More tests', rows: more.map((x) => ({ id: `tm:card:${x.code}`, title: x.title, description: `${priceTag(x.price)} · ${x.qids.length} Qs · ${rating(x)}` })) }]);
}

async function myTests(ctx) {
  const codes = ctx.user.purchases || [];
  if (!codes.length) return ctx.buttons('You haven\'t bought any tests yet.', [['tm:browse', '🔎 Browse tests']]);
  const tests = await db.tests.find({ code: { $in: codes } });
  await ctx.list('Your tests:', 'Open', [{ title: 'Purchased', rows: tests.slice(0, 10).map((t) => ({ id: `tm:start:${t.code}`, title: t.title, description: `${t.qids.length} Qs · tap to get a fresh link` })) }]);
}

// ---- Sellers ----------------------------------------------------------------
async function sellInfo(ctx) {
  const invited = ctx.user.sellerReferredBy ? '\n\n🤝 Your invite is saved. Start selling and your inviter gets a small bonus from TestMandi; your share stays the same.' : '';
  await ctx.say(`🧑‍🏫 Sell your tests on TestMandi\n• Keep ${Math.round(ctx.cfg.sellerShare * 100)}% of every sale\n• Each test gets a WhatsApp link students can buy from in one tap\n• Instant sale alerts and weekly UPI payouts\n\nSign up as a seller at ${ctx.cfg.webBase}, using this WhatsApp number as your phone so sale alerts reach you here.${invited}`);
}

async function sellerStats(ctx) {
  const tests = await db.tests.find({ sellerPhone: ctx.phone }, { sort: { salesCount: -1 } });
  if (!tests.length) return sellInfo(ctx);
  const r = ctx.cfg.referral;
  const s = ctx.user.seller || {};
  const today = s.day === istDate() ? s : { todaySales: 0, todayEarnings: 0 };
  const invited = await db.users.count({ product: 'testmandi', sellerReferredBy: ctx.phone });
  const lines = [
    ctx.user.tmEmail ? '💰 Your sales on WhatsApp\n(Website sales and payouts: your TestMandi dashboard.)' : '💰 Your TestMandi sales',
    `Today: ${today.todaySales} sales · ${rupees(today.todayEarnings || 0)}`,
    `All time: ${s.sales || 0} sales · ${rupees(s.earnings || 0)}`,
  ];
  if (s.referralEarnings) lines.push(`Of which referral bonus: ${rupees(s.referralEarnings)}`);
  lines.push('', 'Share links (post these in your groups):', ...tests.slice(0, 8).map((t) => `• ${t.title} (${t.salesCount || 0} sold)\n  ${shareLink(t.code) || 'TEST ' + t.code}`));
  await ctx.say(lines.join('\n'));
  if (ctx.user.tmReferralCode) {
    const code = ctx.user.tmReferralCode;
    const tmLink = waLink(config.wa.displayNumbers.testmandi, `Hi SREF ${code}`);
    await ctx.say(`🤝 Invite teachers and students with your TestMandi code *${code}*\n• ₹200 when a teacher you invite publishes their first test\n• ₹200 when a student you invite makes their first purchase on testmandi.in\nBonuses are added to your TestMandi payouts.\n\nForward this to teachers 👇`);
    await ctx.say(`I sell my mock tests on TestMandi. Students buy them on the website and right on WhatsApp, and teachers keep ${Math.round(ctx.cfg.sellerShare * 100)}% of every sale. Join with my code ${code}: ${tmLink || ctx.cfg.webBase}`);
    return;
  }
  const link = waLink(config.wa.displayNumbers.testmandi, `Hi SREF ${ctx.user.refCode}`);
  await ctx.say(`🤝 Invite other teachers to sell on TestMandi\nYou earn ${Math.round(r.sellerBonusPct * 100)}% of their sales for ${Math.round(r.sellerBonusDays / 30)} months. It comes from TestMandi's share, so they still keep ${Math.round(ctx.cfg.sellerShare * 100)}%.\nTeachers invited: ${invited}\n\nForward this to teachers 👇`);
  await ctx.say(`I sell my mock tests on TestMandi and students buy them right on WhatsApp. Teachers keep ${Math.round(ctx.cfg.sellerShare * 100)}% of every sale. Join with my link: ${link || 'message TestMandi and send SREF ' + ctx.user.refCode}`);
}

// Cron: when a live window opens, send owners their link (in the 24h window; otherwise the TEMPLATE_LIVE_START template if set)
export async function notifyLiveStarts(now = Date.now()) {
  let sent = 0;
  for (const t of await db.tests.find({ liveUntil: { $gte: now } })) {
    for (const l of (t.live || []).filter((x) => liveOpen(x, now))) {
      if (await db.events.findOne({ type: 'live_notified', ref: l.id })) continue;
      await db.events.insertOne({ type: 'live_notified', product: 'testmandi', ref: l.id, at: new Date() });
      const owners = await db.users.find({ product: 'testmandi', purchases: t.code });
      const minsLeft = Math.max(1, Math.round((l.start + l.windowMin * 60e3 - now) / 60e3));
      for (const u of owners) {
        if (u.optedOut) continue;
        if (within24h(u)) {
          const url = await createMagicLink({ product: 'testmandi', phone: u.phone, kind: 'test', ref: t.code, title: t.title, qids: t.qids, durationMin: t.durationMin, ttlMin: minsLeft });
          await send('testmandi', u.phone, { type: 'link', text: `🔴 LIVE now: ${t.title}\nJoin in the next ${minsLeft} min to be ranked on the live leaderboard.`, url, label: 'Join live test' });
          sent++;
        } else if (process.env.TEMPLATE_LIVE_START) {
          await send('testmandi', u.phone, { type: 'template', name: process.env.TEMPLATE_LIVE_START, params: [t.title, String(minsLeft)] });
          sent++;
        }
      }
    }
  }
  return sent;
}
