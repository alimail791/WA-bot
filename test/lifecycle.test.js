// YNeet lifecycle messages: welcome, verify, parent, refer, miss-you.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';

const { connect, db } = await import('../src/store.js');
const sim = await import('../src/providers/sim.js');
const yneet = await import('../src/yneetBridge.js');
const { welcomeTick, lifecycleDaily, dueKind, compose } = await import('../src/yneetLifecycle.js');

const DAY = 86400e3, HOUR = 3600e3;
const now = Date.parse('2026-11-20T06:00:00Z'); // 11:30 AM IST
const ago = (ms) => new Date(now - ms);
let fresh = [], all = [];
before(async () => {
  await connect();
  yneet.setImpl({ lookup: async () => null, grant: async () => false, newStudents: async () => fresh, lifecycleStudents: async () => all });
});
beforeEach(async () => { sim.clear(); await db.kv.deleteMany({}); await db.events.deleteMany({}); await db.users.deleteMany({}); });

const base = { name: 'Asha K', classLevel: '12th', isVerified: true, parentEmail: 'p@x.in', referralCode: 'ABC123', plan: 'TRIAL_30D', tests: 0, practiced: 0 };

test('due kinds by age and activity', () => {
  assert.deepEqual(dueKind({ ...base, createdAt: ago(HOUR) }, now), []);
  assert.deepEqual(dueKind({ ...base, isVerified: false, createdAt: ago(DAY) }, now), ['verify']);
  assert.deepEqual(dueKind({ ...base, isVerified: false, classLevel: '7th', createdAt: ago(DAY) }, now), [], 'juniors are not asked to verify');
  assert.deepEqual(dueKind({ ...base, parentEmail: null, createdAt: ago(2 * DAY), lastActive: ago(HOUR) }, now), ['parent']);
  assert.deepEqual(dueKind({ ...base, createdAt: ago(12 * DAY), tests: 2, lastActive: ago(HOUR) }, now), ['refer']);
  assert.deepEqual(dueKind({ ...base, createdAt: ago(12 * DAY), tests: 2, lastActive: ago(6 * DAY) }, now), ['refer', 'missyou']);
  assert.deepEqual(dueKind({ ...base, createdAt: ago(60 * DAY), lastActive: ago(50 * DAY) }, now), [], 'gone too long: stop');
});

test('refer message carries the personal link', () => {
  const m = compose('refer', { ...base, createdAt: ago(12 * DAY) });
  assert.deepEqual(m.params, ['Asha', 'https://www.yneet.in/register?ref=ABC123']);
});

test('welcome: template once, skips night and the first 5 minutes', async () => {
  process.env.TEMPLATE_YNEET_WELCOME = 'yneet_welcome';
  fresh = [{ userId: 'w1', name: 'Ravi', phone: '9876500001', classLevel: '11th', createdAt: ago(30 * 60e3) },
           { userId: 'w2', name: 'Just Now', phone: '9876500002', classLevel: '11th', createdAt: ago(60e3) }];
  assert.equal((await welcomeTick(Date.parse('2026-11-19T18:00:00Z'))).quiet, true, '11:30 PM IST is quiet');
  assert.equal((await welcomeTick(now)).sent, 1);
  assert.equal((await welcomeTick(now + 600e3)).sent, 1, 'ten minutes later only the newer student is welcomed');
  assert.equal((await welcomeTick(now + 1200e3)).sent, 0, 'never twice');
  const m = sim.messages('yneet', '919876500001');
  assert.equal(m.length, 1); assert.equal(m[0].name, 'yneet_welcome'); assert.deepEqual(m[0].params, ['Ravi']);
});

test('daily: one message per student per day, in priority order, then the next one tomorrow', async () => {
  for (const k of ['VERIFY', 'PARENT', 'REFER', 'MISSYOU']) process.env[`TEMPLATE_YNEET_${k}`] = `yneet_${k.toLowerCase()}`;
  all = [{ ...base, userId: 'd1', phone: '9876500011', parentEmail: null, createdAt: ago(12 * DAY), tests: 3, lastActive: ago(7 * DAY) }];
  assert.equal((await lifecycleDaily(now)).sent, 1);
  assert.equal(sim.messages('yneet', '919876500011')[0].name, 'yneet_parent');
  assert.equal((await lifecycleDaily(now + HOUR)).sent, 0, 'same day: nothing more');
  await lifecycleDaily(now + DAY);
  await lifecycleDaily(now + 2 * DAY);
  assert.deepEqual(sim.messages('yneet', '919876500011').map((x) => x.name), ['yneet_parent', 'yneet_refer', 'yneet_missyou']);
});

test('free message inside the 24-hour window; nothing on a day the trial journey already wrote', async () => {
  all = [{ ...base, userId: 'd2', phone: '9876500012', parentEmail: null, createdAt: ago(3 * DAY), lastActive: ago(HOUR) },
         { ...base, userId: 'd3', phone: '9876500013', parentEmail: null, createdAt: ago(3 * DAY), lastActive: ago(HOUR) }];
  await db.users.insertOne({ product: 'yneet', phone: '919876500012', lastInboundAt: new Date() });
  await db.events.insertOne({ product: 'yneet', phone: '919876500013', type: 'trial_nudge', at: new Date(now - HOUR) });
  await lifecycleDaily(now);
  const m = sim.messages('yneet', '919876500012');
  assert.equal(m[0].type, 'link'); assert.match(m[0].text, /parent's WhatsApp number or email/);
  assert.equal(sim.messages('yneet', '919876500013').length, 0);
});
