// Lead engine: import, campaign, demos, handover, safety, follow-ups, onboarding and the console routes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';
process.env.PORT = '0';
process.env.OWNER_PHONES = '9800000001';

const { connect, db } = await import('../src/store.js');
const { seed } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const sim = await import('../src/providers/sim.js');
const { config } = await import('../src/config.js');
const leads = await import('../src/leads.js');

let server, base;
before(async () => {
  await connect();
  await seed();
  await (await import('../src/bank.js')).ensureNeetBank();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  config.baseUrl = base;
  config.wa.sharedNumberId = 'SHARED1';
});
after(() => server.close());

const HOUR = 3600e3, DAY = 86400e3;
const istMidnight = () => { const d = new Date(Date.now() + 5.5 * HOUR); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 5.5 * HOUR; };
const at11 = () => istMidnight() + 11 * HOUR;
const all = (phone) => ['yneet', 'testmandi', 'classcoach'].flatMap((p) => sim.messages(p, phone));
const cursor = {};
const fresh = (phone) => { const a = all(phone).sort((x, y) => x.at - y.at || x.seq - y.seq); const out = a.slice(cursor[phone] || 0); cursor[phone] = a.length; return out; };
const textOf = (msgs) => msgs.map((m) => m.text || '').join('\n---\n');
const ids = (msgs) => msgs.flatMap((m) => [...(m.buttons || []).map((b) => b.id), ...(m.sections || []).flatMap((s) => s.rows.map((r) => r.id))]);
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const hook = (value) => fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry: [{ changes: [{ field: value.field || 'messages', value: { metadata: { phone_number_id: 'SHARED1' }, ...value } }] }] }) });
const tap = (from, id, title = 'x') => hook({ contacts: [{ wa_id: from, profile: { name: 'Lead' } }], messages: [{ id: 'm' + Math.random(), from, type: 'button', button: { text: title, payload: id } }] });
const type = (from, body) => hook({ contacts: [{ wa_id: from, profile: { name: 'Lead' } }], messages: [{ id: 'm' + Math.random(), from, type: 'text', text: { body } }] });

test('Import: finds columns, cleans numbers, detects type, skips duplicates, landlines and existing users', async () => {
  await db.users.insertOne({ product: 'yneet', phone: '919000011111', createdAt: new Date() });
  const csv = [
    'S.No,Institute Name,Contact Person,Mobile No,Category,District',
    '1,Sri Vidya Academy,Ravi Kumar,094430 12345,Coaching centre,Madurai',
    '2,Bright Tutors,Meena,+91 98765-43210 / 9876500000,Home tuition,Trichy',
    '3,Govt Hr Sec School,Principal,0452-2534567,School,Madurai',
    '4,Apex NEET Academy,Suresh,9000022222,NEET coaching,Salem',
    '5,Someone,,9000011111,Individual,Chennai',
    '6,Dup,,9443012345,Coaching,Madurai',
    '7,Lakshmi,,"8000033333",,Erode',
  ].join('\n');
  const r = await leads.importLeads(csv, { tag: 'tn-list' });
  assert.equal(r.added, 5);
  assert.equal(r.invalid, 1, 'landline skipped');
  assert.equal(r.skipped, 1, 'duplicate skipped');
  assert.equal(r.existing, 1);
  const ravi = await db.leads.findOne({ phone: '919443012345' });
  assert.equal(ravi.org, 'Sri Vidya Academy');
  assert.equal(ravi.name, 'Ravi Kumar');
  assert.equal(ravi.segment, 'institute');
  assert.equal(ravi.product, 'testmandi');
  assert.equal((await db.leads.findOne({ phone: '919876543210' })).segment, 'tutor');
  assert.equal((await db.leads.findOne({ phone: '919000022222' })).segment, 'neet');
  assert.equal((await db.leads.findOne({ phone: '919000011111' })).stage, 'existing');
  assert.equal((await db.leads.findOne({ phone: '918000033333' })).segment, 'institute', 'unknown type falls back to institute');
});

test('Campaign: paused by default, then sends the right template with button payloads within the daily cap', async () => {
  assert.equal((await leads.campaignTick(at11())).skipped, 'paused');
  await leads.setCampaign({ running: true, dailyCap: 2, sundays: true });
  assert.equal((await leads.campaignTick(istMidnight() + 21 * HOUR)).skipped, 'outside hours');
  const r = await leads.campaignTick(istMidnight() + 18.98 * HOUR); // near the end of the day: whole remaining cap goes out
  assert.equal(r.sent, 2);
  assert.equal((await leads.campaignTick(istMidnight() + 18.99 * HOUR)).skipped, 'daily cap reached');
  const ravi = await db.leads.findOne({ phone: '919443012345' });
  assert.equal(ravi.stage, 'contacted');
  assert.equal(ravi.step, 1);
  const msg = sim.messages('testmandi', '919443012345').at(-1);
  assert.equal(msg.type, 'template');
  assert.equal(msg.name, 'ra_lead_institute');
  assert.deepEqual(msg.params, ['Ravi']);
  assert.deepEqual(msg.buttons, ['lead:sell', 'lead:demo:classcoach', 'lead:stop']);
  assert.equal((await db.leads.findOne({ phone: '919000011111' })).sent || 0, 0, 'existing users never get campaigns');
  await leads.setCampaign({ dailyCap: 150 });
});

test('Institute taps "Sell my tests" → earnings calculator → signup link and help', async () => {
  const ph = '919443012345';
  fresh(ph);
  await tap(ph, 'lead:sell'); await wait();
  let m = fresh(ph);
  assert.match(textOf(m), /keep 80% of every sale/);
  await tap(ph, 'lead:calc:200'); await wait();
  m = fresh(ph);
  assert.match(textOf(m), /60 × ₹49 × 80% = \*₹2,352\*/);
  assert.ok(m.some((x) => x.type === 'link' && x.url === 'https://testmandi.in'));
  assert.equal((await db.leads.findOne({ phone: ph })).stage, 'demo');
});

test('Tutor taps "Show me demo" → ClassCoach quiz maker opens with the trial; product is remembered', async () => {
  const ph = '919876543210';
  await leads.sendStep(await db.leads.findOne({ phone: ph }), 0);
  fresh(ph);
  await tap(ph, 'lead:demo'); await wait(120);
  const m = fresh(ph);
  assert.match(textOf(m), /ClassCoach in 3 steps/);
  assert.ok(ids(m).some((id) => id.startsWith('cc:subj:')), 'subject list shown');
  assert.equal((await db.sessions.findOne({ product: '_shared', phone: ph })).pick, 'classcoach');
  assert.equal((await db.users.findOne({ product: 'classcoach', phone: ph })).role, 'tutor');
  assert.equal((await db.leads.findOne({ phone: ph })).stage, 'demo');
});

test('First typed reply to a campaign → tailored options + owner alert', async () => {
  const ph = '919000022222';
  await leads.sendStep(await db.leads.findOne({ phone: ph }), 0);
  fresh(ph);
  await type(ph, 'What is this about?'); await wait();
  const m = fresh(ph);
  assert.deepEqual(ids(m), ['lead:demo', 'lead:sell', 'lead:human']);
  assert.equal((await db.leads.findOne({ phone: ph })).stage, 'replied');
  const alert = (await db.events.find({ type: 'owner_alert' })).at(-1);
  assert.match(alert.data.text, /Lead replied: Suresh, Apex NEET Academy/);
});

test('"Talk to us" hands over to a person: bot stays quiet until MENU; owner gets the chat link', async () => {
  const ph = '919000022222';
  // Owner messaged the bot today, so alerts reach them as normal messages
  await db.users.updateOne({ product: 'yneet', phone: '919800000001' }, { $set: { lastInboundAt: new Date() } }, { upsert: true });
  await tap(ph, 'lead:human'); await wait();
  assert.match(textOf(fresh(ph)), /Akbar from Raise Academy will message you here personally/);
  assert.match(textOf(sim.messages('yneet', '919800000001')), /Hot lead: Suresh.*\n.*\nReply now: https:\/\/wa\.me\/919000022222/);
  assert.equal((await db.leads.findOne({ phone: ph })).hot, true);
  await type(ph, 'I have 300 students, what is the price?'); await wait();
  assert.equal(fresh(ph).length, 0, 'bot does not talk over the person');
  await type(ph, 'MENU'); await wait();
  assert.ok(fresh(ph).length > 0, 'MENU brings the bot back');
});

test('A reply typed in the WhatsApp Business app pauses the bot for that chat', async () => {
  const ph = '919555500001';
  await type(ph, 'Hi YNeet'); await wait();
  fresh(ph);
  await hook({ field: 'smb_message_echoes', message_echoes: [{ from: '919443424064', to: ph, id: 'e1', type: 'text', text: { body: 'Hello, Akbar here' } }] }); await wait();
  await type(ph, 'ok sir thank you'); await wait();
  assert.equal(fresh(ph).length, 0);
  assert.ok(await leads.humanUntil(ph) > Date.now());
});

test('Stop: lead is lost, opted out everywhere and gets no follow-ups', async () => {
  const ph = '918000033333';
  await leads.sendStep(await db.leads.findOne({ phone: ph }), 0);
  await tap(ph, 'lead:stop'); await wait();
  assert.match(textOf(fresh(ph)), /won't get any more messages/);
  const l = await db.leads.findOne({ phone: ph });
  assert.equal(l.stage, 'lost');
  await db.leads.updateOne({ phone: ph }, { $set: { lastSentAt: new Date(Date.now() - 10 * DAY) } });
  await leads.setCampaign({ running: true });
  await leads.campaignTick(at11());
  assert.equal((await db.leads.findOne({ phone: ph })).sent, 1);
});

test('Follow-ups: 2nd message after 3 days, last message 4 days later, then cold', async () => {
  await leads.importLeads('9111100001,Kumar,Kumar Tuition Centre,tuition,Karur');
  const ph = '919111100001';
  await leads.sendStep(await db.leads.findOne({ phone: ph }), 0);
  await db.leads.updateOne({ phone: ph }, { $set: { lastSentAt: new Date(Date.now() - 3.1 * DAY) } });
  await leads.campaignTick(at11());
  let m = sim.messages('classcoach', ph).at(-1);
  assert.equal(m.name, 'ra_lead_followup');
  assert.deepEqual(m.params, ['Kumar', 'ClassCoach WhatsApp quizzes for your students']);
  await db.leads.updateOne({ phone: ph }, { $set: { lastSentAt: new Date(Date.now() - 4.1 * DAY) } });
  await leads.campaignTick(at11());
  m = sim.messages('classcoach', ph).at(-1);
  assert.equal(m.name, 'ra_lead_final');
  assert.deepEqual(m.buttons, ['lead:demo', 'lead:no']);
  await db.leads.updateOne({ phone: ph }, { $set: { lastSentAt: new Date(Date.now() - 5.1 * DAY) } });
  await leads.campaignTick(at11());
  assert.equal((await db.leads.findOne({ phone: ph })).stage, 'cold');
});

test('Safety: delivery failures and too many stops pause the campaign', async () => {
  await leads.importLeads('9222200001,A,,coaching,X\n9222200002,B,,coaching,X');
  await leads.onStatus({ recipient: '919222200001', status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] });
  assert.equal((await db.leads.findOne({ phone: '919222200001' })).stage, 'invalid');
  await leads.setCampaign({ running: true });
  await leads.onStatus({ recipient: '919222200002', status: 'failed', errors: [{ code: 131048, title: 'Spam rate limit hit' }] });
  let c = await leads.getCampaign();
  assert.equal(c.running, false);
  assert.match(c.pausedReason, /131048/);
  await leads.setCampaign({ running: true });
  for (let i = 0; i < 60; i++) await db.events.insertOne({ product: 'leads', type: 'lead_sent', phone: 'x', at: new Date() });
  for (let i = 0; i < 6; i++) await db.events.insertOne({ product: 'leads', type: 'lead_stop', phone: 'x', at: new Date() });
  await leads.safetyCheck();
  c = await leads.getCampaign();
  assert.equal(c.running, false);
  assert.match(c.pausedReason, /tapped Stop/);
  await db.events.deleteMany({ phone: 'x' });
  await leads.onQualityUpdate({ event: 'FLAGGED' });
});

test('Paid lead becomes a customer; onboarding nudges a trial tutor with no quiz yet', async () => {
  const ph = '919876543210'; // tutor who saw the demo
  await db.leads.updateOne({ phone: ph }, { $set: { demoAt: new Date(Date.now() - 1.2 * DAY) } });
  await db.classes.deleteMany({ tutorPhone: ph });
  fresh(ph);
  await db.users.updateOne({ product: 'classcoach', phone: ph }, { $set: { lastInboundAt: new Date() } });
  const n = await leads.onboardingTick(at11());
  assert.ok(n >= 1);
  assert.match(textOf(fresh(ph)), /your first quiz takes 30 seconds/);
  await (await import('../src/engine.js')).dispatchPaid({ product: 'classcoach', phone: ph, amount: 499, title: 'Starter', item: 'starter', status: 'paid' }).catch(() => {});
  const l = await db.leads.findOne({ phone: ph });
  assert.equal(l.stage, 'customer');
  assert.equal(l.revenue, 499);
});

test('Leads console: needs the key; summary, list, import, notes and test send work', async () => {
  assert.equal((await fetch(`${base}/admin/leads`)).status, 401);
  const k = `key=${config.adminKey}`;
  const page = await fetch(`${base}/admin/leads?${k}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Import contacts/);
  const s = await (await fetch(`${base}/admin/leads/summary?${k}`)).json();
  assert.ok(s.total.all >= 5);
  assert.equal(s.segments.tutor.template, 'ra_lead_tutor');
  const post = (path, body) => fetch(`${base}${path}?${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const imp = await post('/admin/leads/import', { text: 'mobile,name\n9333300001,Devi', defaultType: 'school' });
  assert.equal(imp.added, 1);
  assert.equal((await db.leads.findOne({ phone: '919333300001' })).segment, 'school');
  await post('/admin/leads/update', { phone: '919333300001', note: 'Call Monday', by: 'Akbar', owner: 'Assistant' });
  const l = await db.leads.findOne({ phone: '919333300001' });
  assert.equal(l.notes[0].text, 'Call Monday');
  assert.equal(l.owner, 'Assistant');
  const hot = await (await fetch(`${base}/admin/leads/list?${k}&view=hot`)).json();
  assert.ok(hot.leads.some((x) => x.phone === '919000022222'));
  const search = await (await fetch(`${base}/admin/leads/list?${k}&view=all&q=devi`)).json();
  assert.equal(search.leads.length, 1);
  const t = await post('/admin/leads/test', { phone: '98000 00001', segment: 'school', step: 0 });
  assert.equal(t.ok, true);
  assert.equal(sim.messages('classcoach', '919800000001').at(-1).name, 'ra_lead_school');
  const camp = await post('/admin/leads/campaign', { running: false, dailyCap: 300 });
  assert.equal(camp.dailyCap, 300);
});

test('Big import: 5,000 rows go in one request, quickly', async () => {
  const rows = ['Mobile,Name,Institute,Type,City'];
  for (let i = 0; i < 5000; i++) rows.push(`9${String(700000000 + i)},Name ${i},Inst ${i},${i % 2 ? 'tuition' : 'school'},City`);
  const t0 = Date.now();
  const r = await leads.importLeads(rows.join('\n'));
  assert.equal(r.added, 5000);
  assert.ok(Date.now() - t0 < 15000);
  const again = await leads.importLeads(rows.slice(0, 101).join('\n'));
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 100);
});

test('WhatsApp check page explains a missing app subscription and can reconnect', async () => {
  const realFetch = globalThis.fetch;
  let posted = false;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    if (u.includes('/subscribed_apps') && opts.method === 'POST') { posted = true; return new Response('{"success":true}'); }
    if (u.includes('/subscribed_apps')) return new Response(JSON.stringify({ data: posted ? [{ whatsapp_business_api_data: { name: 'wa-bot' } }] : [] }));
    return new Response(JSON.stringify({ display_phone_number: '+91 94434 24064', verified_name: 'Raise Academy', status: 'CONNECTED', quality_rating: 'GREEN', is_on_biz_app: true }));
  };
  try {
    let html = await (await realFetch(`${base}/admin/whatsapp?key=${config.adminKey}`)).text();
    assert.match(html, /Bot app is NOT connected/);
    html = await (await realFetch(`${base}/admin/whatsapp?key=${config.adminKey}&fix=1`)).text();
    assert.ok(posted);
    assert.match(html, /Reconnected/);
    assert.match(html, /Bot app connected to your WhatsApp account \(wa-bot\)/);
  } finally { globalThis.fetch = realFetch; }
});
