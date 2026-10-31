// VasulBook WhatsApp messages to shop owners: welcome, verify, refer & earn, we miss you, replies.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';

const { connect, db } = await import('../src/store.js');
const sim = await import('../src/providers/sim.js');
const vb = await import('../src/vasulbookBridge.js');
const L = await import('../src/vasulbookLifecycle.js');
const T = await import('../src/vasulbookTemplates.js');

const DAY = 86400e3, HOUR = 3600e3;
const now = Date.parse('2026-11-20T06:00:00Z'); // 11:30 AM IST
const ago = (ms) => new Date(now - ms).toISOString();
let fresh = [], all = [], verified = [], optOuts = [];
before(async () => {
  await connect();
  vb.setImpl({
    newOwners: async () => fresh, lifecycleOwners: async () => all,
    owner: async () => ({ lang: 'ta', shop: 'Lakshmi Stores' }),
    phoneVerified: async (p) => { verified.push(p); return [{ shop: 'Lakshmi Stores' }]; },
    optOut: async (p, out) => { optOuts.push([p, out]); return []; },
  });
});
beforeEach(async () => {
  sim.clear(); verified = []; optOuts = [];
  for (const c of ['kv', 'events', 'users']) await db[c].deleteMany({});
  L.setStatusMap({}); // no approved templates by default
});
const base = { id: 7, name: 'Ravi Kumar', shop: 'Lakshmi Stores', phone: '9876543210', lang: 'ta', emailVerified: true, phoneVerified: true, referralCode: 'VB12AB34', customers: 0, entries: 0, optedOut: false };
const approveAll = () => { const m = {}; for (const k of T.KINDS) for (const l of T.LANGS) m[`${T.NAME(k)}|${l}`] = { status: 'APPROVED' }; L.setStatusMap(m); };

test('due kinds', () => {
  assert.deepEqual(L.dueKind({ ...base, createdAt: ago(2 * HOUR) }, now), []);
  assert.deepEqual(L.dueKind({ ...base, phoneVerified: false, createdAt: ago(DAY), lastActive: ago(HOUR) }, now), ['verify']);
  assert.deepEqual(L.dueKind({ ...base, emailVerified: false, createdAt: ago(5 * DAY), lastActive: ago(5 * DAY) }, now), ['missyou'], 'verify only in the first 4 days');
  assert.deepEqual(L.dueKind({ ...base, createdAt: ago(9 * DAY), lastActive: ago(HOUR), customers: 4 }, now), ['refer']);
  assert.deepEqual(L.dueKind({ ...base, createdAt: ago(9 * DAY), lastActive: ago(HOUR) }, now), [], 'refer only for real users');
  assert.deepEqual(L.dueKind({ ...base, createdAt: ago(20 * DAY), lastActive: ago(6 * DAY) }, now), ['missyou']);
  assert.deepEqual(L.dueKind({ ...base, createdAt: ago(80 * DAY), lastActive: ago(50 * DAY) }, now), [], 'gone too long');
  assert.deepEqual(L.dueKind({ ...base, optedOut: true, createdAt: ago(20 * DAY), lastActive: ago(6 * DAY) }, now), []);
});

test('compose fills names, links and language', () => {
  const r = L.compose('refer', { ...base, createdAt: ago(9 * DAY) });
  assert.equal(r.lang, 'ta');
  assert.deepEqual(r.params, ['Ravi', '5', 'https://www.vasulbook.com/?ref=VB12AB34']);
  assert.match(r.text, /Ravi/); assert.match(r.text, /VB12AB34/);
  const d = T.definition('verify', 'hi');
  assert.equal(d.components[2].buttons[0].type, 'QUICK_REPLY');
});

test('welcome waits for an approved template, then sends once', async () => {
  fresh = [{ ...base, createdAt: ago(HOUR) }];
  assert.equal((await L.welcomeTick(now)).sent, 0, 'nothing approved yet');
  approveAll();
  assert.equal((await L.welcomeTick(now)).sent, 1);
  assert.equal((await L.welcomeTick(now + 10 * 60e3)).sent, 0, 'only once');
  const m = sim.messages('vasulbook', '919876543210').at(-1);
  assert.equal(m.name, 'vasulbook_welcome'); assert.equal(m.lang, 'ta'); assert.deepEqual(m.params, ['Ravi', 'Lakshmi Stores']);
});

test('quiet at night', async () => {
  approveAll();
  fresh = [{ ...base, createdAt: ago(HOUR) }];
  const night = Date.parse('2026-11-20T18:00:00Z'); // 11:30 PM IST
  assert.equal((await L.welcomeTick(night)).quiet, true);
});

test('daily: one message per owner, missyou not repeated within 21 days', async () => {
  approveAll();
  all = [{ ...base, phoneVerified: false, createdAt: ago(DAY), lastActive: ago(HOUR) }, { ...base, id: 8, phone: '9876500000', createdAt: ago(20 * DAY), lastActive: ago(6 * DAY) }];
  const r = await L.lifecycleDaily(now);
  assert.deepEqual(r.counts, { verify: 1, missyou: 1 });
  assert.equal((await L.lifecycleDaily(now + DAY)).sent, 0);
});

test('replies: number confirmed, STOP and START', async () => {
  approveAll();
  all = [{ ...base, phoneVerified: false, createdAt: ago(DAY), lastActive: ago(HOUR) }];
  await L.lifecycleDaily(now);
  assert.equal(await L.intercept({ from: '919876543210', text: 'ஆம், என் எண்', replyId: 'vb:phone-ok' }), true);
  assert.deepEqual(verified, ['919876543210']);
  assert.equal(await L.intercept({ from: '919876543210', text: 'STOP' }), true);
  assert.deepEqual(optOuts.at(-1), ['919876543210', true]);
  assert.equal(await L.intercept({ from: '919876543210', text: 'START' }), true);
  assert.deepEqual(optOuts.at(-1), ['919876543210', false]);
  assert.equal(await L.intercept({ from: '919999999999', text: 'Hi YNeet' }), false, 'other products untouched');
});
