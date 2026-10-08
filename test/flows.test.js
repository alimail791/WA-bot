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
test('YNeet: quiz → free mock → paid 10-mock pack unlocks analysis', async () => {
  const P = 'yneet', ph = '919000000001';
  let m = await say(P, ph, 'Hi');
  assert.match(textOf(m), /Welcome to YNeet/);
  m = await tap(P, ph, m, 'y:quiz');
  m = await answerChatQuiz(P, ph, m);
  assert.match(textOf(m), /Today's score: 3\/3/);
  assert.match(textOf(m), /Streak: 1 day/);

  m = await tap(P, ph, m, 'y:mock');
  const link = lastLink(m);
  assert.ok(link.url.includes('/t/'));
  await takeWebTest(link.url, 'half');
  m = fresh(P, ph);
  assert.match(textOf(m), /Score: \d+\/720/);
  const pack = choice(m, 'buy:pack10');
  m = await say(P, ph, pack.title, pack.id);
  await payLink(lastLink(m).url);
  m = fresh(P, ph);
  const t = textOf(m);
  assert.match(t, /10 mocks with analysis added/);
  assert.match(t, /Full analysis/);
  assert.match(t, /Estimated rank range/);
  const u = await db.users.findOne({ product: P, phone: ph });
  assert.equal(u.mockCredits, 10);
  assert.equal(u.credits.analysis, 9, 'one credit used for the mock just taken');

  // Second mock now uses a credit instead of asking to pay
  m = await say(P, ph, 'MOCK');
  assert.ok(lastLink(m));
  assert.equal((await db.users.findOne({ product: P, phone: ph })).mockCredits, 9);
});

test('YNeet: referral gives both students a free analysis', async () => {
  const P = 'yneet', a = '919000000010', b = '919000000011';
  await say(P, a, 'Hi');
  const m = await say(P, a, '', 'y:refer');
  const code = textOf(m).match(/REF(?: |%20)([A-Z0-9]{6})/)[1];
  let mb = await say(P, b, `Hi REF ${code}`);
  mb = await tap(P, b, mb, 'y:quiz');
  mb = await answerChatQuiz(P, b, mb, false);
  assert.match(textOf(mb), /invite gave you 1 free analysis/);
  assert.equal((await db.users.findOne({ product: P, phone: a })).credits.analysis, 1);
  assert.equal((await db.users.findOne({ product: P, phone: b })).credits.analysis, 1);
});

test('YNeet: free mock only once, then plans', async () => {
  const P = 'yneet', ph = '919000000020';
  await say(P, ph, 'Hi');
  let m = await say(P, ph, 'MOCK');
  assert.ok(lastLink(m));
  m = await say(P, ph, 'MOCK');
  assert.match(textOf(m), /used your free mock/);
  assert.ok(choice(m, 'buy:pack10'));
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
  assert.match(textOf(m), /14-day Pro trial/);
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

test('ClassCoach: free tutor sees upgrade prompt when class passes 20', async () => {
  const P = 'classcoach', tutor = '919000000050';
  await say(P, tutor, 'Hi', '', 'Meena');
  await db.users.updateOne({ product: P, phone: tutor }, { $set: { trialEndsAt: new Date(Date.now() - 1000) } });
  let m = await say(P, tutor, 'CLASS');
  const code = textOf(m).match(/Class code: ([A-Z0-9]{5})/)[1];
  for (let i = 0; i < 21; i++) await say(P, `91800000${String(i).padStart(4, '0')}`, `JOIN ${code}`);
  m = fresh(P, tutor);
  assert.match(textOf(m), /more than the free 20/);
  m = await tap(P, tutor, m, 'cc:plans');
  m = await tap(P, tutor, m, 'cc:buy:pro50');
  await payLink(lastLink(m).url);
  m = fresh(P, tutor);
  assert.match(textOf(m), /Pro 50 students is active/);
});

test('Unfinished payment gets one reminder', async () => {
  const P = 'yneet', ph = '919000000060';
  await say(P, ph, 'Hi');
  const m = await say(P, ph, '', 'buy:season');
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
  assert.match(textOf(fresh('yneet', '919000000080')), /Welcome to YNeet, Kiran/);
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
