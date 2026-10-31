// ClassCoach teacher journey: stage choice, once per stage, one message a day, templates, opt-out, VERIFY.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';

const { connect, db } = await import('../src/store.js');
const sim = await import('../src/providers/sim.js');
const cc = await import('../src/classcoachBridge.js');
const { classcoachJourney, stageFor, compose } = await import('../src/classcoachJourney.js');
const { handleInbound } = await import('../src/engine.js');

const DAY = 86400e3;
const now = Date.parse('2026-11-20T06:00:00Z');
const ago = (d) => new Date(now - d * DAY).toISOString();
const base = { kind: 'teacher', emailVerified: true, phoneVerified: false, students: 24, classes: 1, referralUrl: 'https://www.classcoach.in/signup?ref=ravi1234' };

let teachers = [];
const verified = [];
before(async () => {
  await connect();
  cc.setImpl({
    lookup: async (phone) => (phone === '919876543210' ? { name: 'Ravi Kumar', email: 'r@x.com', batches: [], students: 0, plan: 'trial', planActive: true, planExpiresAt: null, phoneVerified: false } : null),
    applyPlan: async () => null,
    journeyCandidates: async () => teachers,
    verifyPhone: async (phone) => { verified.push(phone); return { ok: true, emailVerified: true, name: 'Ravi Kumar' }; },
  });
});

test('stage windows and priority', () => {
  const st = (t) => (stageFor({ ...base, ...t }, now) || []).map((s) => s.stage);
  assert.deepEqual(st({ createdAt: ago(0.1), lastActiveAt: ago(0.1) }), ['welcome']);
  assert.deepEqual(st({ createdAt: ago(1), lastActiveAt: ago(0.5) }), ['welcome', 'verify']);
  assert.deepEqual(st({ createdAt: ago(1), lastActiveAt: ago(0.5), phoneVerified: true }), ['welcome']);
  assert.deepEqual(st({ createdAt: ago(10), lastActiveAt: ago(6) }), ['verify', 'miss']);
  assert.deepEqual(st({ createdAt: ago(20), lastActiveAt: ago(1), phoneVerified: true }), ['refer']);
  assert.deepEqual(st({ createdAt: ago(60), lastActiveAt: ago(40), phoneVerified: true }), []);
});

test('texts use real data and the right reward', () => {
  const t = { ...base, name: 'Ravi Kumar', createdAt: ago(20), lastActiveAt: ago(6) };
  assert.match(compose('miss', t).text, /your 24 students are waiting/);
  assert.match(compose('refer', t).text, /2 months free/);
  assert.match(compose('refer', { ...t, kind: 'institute_owner' }).text, /40% off/);
  assert.deepEqual(compose('welcome', t).params, ['Ravi']);
  assert.equal(compose('refer', t).params[2], base.referralUrl);
});

test('templates outside the 24h window, once per stage, one a day, opt-out respected', async () => {
  process.env.TEMPLATE_CC_WELCOME = 'cc_welcome';
  process.env.TEMPLATE_CC_VERIFY = 'cc_verify';
  process.env.TEMPLATE_CC_MISS_YOU = 'cc_miss_you';
  process.env.TEMPLATE_CC_REFER = 'cc_refer';
  sim.clear();
  teachers = [
    { ...base, id: 1, name: 'Asha Rao', phone: '+91 98765 00001', createdAt: ago(1), lastActiveAt: ago(0.5) },
    { ...base, id: 2, name: 'Bala', phone: '9876500002', createdAt: ago(12), lastActiveAt: ago(8), phoneVerified: true },
    { ...base, id: 3, name: 'Chitra', phone: '9876500003', createdAt: ago(12), lastActiveAt: ago(8), phoneVerified: true },
  ];
  await db.users.insertOne({ product: 'classcoach', phone: '919876500003', optedOut: true });
  const r1 = await classcoachJourney(now);
  assert.equal(r1.sent, 2);
  const a = sim.messages('classcoach', '919876500001');
  assert.equal(a.length, 1); assert.equal(a[0].type, 'template'); assert.equal(a[0].name, 'cc_welcome');
  const b = sim.messages('classcoach', '919876500002');
  assert.equal(b[0].name, 'cc_miss_you'); assert.deepEqual(b[0].params, ['Bala', '8', 'your 24 students']);
  assert.equal(sim.messages('classcoach', '919876500003').length, 0, 'opted out');
  const r2 = await classcoachJourney(now + 3600e3);
  assert.equal(r2.sent, 0, 'one message per teacher per day');
  const r3 = await classcoachJourney(now + DAY);
  assert.equal(r3.sent, 1, 'next day: Asha gets the verify message');
  const v = sim.messages('classcoach', '919876500001').at(-1);
  assert.equal(v.name, 'cc_verify'); assert.deepEqual(v.buttons, ['cc:verify']);
  const r4 = await classcoachJourney(now + 2 * DAY);
  assert.equal(r4.sent, 0, 'each stage only once');
});

test('no template set: nothing sent outside the window', async () => {
  delete process.env.TEMPLATE_CC_REFER;
  sim.clear();
  teachers = [{ ...base, id: 9, name: 'Dev', phone: '9876500009', createdAt: ago(20), lastActiveAt: ago(1), phoneVerified: true }];
  const r = await classcoachJourney(now);
  assert.equal(r.sent, 0); assert.equal(r.skipped, 1);
});

test('tapping Verify my number marks the phone verified', async () => {
  sim.clear();
  await handleInbound({ product: 'classcoach', phone: '919876543210', name: 'Ravi', text: 'Verify my number', replyId: 'cc:verify' });
  assert.ok(verified.includes('919876543210'));
  const last = sim.messages('classcoach', '919876543210').at(-1);
  assert.match(last.text, /number is verified/);
});

test('"Stop promotions" button opts the teacher out', async () => {
  await handleInbound({ product: 'classcoach', phone: '919876500077', text: 'Stop promotions', replyId: 'Stop promotions' });
  const u = await db.users.findOne({ product: 'classcoach', phone: '919876500077' });
  assert.equal(u.optedOut, true);
});
