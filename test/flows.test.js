// End-to-end tests of the three flows using the in-memory store and the simulator provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';
process.env.PORT = '0';

const { connect, db } = await import('../src/store.js');
const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const { handleInbound } = await import('../src/engine.js');
const sim = await import('../src/providers/sim.js');
const { clamp } = await import('../src/providers/index.js');
const { nudgeAbandonedOrders } = await import('../src/nudges.js');
const { config } = await import('../src/config.js');

let server, base;
before(async () => {
  await connect();
  await seed();
  await (await import('../src/bank.js')).ensureNeetBank();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  config.baseUrl = base;
});
after(() => server.close());

// ---- helpers ----
const cursor = {};
async function say(product, phone, text, replyId = '', name = '') {
  await handleInbound({ product, phone, text, replyId, name });
  return fresh(product, phone);
}
function fresh(product, phone) {
  const k = product + phone;
  const all = sim.messages(product, phone);
  const out = all.slice(cursor[k] || 0);
  cursor[k] = all.length;
  return out;
}
const textOf = (msgs) => msgs.map((m) => m.text || '').join('\n---\n');
function choice(msgs, match) {
  for (const m of [...msgs].reverse()) {
    if (m.type === 'buttons') { const b = m.buttons.find((x) => x.id.includes(match) || x.title.includes(match)); if (b) return b; }
    if (m.type === 'list') for (const s of m.sections) { const r = s.rows.find((x) => x.id.includes(match) || x.title.includes(match)); if (r) return r; }
  }
  throw new Error(`No choice matching "${match}" in:\n${JSON.stringify(msgs, null, 1)}`);
}
const tap = (product, phone, msgs, match) => { const c = choice(msgs, match); return say(product, phone, c.title, c.id); };
const lastLink = (msgs) => [...msgs].reverse().find((m) => m.type === 'link');

async function answerChatQuiz(product, phone, msgs, wantRight = true) {
  for (let guard = 0; guard < 20; guard++) {
    const ask = [...msgs].reverse().find((m) => (m.type === 'buttons' || m.type === 'list') && (m.buttons?.[0]?.id || m.sections?.[0]?.rows?.[0]?.id || '').startsWith('ans:'));
    if (!ask) return msgs;
    const s = (await db.sessions.findOne({ product, phone })).data.quiz;
    const q = await db.questions.findOne({ _id: s.qids[s.i] });
    const opt = wantRight ? q.answer : (q.answer + 1) % q.options.length;
    msgs = await say(product, phone, '', `ans:${s.i}:${opt}`);
  }
  throw new Error('quiz did not finish');
}

async function takeWebTest(url, pick = 'right') {
  const tok = url.split('/t/')[1];
  const page = await fetch(`${base}/t/${tok}`);
  assert.equal(page.status, 200);
  const row = await db.tokens.findOne({ token: tok });
  const qs = await db.questions.find({ _id: { $in: row.qids } });
  const form = new URLSearchParams();
  qs.forEach((q, i) => form.set(`q_${q._id}`, String(pick === 'right' || i % 2 === 0 ? q.answer : (q.answer + 1) % q.options.length)));
  const res = await fetch(`${base}/t/${tok}`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const again = await fetch(`${base}/t/${tok}`, { method: 'POST', body: form });
  assert.equal(again.status, 409, 'a magic link can only be submitted once');
  return { row, qs };
}

async function payLink(url) {
  const id = url.split('/dev/pay/')[1];
  assert.ok(id, 'dev payment link expected, got ' + url);
  const res = await fetch(`${base}/dev/pay/${id}`, { method: 'POST' });
  assert.equal(res.status, 200);
  return id;
}

// ---- tests ----
async function yneetUser(ph, cls = '12th', name = 'Student') {
  let m = await say('yneet', ph, 'Hi', '', name);
  assert.match(textOf(m), /Which class are you in\?/);
  return say('yneet', ph, '', `y:cls:${cls}`);
}

test('YNeet: class first, daily quiz, free NEET-pattern mock, ₹99 unlock, then unlimited mocks', async () => {
  const P = 'yneet', ph = '919000000001';
  let m = await yneetUser(ph);
  assert.ok(choice(m, 'Free NEET mock'));
  m = await tap(P, ph, m, 'y:quiz');
  m = await answerChatQuiz(P, ph, m);
  assert.match(textOf(m), /Today's score: 3\/3/);

  m = await tap(P, ph, m, 'y:mock');
  const link = lastLink(m);
  assert.match(link.text, /Physics 45 · Chemistry 45 · Biology 90/);
  const { row } = await takeWebTest(link.url, 'half');
  assert.equal(row.qids.length, 180);
  m = fresh(P, ph);
  assert.match(textOf(m), /Score: \d+\/720/);
  assert.doesNotMatch(textOf(m), /Estimated rank/, 'rank estimate is a paid feature');
  m = await tap(P, ph, m, 'y:buy:trial5d');
  assert.match(textOf(m), /₹99/);
  await payLink(lastLink(m).url);
  m = fresh(P, ph);
  assert.match(textOf(m), /Full access till/);
  const u = await db.users.findOne({ product: P, phone: ph });
  assert.ok(new Date(u.plan.until) - Date.now() > 4.9 * 86400e3);
  assert.ok(u.mistakes.length > 0, 'wrong answers from the mock are saved');
  m = await say(P, ph, 'MOCK');
  assert.ok(lastLink(m), 'plan holders get unlimited mocks');
});

test('YNeet: monthly price follows the class, ends at month end', async () => {
  const P = 'yneet', ph = '919000000005';
  await yneetUser(ph, 'Dropper');
  let m = await say(P, ph, 'PLANS');
  assert.ok(choice(m, 'Monthly · ₹600'));
  m = await say(P, ph, '', 'y:buy:monthly');
  assert.match(textOf(m), /Class Dropper/);
  await payLink(lastLink(m).url);
  const u = await db.users.findOne({ product: P, phone: ph });
  const until = new Date(u.plan.until);
  const ist = new Date(until.getTime() + 5.5 * 3600e3 + 2000);
  assert.equal(ist.getUTCDate(), 1, 'access ends at the last second of the month (IST)');
});

test('YNeet: chapter practice, free daily chapter test, PYQ needs a plan', async () => {
  const P = 'yneet', ph = '919000000006';
  let m = await yneetUser(ph);
  m = await say(P, ph, 'CHAPTER');
  m = await tap(P, ph, m, 'y:subj:B:0');
  assert.match(textOf(m), /Biology: 38 chapters/);
  m = await tap(P, ph, m, 'y:ch:B:0');
  assert.match(textOf(m), /Anatomy of Flowering Plants/);
  m = await tap(P, ph, m, 'y:chq:B:0');
  m = await answerChatQuiz(P, ph, m, false);
  assert.match(textOf(m), /Score: 0\/5/);
  assert.equal((await db.users.findOne({ product: P, phone: ph })).mistakes.length, 5);
  m = await tap(P, ph, m, 'y:cht:B:0');
  const { qs } = await takeWebTest(lastLink(m).url);
  assert.ok(qs.every((q) => q.topic === 'Anatomy of Flowering Plants'));
  m = await say(P, ph, '', 'y:cht:B:1');
  assert.match(textOf(m), /used today's free chapter test/);
  m = await say(P, ph, 'PYQ');
  assert.ok(choice(m, 'NEET 2025'));
  m = await tap(P, ph, m, 'y:yr:2025');
  assert.match(textOf(m), /part of full access/);
});

test('YNeet: revise mistakes clears the ones you get right', async () => {
  const P = 'yneet', ph = '919000000007';
  await yneetUser(ph);
  let m = await say(P, ph, '', 'y:chq:P:0');
  await answerChatQuiz(P, ph, m, false);
  assert.equal((await db.users.findOne({ product: P, phone: ph })).mistakes.length, 5);
  m = await say(P, ph, 'MISTAKES');
  m = await answerChatQuiz(P, ph, m, true);
  assert.match(textOf(m), /All mistakes cleared/);
  assert.equal((await db.users.findOne({ product: P, phone: ph })).mistakes.length, 0);
});

test('YNeet referral: free premium test for both, free month when friend buys monthly', async () => {
  const P = 'yneet', a = '919000000010', b = '919000000011';
  await yneetUser(a, '12th', 'Arjun Kumar');
  const m = await say(P, a, '', 'y:refer');
  const code = textOf(m).match(/REF(?: |%20)([A-Z0-9]{6})/)[1];
  let mb = await say(P, b, `Hi REF ${code}`);
  mb = await say(P, b, '', 'y:cls:11th');
  mb = await tap(P, b, mb, 'y:quiz');
  mb = await answerChatQuiz(P, b, mb, false);
  assert.match(textOf(mb), /invite gave you a free premium test/);
  assert.equal((await db.users.findOne({ product: P, phone: a })).credits.test, 1);
  assert.equal((await db.users.findOne({ product: P, phone: b })).credits.test, 1);
  // Credit unlocks a PYQ paper
  mb = await say(P, b, '', 'y:yr:2024');
  assert.match(textOf(mb), /Free premium test used/);
  // Friend buys monthly → inviter gets a free month
  mb = await say(P, b, '', 'y:buy:monthly');
  assert.match(textOf(mb), /₹500/);
  await payLink(lastLink(mb).url);
  const ua = await db.users.findOne({ product: P, phone: a });
  assert.ok(new Date(ua.plan.until) - Date.now() > 29 * 86400e3);
});

test('YNeet: weekly leaderboard', async () => {
  const P = 'yneet';
  const m = await say(P, '919000000001', 'RANK');
  assert.match(textOf(m), /This week's top NEET mock scores/);
  assert.match(textOf(m), /You: #1/);
});

test('YNeet bridge: web subscribers get access on WhatsApp; WhatsApp purchases unlock app.yneet.in', async () => {
  const bridge = await import('../src/yneetBridge.js');
  const granted = [];
  bridge.setImpl({
    lookup: async (phone) => (phone === '919000000020' ? { userId: 'u1', classLevel: '11th', active: true, endDate: new Date(Date.now() + 9 * 86400e3) } : { userId: 'u2', classLevel: '12th', active: false }),
    grant: async (g) => { granted.push(g); return true; },
  });
  try {
    const P = 'yneet';
    let m = await say(P, '919000000020', 'Hi');
    m = await say(P, '919000000020', '', 'y:cls:11th');
    assert.match(textOf(m), /Full access till .* \(your YNeet plan\)/);
    m = await say(P, '919000000020', '', 'y:yr:2023');
    assert.ok(lastLink(m), 'web plan unlocks PYQ papers on WhatsApp');
    await yneetUser('919000000021');
    m = await say(P, '919000000021', '', 'y:buy:trial5d');
    await payLink(lastLink(m).url);
    assert.equal(granted.length, 1);
    assert.equal(granted[0].planKey, 'TRIAL_5D');
    assert.equal(granted[0].amountPaise, 9900);
    assert.match(textOf(fresh(P, '919000000021')), /app\.yneet\.in account is unlocked too/);
  } finally { bridge.setImpl(null); }
});

test('TestMandi: sample → buy → test → rank, seller gets alert with share', async () => {
  const P = 'testmandi', ph = '919000000030', seller = '919999900001';
  await say(P, seller, 'SELLER'); // seller messaged today, so free-form alerts are allowed
  fresh(P, seller);
  let m = await say(P, ph, 'TEST SSC-GK-101');
  assert.match(textOf(m), /SSC CGL GK Mock 1/);
  m = await tap(P, ph, m, 'tm:sample');
  m = await answerChatQuiz(P, ph, m);
  assert.match(textOf(m), /Sample score: 5\/5/);
  m = await tap(P, ph, m, 'tm:buy');
  await payLink(lastLink(m).url);
  m = fresh(P, ph);
  assert.match(textOf(m), /Payment received: ₹29/);
  await takeWebTest(lastLink(m).url);
  m = fresh(P, ph);
  assert.match(textOf(m), /Rank: 1 of 1/);
  m = await tap(P, ph, m, 'tm:rate');
  assert.match(textOf(m), /Thanks for rating/);
  assert.ok(choice(m, 'SSC-GK-PACK'), 'bundle offered after the test');
  const sm = fresh(P, seller);
  assert.match(textOf(sm), /New sale · SSC CGL GK Mock 1/);
  assert.match(textOf(sm), /Your share ₹20.3/);
});

test('TestMandi: bundle unlocks all its tests', async () => {
  const P = 'testmandi', ph = '919000000031';
  let m = await say(P, ph, 'TEST SSC-GK-PACK');
  assert.match(textOf(m), /You save ₹9/);
  m = await tap(P, ph, m, 'tm:bundle');
  await payLink(lastLink(m).url);
  m = fresh(P, ph);
  assert.ok(choice(m, 'tm:start:SSC-GK-102'));
  const u = await db.users.findOne({ product: P, phone: ph });
  assert.deepEqual(u.purchases.sort(), ['SSC-GK-101', 'SSC-GK-102']);
});

test('ClassCoach: tutor makes quiz, student joins and submits, tutor sees results', async () => {
  const P = 'classcoach', tutor = '919000000040', st = '919000000041';
  let m = await say(P, tutor, 'Hi', '', 'Ravi Kumar');
  assert.match(textOf(m), /1-month free trial/);
  m = await tap(P, tutor, m, 'cc:new');
  m = await tap(P, tutor, m, 'cc:subj:Class 10 Science');
  m = await say(P, tutor, 'Light');
  assert.match(textOf(m), /Quiz ready: Class 10 Science · Light/);
  m = await tap(P, tutor, m, 'cc:send');
  const code = textOf(m).match(/JOIN(?: |%20)([A-Z0-9]{5})/)[1];

  let s = await say(P, st, `JOIN ${code}`, '', 'Priya');
  assert.match(textOf(s), /You joined Ravi's class/);
  await takeWebTest(lastLink(s).url);
  s = fresh(P, st);
  assert.match(textOf(s), /Submitted: \d+\/\d+/);

  m = fresh(P, tutor);
  assert.match(textOf(m), /Everyone in Ravi's class has finished/);
  m = await say(P, tutor, '', 'cc:results');
  assert.match(textOf(m), /Attempted: 1 of 1/);
  assert.match(textOf(m), /Priya/);
});

test('ClassCoach: trial allows 10 students, then the class is full until the tutor upgrades', async () => {
  const P = 'classcoach', tutor = '919000000050';
  await say(P, tutor, 'Hi', '', 'Meena');
  let m = await say(P, tutor, 'CLASS');
  const code = textOf(m).match(/Class code: ([A-Z0-9]{5})/)[1];
  for (let i = 0; i < 10; i++) await say(P, `91800000${String(i).padStart(4, '0')}`, `JOIN ${code}`);
  m = fresh(P, tutor);
  assert.match(textOf(m), /10 of 10 students/);
  const extra = await say(P, '918000000099', `JOIN ${code}`);
  assert.match(textOf(extra), /is full right now/);
  m = await say(P, tutor, 'PLANS');
  assert.ok(choice(m, 'Growth · 50 students'));
  assert.ok(choice(m, 'NEET/JEE 50 · monthly'));
  m = await tap(P, tutor, m, 'cc:buy:growth');
  assert.match(textOf(m), /₹999 for 3 months/);
  await payLink(lastLink(m).url);
  m = fresh(P, tutor);
  assert.match(textOf(m), /Growth · 50 students is active till/);
  const ok = await say(P, '918000000099', `JOIN ${code}`);
  assert.match(textOf(ok), /You joined/);
});

test('ClassCoach: NEET bank subjects need the trial or a NEET/JEE plan', async () => {
  const P = 'classcoach', tutor = '919000000055';
  await say(P, tutor, 'Hi', '', 'Kavya');
  await db.users.updateOne({ product: P, phone: tutor }, { $set: { trialEndsAt: new Date(Date.now() - 1000), plan: { id: 'growth', students: 50, track: 'general', until: new Date(Date.now() + 9e8) } } });
  let m = await say(P, tutor, 'QUIZ');
  assert.ok(choice(m, 'NEET Biology'));
  m = await tap(P, tutor, m, 'cc:subj:NEET Biology');
  assert.match(textOf(m), /part of the NEET\/JEE plans/);
  await db.users.updateOne({ product: P, phone: tutor }, { $set: { plan: { id: 'nj50_m', students: 50, track: 'neet_jee', until: new Date(Date.now() + 9e8) } } });
  m = await say(P, tutor, '', 'cc:subj:NEET Biology');
  m = await say(P, tutor, 'Genetics');
  assert.match(textOf(m), /Quiz ready: NEET Biology · Genetics/);
});

test('Unfinished payment gets one reminder', async () => {
  const P = 'yneet', ph = '919000000060';
  await yneetUser(ph);
  const m = await say(P, ph, '', 'y:buy:trial5d');
  assert.ok(lastLink(m));
  const order = await db.orders.findOne({ product: P, phone: ph, status: 'created' });
  await db.orders.updateOne({ _id: order._id }, { $set: { createdAt: new Date(Date.now() - 40 * 60e3) } });
  assert.equal(await nudgeAbandonedOrders(), 1);
  assert.match(textOf(fresh(P, ph)), /is waiting/);
  assert.equal(await nudgeAbandonedOrders(), 0, 'only one reminder');
});

test('STOP opts out', async () => {
  const m = await say('yneet', '919000000070', 'STOP');
  assert.match(textOf(m), /won't get reminders/);
  assert.equal((await db.users.findOne({ product: 'yneet', phone: '919000000070' })).optedOut, true);
});

test('WhatsApp limits are enforced', () => {
  const m = clamp({ type: 'buttons', text: 'x', buttons: [1, 2, 3, 4].map((i) => ({ id: 'b' + i, title: 'A very long button title ' + i })) });
  assert.equal(m.buttons.length, 3);
  assert.ok(m.buttons.every((b) => b.title.length <= 20));
});

test('CSV import accepts common column names', async () => {
  const csv = 'Subject,Chapter,Question,Option A,Option B,Option C,Option D,Correct Answer,Explanation\nPhysics,Optics,"Speed of light, in vacuum?",3x10^8 m/s,3x10^6 m/s,3x10^5 m/s,3x10^4 m/s,A,Standard value\nBiology,Cells,Bad row,,,,,Z,\n';
  const res = await fetch(`${base}/admin/questions/import?product=yneet&dryRun=1`, { method: 'POST', headers: { 'x-api-key': config.adminKey, 'Content-Type': 'text/csv' }, body: csv });
  const j = await res.json();
  assert.equal(j.valid, 1);
  assert.equal(j.skipped, 1);
});

test('WhatsApp webhook payload is parsed and routed', async () => {
  config.wa.numbers.yneet = 'PNID1';
  const body = { entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PNID1' }, contacts: [{ wa_id: '919000000080', profile: { name: 'Kiran' } }], messages: [{ id: 'wamid.1', from: '919000000080', type: 'text', text: { body: 'Hi' } }] } }] }] };
  const res = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.match(textOf(fresh('yneet', '919000000080')), /Welcome to YNeet!/);
});

test('One shared number: user picks a product, deep links route directly', async () => {
  config.wa.sharedNumberId = 'SHARED1';
  const hook = (from, msg) => fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'SHARED1' }, contacts: [{ wa_id: from, profile: { name: 'Asha' } }], messages: [{ id: 'w' + Math.random(), from, ...msg }] } }] }] }) });
  const wait = () => new Promise((r) => setTimeout(r, 60));
  const ph = '919000000090';
  await hook(ph, { type: 'text', text: { body: 'Hi' } }); await wait();
  assert.match(textOf(fresh('yneet', ph)), /Welcome to Raise Academy/);
  await hook(ph, { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'pick:testmandi', title: 'Buy mock tests' } } }); await wait();
  assert.match(textOf(fresh('testmandi', ph)), /Welcome to TestMandi/);
  await hook(ph, { type: 'text', text: { body: 'Hi' } }); await wait();
  assert.match(textOf(fresh('testmandi', ph)), /Hi! 👋/, 'remembers the chosen product');
  await hook('919000000091', { type: 'text', text: { body: 'JOIN ABCDE' } }); await wait();
  assert.match(textOf(fresh('classcoach', '919000000091')), /couldn't find class/);
});

test('Template messages go through AiSensy Campaign API when its key is set', async () => {
  const { send } = await import('../src/providers/index.js');
  const realFetch = globalThis.fetch, prev = { p: config.provider, k: config.aisensy.apiKey };
  let call;
  globalThis.fetch = async (url, opts) => { call = { url, body: JSON.parse(opts.body) }; return new Response('{"success":true}', { status: 200 }); };
  try {
    config.provider = 'meta'; config.aisensy.apiKey = 'KEY123';
    const r = await send('yneet', '919000000099', { type: 'template', name: 'daily_quiz', params: [3] });
    assert.equal(r.ok, true);
    assert.match(call.url, /aisensy\.com\/campaign/);
    assert.deepEqual(call.body, { apiKey: 'KEY123', campaignName: 'daily_quiz', destination: '919000000099', userName: 'Raise Academy', templateParams: ['3'], source: 'wa-bot' });
  } finally { globalThis.fetch = realFetch; config.provider = prev.p; config.aisensy.apiKey = prev.k; }
});

test('Live mode without Razorpay never gives out the free test-payment page', async () => {
  const { createOrder } = await import('../src/payments.js');
  const prev = config.provider;
  config.provider = 'meta';
  try {
    await assert.rejects(createOrder({ product: 'yneet', phone: '919000000112', item: 'pack10', title: 'x', amount: 199 }), (e) => e.code === 'NO_PAYMENTS');
  } finally { config.provider = prev; }
});

test('TestMandi catalogue: categories, paging, search and free tests', async () => {
  const P = 'testmandi', ph = '919000000200';
  let m = await say(P, ph, 'Hi');
  m = await tap(P, ph, m, 'tm:browse');
  const cats = choice(m, 'Most popular') && m.at(-1).sections[0].rows.map((r) => r.title);
  assert.ok(cats.includes('SSC') && cats.includes('TNPSC') && cats.includes('General Knowledge'));
  m = await tap(P, ph, m, 'tm:cat:SSC');
  const titles = m.at(-1).sections[0].rows.map((r) => r.title);
  assert.ok(titles.includes('SSC CGL GK Mock 1') && !titles.includes('TNPSC Group 4 GK Mock'));
  // search
  m = await say(P, ph, 'SEARCH tnpsc');
  assert.match(textOf(m), /1 test for "tnpsc"/);
  m = await say(P, ph, '', 'tm:search');
  m = await say(P, ph, 'nothing-matches-this');
  assert.match(textOf(m), /No tests found/);
  // free test unlocks without payment
  m = await say(P, ph, 'TEST GK-FREE-1');
  assert.match(textOf(m), /FREE/);
  m = await tap(P, ph, m, 'tm:buy:GK-FREE-1');
  assert.ok(lastLink(m).url.includes('/t/'), 'free test goes straight to the test link');
  assert.equal(await db.orders.count({ phone: ph, status: 'created' }), 0);

  // paging: add 9 more SSC tests so SSC has 11
  const qids = (await db.tests.findOne({ code: 'SSC-GK-101' })).qids;
  for (let i = 0; i < 9; i++) await db.tests.insertOne({ code: `SSC-X-${i}`, title: `SSC Extra ${i}`, category: 'SSC', type: 'test', price: 9, durationMin: 5, qids, sellerName: 'Raise Academy', sellerPhone: '919999900001', attemptsCount: 0, ratingSum: 0, ratingCount: 0 });
  m = await say(P, ph, '', 'tm:cat:SSC:0');
  assert.ok(choice(m, 'More tests'));
  m = await tap(P, ph, m, 'tm:cat:SSC:1');
  assert.match(textOf(m), /page 2/);
  await db.tests.deleteMany({ category: 'SSC', title: { $ne: 'x' }, code: { $in: Array.from({ length: 9 }, (_, i) => `SSC-X-${i}`) } });
});

test('TestMandi buyer referral: friend discount, inviter wallet credit, wallet used next time', async () => {
  const P = 'testmandi', a = '919000000210', b = '919000000211';
  await say(P, a, 'Hi');
  let m = await say(P, a, 'REFER');
  const code = textOf(m).match(/TREF(?: |%20)([A-Z0-9]{6})/)[1];
  let mb = await say(P, b, `Hi TREF ${code}`);
  assert.match(textOf(mb), /₹10 off your first test/);
  mb = await say(P, b, 'TEST SSC-GK-101');
  assert.match(textOf(mb), /You pay: ₹19/);
  mb = await tap(P, b, mb, 'tm:buy:SSC-GK-101');
  assert.match(textOf(mb), /SSC CGL GK Mock 1 · ₹19/);
  await payLink(lastLink(mb).url);
  const ua = await db.users.findOne({ product: P, phone: a });
  assert.equal(ua.wallet, 10);
  // A now buys with wallet credit
  m = await say(P, a, 'TEST TNPSC-GK-1');
  assert.match(textOf(m), /Wallet: −₹10/);
  m = await tap(P, a, m, 'tm:buy:TNPSC-GK-1');
  assert.match(textOf(m), /₹9/);
  await payLink(lastLink(m).url);
  assert.equal((await db.users.findOne({ product: P, phone: a })).wallet, 0);
  // Second purchase by B gives no extra reward
  mb = await say(P, b, '', 'tm:buy:TNPSC-GK-1');
  await payLink(lastLink(mb).url);
  assert.equal((await db.users.findOne({ product: P, phone: a })).wallet, 0);
});

test('TestMandi wallet that covers the full price unlocks without payment', async () => {
  const P = 'testmandi', ph = '919000000220';
  await say(P, ph, 'Hi');
  await db.users.updateOne({ product: P, phone: ph }, { $set: { wallet: 100 } });
  const m = await say(P, ph, '', 'tm:buy:SSC-GK-102');
  assert.match(textOf(m), /Unlocked with your discount and wallet credit/);
  assert.ok(lastLink(m).url.includes('/t/'));
  assert.equal((await db.users.findOne({ product: P, phone: ph })).wallet, 71);
});

test('TestMandi seller referral: inviter earns 5% of the new seller\'s sales', async () => {
  const P = 'testmandi', inviter = '919999900001', teacher = '919000000230', buyer = '919000000231';
  let m = await say(P, inviter, 'SELLER');
  const code = textOf(m).match(/SREF(?: |%20)([A-Z0-9]{6})/)[1];
  m = await say(P, teacher, `Hi SREF ${code}`);
  assert.match(textOf(m), /Your invite is saved/);
  const res = await fetch(`${base}/admin/tests`, { method: 'POST', headers: { 'x-api-key': config.adminKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'NEW-T-1', title: 'New Teacher Mock', category: 'SSC', price: 100, product: 'testmandi', tag: 'sample', count: 5, sellerPhone: teacher, sellerName: 'New Teacher' }) });
  assert.equal(res.status, 200);
  const before = (await db.users.findOne({ product: P, phone: inviter })).seller?.earnings || 0;
  fresh(P, inviter);
  const mb = await say(P, buyer, '', 'tm:buy:NEW-T-1');
  await payLink(lastLink(mb).url);
  const after = await db.users.findOne({ product: P, phone: inviter });
  assert.equal(Math.round((after.seller.earnings - before) * 100) / 100, 5);
  assert.match(textOf(fresh(P, inviter)), /Referral bonus: ₹5/);
  assert.equal((await db.users.findOne({ product: P, phone: teacher })).seller.earnings, 70);
});

test('ClassCoach referral: every 2 invited teachers who buy = 3 months free', async () => {
  const P = 'classcoach', a = '919000000240';
  await say(P, a, 'Hi', '', 'Ravi');
  const m = await say(P, a, 'REFER');
  const code = textOf(m).match(/CREF(?: |%20)([A-Z0-9]{6})/)[1];
  const trialEnd = new Date((await db.users.findOne({ product: P, phone: a })).trialEndsAt);
  for (const b of ['919000000241', '919000000242']) {
    const mb = await say(P, b, `Hi CREF ${code}`, '', 'Teacher');
    assert.match(textOf(mb), /invited by a fellow teacher/);
    const buy = await say(P, b, '', 'cc:buy:starter');
    await payLink(lastLink(buy).url);
  }
  const ua = await db.users.findOne({ product: P, phone: a });
  assert.equal(ua.referralRewardsGranted, 1);
  const added = (new Date(ua.trialEndsAt) - trialEnd) / 86400e3;
  assert.ok(added > 88 && added < 93, 'trial extended by 3 months');
  const msgs = textOf(fresh(P, a));
  assert.match(msgs, /1 more and you get 3 months free/);
  assert.match(msgs, /3 months added free/);
});

test('TestMandi sync: tests, bundles and sellers come from testmandi.in; WhatsApp sales are recorded there', async () => {
  const sync = await import('../src/testmandiSync.js');
  const q = (text, correct) => ({ text, options: ['A1', 'B2', 'C3', 'D4'], correct, topic: 'Topic ' + correct, explanation: 'because' });
  const source = {
    sellerSharePercent: 70,
    users: [{ email: 'raise@tm.in', phone: '98765 43210', role: 'seller', referralCode: 'RAIS1234', businessName: 'Raise' }],
    tests: [
      { id: 't_100', title: 'NEET Physics Chapter 1', category: 'NEET', price: 49, duration: 20, sellerEmail: 'raise@tm.in', sellerName: 'Raise', rating: 4.5, ratingCount: 20, questions: [q('Q1?', 0), q('Q2?', 1), q('Q3?', 2)] },
      { id: 't_101', title: 'NEET Free Starter', category: 'NEET', price: 0, duration: 10, sellerEmail: 'raise@tm.in', sellerName: 'Raise', rating: 0, ratingCount: 0, questions: [q('F1?', 3)] },
      { id: 't_102', title: 'Bad Test', category: 'JEE Main', price: 10, duration: 10, sellerEmail: 'raise@tm.in', rating: 2, ratingCount: 50, questions: [q('B?', 0)] },
    ],
    bundles: [{ id: 'b_1', title: 'NEET Starter Pack', price: 39, testIds: ['t_100', 't_101'], sellerEmail: 'raise@tm.in', sellerName: 'Raise' }],
  };
  let r = await sync.syncFrom(source);
  assert.equal(r.created, 3);
  const code = sync.codeFor('t_100');
  const t = await db.tests.findOne({ code });
  assert.equal(t.title, 'NEET Physics Chapter 1');
  assert.equal(t.sellerPhone, '919876543210');
  assert.equal(t.qids.length, 3);
  assert.equal((await db.tests.findOne({ tmId: 't_102' })).listed, false, 'low-rated tests hidden, like on the website');
  // re-sync without changes keeps questions; removing a test unlists it
  r = await sync.syncFrom({ ...source, tests: source.tests.slice(0, 2) });
  assert.equal(r.questionsWritten, 0);
  // Buy over WhatsApp → sale recorded in TestMandi purchases at list price
  const sales = [];
  sync.setSaleSink((coll, rec) => sales.push({ coll, rec }));
  const P = 'testmandi', ph = '919000000300';
  await say(P, ph, 'Hi');
  const m = await say(P, ph, '', `tm:buy:${code}`);
  await payLink(lastLink(m).url);
  assert.equal(sales.length, 1);
  assert.equal(sales[0].coll, 'purchases');
  assert.equal(sales[0].rec.testId, 't_100');
  assert.equal(sales[0].rec.price, 49);
  assert.equal(sales[0].rec.buyerEmail, '919000000300@whatsapp.testmandi.in');
  // Seller sees TestMandi referral code; teacher invited with it gets sign-up steps
  const s = await say(P, '919876543210', 'SELLER');
  assert.match(textOf(s), /RAIS1234/);
  const inv = await say(P, '919000000301', 'Hi SREF RAIS1234');
  assert.match(textOf(inv), /Enter referral code \*RAIS1234\*/);
  sync.setSaleSink(null);
});

test('TestMandi category list pages when there are many exams', async () => {
  const qids = (await db.tests.findOne({ code: 'SSC-GK-101' })).qids;
  for (let i = 0; i < 15; i++) await db.tests.insertOne({ code: `CAT-${i}`, title: `Exam ${i} Mock`, category: `Exam ${String(i).padStart(2, '0')}`, type: 'test', price: 5, durationMin: 5, qids, sellerName: 'X', attemptsCount: 0, ratingSum: 0, ratingCount: 0 });
  const P = 'testmandi', ph = '919000000310';
  let m = await say(P, ph, 'BROWSE');
  const rows = m.at(-1).sections[0].rows;
  assert.ok(rows.length <= 10);
  assert.ok(rows.some((r) => r.id === 'tm:cats:1'));
  m = await say(P, ph, '', 'tm:cats:1');
  assert.match(textOf(m), /More exams \(page 2\)/);
  await db.tests.deleteMany({ code: { $in: Array.from({ length: 15 }, (_, i) => `CAT-${i}`) } });
});

test('Website buttons ("Hi YNeet", "Hi TestMandi", "Hi ClassCoach") open the right product on the shared number', async () => {
  config.wa.sharedNumberId = 'SHARED1';
  const hook = (from, body) => fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'SHARED1' }, contacts: [{ wa_id: from, profile: { name: 'Web' } }], messages: [{ id: 'w' + Math.random(), from, type: 'text', text: { body } }] } }] }] }) });
  const wait = () => new Promise((r) => setTimeout(r, 80));
  await hook('919000000400', 'Hi YNeet'); await wait();
  assert.match(textOf(fresh('yneet', '919000000400')), /Which class are you in/);
  await hook('919000000401', 'Hi TestMandi'); await wait();
  assert.match(textOf(fresh('testmandi', '919000000401')), /Welcome to TestMandi/);
  await hook('919000000402', 'Hi ClassCoach'); await wait();
  assert.match(textOf(fresh('classcoach', '919000000402')), /Welcome to ClassCoach/);
  await hook('919000000400', 'Hi'); await wait();
  assert.equal(fresh('yneet', '919000000400').length > 0, true, 'choice is remembered');
});

test('ClassCoach link: classcoach.in plan is used on WhatsApp; WhatsApp purchase is applied on classcoach.in', async () => {
  const cc = await import('../src/classcoachBridge.js');
  const applied = [];
  const webTeacher = { id: 7, name: 'Lakshmi', email: 'lak@x.in', plan: 'growth', track: 'general', maxStudents: 50, planExpiresAt: '2027-01-15 10:00:00', planActive: true, students: 31, batches: [{ id: 1 }, { id: 2 }] };
  cc.setImpl({
    lookup: async (phone) => (phone === '919000000500' ? webTeacher : null),
    applyPlan: async (a) => { applied.push(a); return a.phone === '919000000500' ? { ...webTeacher, plan: a.planId, maxStudents: 100, planExpiresAt: '2027-04-15 10:00:00' } : null; },
  });
  try {
    const P = 'classcoach';
    let m = await say(P, '919000000500', 'Hi');
    assert.match(textOf(m), /Linked to your classcoach\.in account \(lak@x\.in\)/);
    const u = await db.users.findOne({ product: P, phone: '919000000500' });
    assert.equal(u.plan.id, 'growth');
    assert.equal(u.plan.students, 50);
    m = await say(P, '919000000500', '', 'cc:buy:pro');
    await payLink(lastLink(m).url);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].planId, 'pro');
    m = fresh(P, '919000000500');
    assert.match(textOf(m), /classcoach\.in account \(lak@x\.in\) is upgraded too/);
    assert.match(textOf(m), /active till 15 Apr 2027/);
    // Not on classcoach.in: told how to link
    m = await say(P, '919000000501', 'Hi');
    assert.match(textOf(m), /Already on classcoach\.in\?/);
  } finally { cc.setImpl(null); }
});
