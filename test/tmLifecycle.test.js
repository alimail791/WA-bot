// TestMandi WhatsApp lifecycle: welcome, verify, refer & earn, we miss you.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';
process.env.TM_LIFECYCLE_SINCE = '2026-11-01T00:00:00Z';

const { connect, db } = await import('../src/store.js');
const sim = await import('../src/providers/sim.js');
const { tmLifecycle, dueKinds, compose, waPhone } = await import('../src/tmLifecycle.js');

const DAY = 86400e3, HOUR = 3600e3;
const now = Date.parse('2026-11-20T06:00:00Z'); // 11:30 IST
const launched = Date.parse(process.env.TM_LIFECYCLE_SINCE);
const user = (o) => ({ id: 'u' + Math.random().toString(36).slice(2), role: 'buyer', name: 'Priya Sharma', phone: '98765 43210', emailVerified: true, phoneVerified: true, referralCode: 'PRIYA7', ...o });

before(async () => { await connect(); });

test('phone numbers', () => {
  assert.equal(waPhone('+91 98765 43210'), '919876543210');
  assert.equal(waPhone('09876543210'), '919876543210');
  assert.equal(waPhone('12345'), null);
});

test('which message is due', () => {
  const none = new Set();
  assert.deepEqual(dueKinds(user({ createdAt: now - HOUR, lastActiveAt: now - HOUR }), now, launched, none), ['welcome']);
  assert.deepEqual(dueKinds(user({ createdAt: Date.parse('2026-10-01'), lastActiveAt: now - HOUR }), now, launched, none), ['refer1'], 'old accounts get no welcome');
  const w = new Set(['welcome']);
  assert.deepEqual(dueKinds(user({ createdAt: now - 3 * HOUR, firstLoginAt: now - 2 * HOUR, emailVerified: false }), now, launched, w), ['verify']);
  assert.deepEqual(dueKinds(user({ createdAt: now - 3 * HOUR, firstLoginAt: now - 10 * 60e3, emailVerified: false }), now, launched, w), [], 'waits an hour after first login');
  assert.deepEqual(dueKinds(user({ createdAt: now - 3 * HOUR, firstLoginAt: now - 2 * HOUR }), now, launched, w), [], 'verified: no alert');
  const away = now - 6 * DAY;
  assert.deepEqual(dueKinds(user({ createdAt: now - 20 * DAY, lastActiveAt: away }), now, launched, new Set(['welcome', 'verify'])), [`missyou:${away}`]);
  assert.deepEqual(dueKinds(user({ createdAt: now - 20 * DAY, lastActiveAt: away }), now, launched, new Set([`missyou:${away}`])), [], 'once per absence');
  const r = new Set(['refer1']); r.lastRefer = now - 10 * DAY;
  assert.deepEqual(dueKinds(user({ createdAt: now - 20 * DAY, lastActiveAt: now - DAY }), now, launched, r), [], 'refer at most every 30 days');
});

test('role-specific refer reward', () => {
  assert.match(compose('refer1', user({ role: 'seller' })).text, /₹200/);
  assert.match(compose('refer1', user({ role: 'advertiser' })).text, /next ad free/);
  assert.match(compose('refer1', user({})).text, /50% off/);
  assert.match(compose('refer1', user({})).url, /\?ref=PRIYA7$/);
});

test('template outside the window, once only, opt-out respected', async () => {
  sim.clear();
  delete process.env.TEMPLATE_TM_WELCOME;
  const fresh = user({ id: 'new1', createdAt: now - HOUR, lastActiveAt: now - HOUR });
  const r0 = await tmLifecycle(now, { source: [fresh] });
  assert.equal(r0.sent, 0); assert.equal(r0.waiting, 1, 'no template yet: waits');
  process.env.TEMPLATE_TM_WELCOME = 'tm_welcome';
  const r1 = await tmLifecycle(now, { source: [fresh] });
  assert.equal(r1.sent, 1);
  const m = sim.messages('testmandi', '919876543210');
  assert.equal(m.at(-1).type, 'template'); assert.equal(m.at(-1).name, 'tm_welcome');
  assert.deepEqual(m.at(-1).params, ['Priya']);
  const r2 = await tmLifecycle(now, { source: [fresh] });
  assert.equal(r2.sent, 0, 'never twice');

  await db.users.insertOne({ product: 'testmandi', phone: '919811112222', optedOut: true });
  const r3 = await tmLifecycle(now, { source: [user({ id: 'stop1', phone: '9811112222', createdAt: now - HOUR, lastActiveAt: now - HOUR })] });
  assert.equal(r3.sent, 0);
  assert.equal(sim.messages('testmandi', '919811112222').length, 0);
});

test('inside the 24-hour window: free message with buttons', async () => {
  sim.clear();
  await db.users.insertOne({ product: 'testmandi', phone: '919822223333', lastInboundAt: new Date(now - HOUR) });
  const u = user({ id: 'win1', phone: '9822223333', createdAt: now - 3 * HOUR, firstLoginAt: now - 2 * HOUR, phoneVerified: false });
  await db.kv.insertOne({ key: 'tm-life:win1:welcome', at: new Date(now - 2 * HOUR) });
  const r = await tmLifecycle(now, { source: [u] });
  assert.equal(r.sent, 1);
  const m = sim.messages('testmandi', '919822223333').at(-1);
  assert.equal(m.type, 'buttons');
  assert.equal(m.buttons[0].id, 'tm:phoneok');
});
