// YNeet 30-day trial journey: stage choice, once-per-stage, 24h window vs template, opt-out.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';

const { connect, db } = await import('../src/store.js');
const sim = await import('../src/providers/sim.js');
const yneet = await import('../src/yneetBridge.js');
const { yneetTrialJourney, stageFor, compose } = await import('../src/yneetJourney.js');

const DAY = 86400e3;
const now = Date.parse('2026-11-20T06:00:00Z');
const started = (days) => new Date(now - days * DAY - 3600e3);
const stats = { solved: 146, tests: 9, activeDays: 18, accuracy: 71, firstMock: 412, latestMock: 468, weakChapter: 'Rotational Motion' };

let students = [];
before(async () => {
  await connect();
  yneet.setImpl({
    lookup: async () => null, grant: async () => false,
    trialCandidates: async () => students,
    trialStats: async (id) => (id === 'idle' ? { ...stats, solved: 0, tests: 0 } : stats),
  });
});

test('stage windows', () => {
  const c = (d, endIn = 30 - d) => ({ startDate: started(d), endDate: new Date(now + endIn * DAY) });
  assert.equal(stageFor(c(1), now), null);
  assert.equal(stageFor(c(3), now), 'd3');
  assert.equal(stageFor(c(8), now), 'd7');
  assert.equal(stageFor(c(21), now), 'd20');
  assert.equal(stageFor(c(27), now), 'd27');
  assert.equal(stageFor({ startDate: started(31), endDate: new Date(now - DAY) }, now), 'ended');
  assert.equal(stageFor({ startDate: started(40), endDate: new Date(now - 10 * DAY) }, now), null);
});

test('message text uses real numbers', () => {
  const m = compose('d7', 'Priya Sharma', stats);
  assert.match(m.text, /Priya/);
  assert.match(m.text, /146 questions with 71% accuracy/);
  assert.deepEqual(m.params, ['Priya', '146', '71%', 'Rotational Motion']);
  assert.match(compose('d20', 'P', stats).params[1], /412 → 468\/720/);
});

test('sends once per stage: free message in window, template outside, skips idle d3 users who are active', async () => {
  sim.clear();
  process.env.TEMPLATE_YNEET_TRIAL_D27 = 'yneet_trial_d27';
  students = [
    { userId: 'a', name: 'Asha', phone: '+91 98765 43210', classLevel: '12th', startDate: started(27), endDate: new Date(now + 3 * DAY) },
    { userId: 'b', name: 'Bala', phone: '9876500001', classLevel: '11th', startDate: started(8), endDate: new Date(now + 22 * DAY) },
    { userId: 'c', name: 'Chitra', phone: '9876500002', classLevel: '12th', startDate: started(4), endDate: new Date(now + 26 * DAY) },
    { userId: 'j', name: 'Junior', phone: '9876500003', classLevel: '7th', startDate: started(8), endDate: new Date(now + 22 * DAY) },
  ];
  await db.users.insertOne({ product: 'yneet', phone: '919876500001', lastInboundAt: new Date() });

  const r1 = await yneetTrialJourney(now);
  // a: template (outside window); b: free message (inside window); c: d3 but active → skipped; j: junior
  assert.equal(r1.sent, 2);
  const a = sim.messages('yneet', '919876543210');
  assert.equal(a.length, 1); assert.equal(a[0].type, 'template'); assert.equal(a[0].name, 'yneet_trial_d27');
  assert.deepEqual(a[0].params, ['Asha', '18', '9']);
  const b = sim.messages('yneet', '919876500001');
  assert.equal(b.length, 1); assert.equal(b[0].type, 'link'); assert.match(b[0].text, /Week 1 done, Bala/);
  assert.equal(sim.messages('yneet', '919876500002').length, 0);
  assert.equal(sim.messages('yneet', '919876500003').length, 0);

  const r2 = await yneetTrialJourney(now + 3600e3);
  assert.equal(r2.sent, 0, 'never twice for the same stage');
});

test('no template and outside the window: nothing sent, retried next day', async () => {
  sim.clear();
  delete process.env.TEMPLATE_YNEET_TRIAL_D20;
  students = [{ userId: 'd', name: 'Dev', phone: '9876500009', classLevel: '12th', startDate: started(20), endDate: new Date(now + 10 * DAY) }];
  const r = await yneetTrialJourney(now);
  assert.equal(r.sent, 0); assert.equal(r.skipped, 1);
  process.env.TEMPLATE_YNEET_TRIAL_D20 = 'yneet_trial_d20';
  const r2 = await yneetTrialJourney(now + DAY / 2);
  assert.equal(r2.sent, 1);
});

test('opted-out students get nothing', async () => {
  sim.clear();
  students = [{ userId: 'e', name: 'Esha', phone: '9876500010', classLevel: '12th', startDate: started(27), endDate: new Date(now + 3 * DAY) }];
  await db.users.insertOne({ product: 'yneet', phone: '919876500010', optedOut: true, lastInboundAt: new Date() });
  assert.equal((await yneetTrialJourney(now)).sent, 0);
  assert.equal(sim.messages('yneet', '919876500010').length, 0);
});
