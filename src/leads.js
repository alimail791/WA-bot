// Lead engine: import contact lists, send a safe daily WhatsApp campaign, run product demos,
// follow up automatically, hand hot leads to a person, and onboard new customers.
//
// Lead stages (only move forward): new → contacted → replied → demo → trial → customer
// Side exits: lost (said stop / not interested), invalid (not on WhatsApp), cold (no reply after 3 messages),
// existing (already uses one of our products, never sent a campaign).
import { db } from './store.js';
import { config } from './config.js';
import { send } from './providers/index.js';
import { products } from './products.js';
import { DAY, HOUR, istDate, waLink, maskPhone } from './util.js';

const env = process.env;
const OWNER = env.OWNER_NAME || 'Akbar';
export const STAGES = ['new', 'contacted', 'replied', 'demo', 'trial', 'customer'];
const EXITS = ['lost', 'invalid', 'cold', 'existing'];
const rank = (s) => STAGES.indexOf(s);

// ---- Segments -------------------------------------------------------------
// Each segment gets the product that fits it best and its own first message (a Meta-approved template).
export const SEGMENTS = {
  neet: {
    label: 'NEET centres', product: 'yneet', template: env.LEAD_TPL_NEET || 'ra_lead_neet',
    match: /neet|medical|jee|iit/i,
    buttons: ['lead:demo', 'lead:sell', 'lead:stop'],
    pitch: 'YNeet NEET practice for your students and selling your tests on TestMandi',
  },
  tutor: {
    label: 'Tutors & home tuition', product: 'classcoach', template: env.LEAD_TPL_TUTOR || 'ra_lead_tutor',
    match: /tutor|tuition|teacher|home\s*class|private\s*class/i,
    buttons: ['lead:demo', 'lead:later', 'lead:stop'],
    pitch: 'ClassCoach WhatsApp quizzes for your students',
  },
  school: {
    label: 'Schools & colleges', product: 'classcoach', template: env.LEAD_TPL_SCHOOL || 'ra_lead_school',
    match: /school|college|matric|cbse|icse|hr\.?\s*sec|higher\s*sec|polytechnic|university|vidyalaya|kendriya/i,
    buttons: ['lead:demo', 'lead:later', 'lead:stop'],
    pitch: 'ClassCoach WhatsApp quizzes for your teachers and students',
  },
  institute: {
    label: 'Academies, institutes & coaching', product: 'testmandi', template: env.LEAD_TPL_INSTITUTE || 'ra_lead_institute',
    match: /academy|institute|coaching|centre|center|classes|tnpsc|ssc|bank|upsc|rrb|group\s*[1-4]|training/i,
    buttons: ['lead:sell', 'lead:demo:classcoach', 'lead:stop'],
    pitch: 'selling your mock tests on TestMandi and testing students with ClassCoach',
  },
  student: {
    label: 'Students & parents', product: 'yneet', template: env.LEAD_TPL_STUDENT || 'ra_lead_student',
    match: /individual|student|parent|personal|aspirant/i,
    buttons: ['lead:demo', 'lead:later', 'lead:stop'],
    pitch: 'free daily NEET practice on WhatsApp with YNeet',
  },
};
const FOLLOWUP_TPL = env.LEAD_TPL_FOLLOWUP || 'ra_lead_followup';
const FINAL_TPL = env.LEAD_TPL_FINAL || 'ra_lead_final';
const TPL_LANG = env.LEAD_TPL_LANG || 'en';

export function detectSegment(...texts) {
  const s = texts.filter(Boolean).join(' ');
  for (const key of ['neet', 'tutor', 'school', 'institute', 'student']) if (SEGMENTS[key].match.test(s)) return key;
  return null;
}

// ---- Phones and CSV import --------------------------------------------------
export function cleanPhone(raw) {
  const first = String(raw || '').split(/[\/,;|]| or /i)[0];
  let d = first.replace(/\D/g, '');
  d = d.replace(/^0+/, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return '91' + d;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d[2])) return d;
  return null; // landlines, short or foreign numbers
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

const COLS = {
  phone: /mobile|phone|whats\s*app|cell|mob\b|contact\s*(no|num)|^(no|number)$/i,
  name: /^(contact\s*)?name$|person|owner|principal|tutor\s*name/i,
  org: /org|institute|school|academy|company|business|centre|center|college|firm/i,
  type: /type|category|segment|group|kind/i,
  city: /city|place|district|location|area|town/i,
};

export async function importLeads(text, { defaultType = '', source = 'import', tag = '' } = {}) {
  const rows = parseCsv(String(text || ''));
  if (!rows.length) return { added: 0, updated: 0, skipped: 0, invalid: 0, existing: 0, bySegment: {} };
  // Header row?
  let idx = { phone: 0, name: 1, org: 2, type: 3, city: 4 };
  const head = rows[0];
  if (!head.some((c) => cleanPhone(c))) {
    idx = {};
    for (const [k, re] of Object.entries(COLS)) {
      const i = head.findIndex((h, j) => re.test(h) && !Object.values(idx).includes(j));
      if (i >= 0) idx[k] = i;
    }
    if (idx.name === undefined) { const i = head.findIndex((h, j) => /name/i.test(h) && !Object.values(idx).includes(j)); if (i >= 0) idx.name = i; }
    rows.shift();
  }
  const out = { added: 0, updated: 0, skipped: 0, invalid: 0, existing: 0, bySegment: {} };
  const seen = new Map();
  for (const r of rows) {
    const get = (k) => (idx[k] === undefined ? '' : r[idx[k]] || '');
    let phone = cleanPhone(get('phone'));
    if (!phone) phone = r.map(cleanPhone).find(Boolean) || null; // phone in an unexpected column
    if (!phone) { out.invalid++; continue; }
    if (seen.has(phone)) { out.skipped++; continue; }
    const name = get('name').slice(0, 60), org = get('org').slice(0, 80), city = get('city').slice(0, 40), typeText = get('type');
    const segment = detectSegment(typeText) || detectSegment(defaultType) || detectSegment(org, name) || 'institute';
    seen.set(phone, { phone, name, org, city, typeText: typeText.slice(0, 40), segment });
  }
  // Look up existing leads and users in bulk (thousands of rows import in seconds)
  const phones = [...seen.keys()];
  const existingLeads = new Map(), customers = new Set();
  for (let i = 0; i < phones.length; i += 500) {
    const chunk = phones.slice(i, i + 500);
    for (const l of await db.leads.find({ phone: { $in: chunk } }, { projection: { phone: 1, name: 1, org: 1, city: 1, stage: 1, sent: 1, segment: 1 } })) existingLeads.set(l.phone, l);
    for (const u of await db.users.find({ phone: { $in: chunk } }, { projection: { phone: 1 } })) customers.add(u.phone);
  }
  const fresh = [];
  for (const c of seen.values()) {
    const old = existingLeads.get(c.phone);
    if (old && old.stage === 'new' && !old.sent) {
      // Not messaged yet: the newer sheet wins (fixes names and types from an earlier upload)
      const patch = { name: c.name, org: c.org, city: c.city || old.city || '', typeText: c.typeText, segment: c.segment, product: SEGMENTS[c.segment].product };
      const changed = ['name', 'org', 'city', 'segment'].some((k) => (old[k] || '') !== (patch[k] || ''));
      if (changed) { await db.leads.updateOne({ phone: c.phone }, { $set: patch }); out.updated++; } else out.skipped++;
      continue;
    }
    if (old) {
      const patch = {};
      if (!old.name && c.name) patch.name = c.name;
      if (!old.org && c.org) patch.org = c.org;
      if (!old.city && c.city) patch.city = c.city;
      if (Object.keys(patch).length) { await db.leads.updateOne({ phone: c.phone }, { $set: patch }); out.updated++; } else out.skipped++;
      continue;
    }
    const customer = customers.has(c.phone);
    if (customer) out.existing++;
    fresh.push({
      ...c, product: SEGMENTS[c.segment].product, stage: customer ? 'existing' : 'new',
      step: 0, sent: 0, source, tag, notes: [], owner: '', hot: false, createdAt: new Date(), stageAt: new Date(),
    });
    out.added++;
    out.bySegment[c.segment] = (out.bySegment[c.segment] || 0) + 1;
  }
  for (let i = 0; i < fresh.length; i += 500) await db.leads.insertMany(fresh.slice(i, i + 500));
  return out;
}

// ---- Settings ----------------------------------------------------------------
const DEFAULTS = { running: false, dailyCap: 150, startHour: 10, endHour: 19, sundays: false, followupDays: 3, finalDays: 4, pausedReason: '' };
export async function getCampaign() {
  const s = await db.kv.findOne({ key: 'leadCampaign' });
  return { ...DEFAULTS, ...(s?.value || {}) };
}
export async function setCampaign(patch) {
  const cur = await getCampaign();
  const next = { ...cur, ...patch };
  next.dailyCap = Math.max(0, Math.min(5000, Math.round(Number(next.dailyCap) || 0)));
  next.startHour = Math.max(0, Math.min(23, Number(next.startHour)));
  next.endHour = Math.max(next.startHour + 1, Math.min(24, Number(next.endHour)));
  if (patch.running === true) next.pausedReason = '';
  await db.kv.updateOne({ key: 'leadCampaign' }, { $set: { value: next, updatedAt: new Date() } }, { upsert: true });
  return next;
}

const istParts = (ms = Date.now()) => {
  const d = new Date(ms + 5.5 * HOUR);
  return { hour: d.getUTCHours(), min: d.getUTCMinutes(), dow: d.getUTCDay() };
};
const istMidnight = (ms = Date.now()) => { const d = new Date(ms + 5.5 * HOUR); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 5.5 * HOUR); };

async function log(type, phone, data = {}) {
  await db.events.insertOne({ product: 'leads', phone, type, data, at: new Date() });
}

// ---- Owner alerts --------------------------------------------------------------
export const ownerPhones = () => String(env.OWNER_PHONES || '').split(',').map(cleanPhone).filter(Boolean);
const lastInbound = async (phone) => {
  const us = await db.users.find({ phone });
  return us.reduce((m, u) => Math.max(m, u.lastInboundAt ? new Date(u.lastInboundAt).getTime() : 0), 0);
};

export async function alertOwner(text, { phone = '' } = {}) {
  await log('owner_alert', phone, { text: text.slice(0, 500) });
  for (const to of ownerPhones()) {
    const fresh = Date.now() - (await lastInbound(to)) < 23.5 * HOUR;
    if (fresh) await send('yneet', to, { type: 'text', text });
    else if (env.TEMPLATE_OWNER_ALERT) {
      await send('yneet', to, { type: 'template', name: env.TEMPLATE_OWNER_ALERT, lang: TPL_LANG, params: [text.replace(/\s*\n+\s*/g, ' · ').replace(/\s{4,}/g, ' ').slice(0, 900)], direct: true });
    }
  }
}

const who = (l) => [l.name, l.org].filter(Boolean).join(', ') || maskPhone(l.phone);
const chatLink = (phone) => `https://wa.me/${phone}`;

// ---- Human handover --------------------------------------------------------------
// While a person is talking to a contact (they tapped "Talk to us", or someone replied from the
// WhatsApp Business app), the bot stays quiet on typed messages so it doesn't talk over them.
export async function humanUntil(phone) {
  const s = await db.sessions.findOne({ product: '_human', phone });
  return s?.data?.until ? new Date(s.data.until).getTime() : 0;
}
export async function setHuman(phone, hours) {
  await db.sessions.updateOne({ product: '_human', phone }, { $set: { 'data.until': new Date(Date.now() + hours * HOUR), updatedAt: new Date() } }, { upsert: true });
}
// Called for each message someone sent from the WhatsApp Business app on the phone
export async function onAppEcho(to) {
  if (ownerPhones().includes(to)) return;
  await setHuman(to, Number(env.HUMAN_PAUSE_HOURS || 12));
  const lead = await db.leads.findOne({ phone: to });
  if (lead) await db.leads.updateOne({ phone: to }, { $set: { lastHumanAt: new Date() } });
}

async function handover(phone, why) {
  const lead = await db.leads.findOne({ phone });
  await setHuman(phone, 24);
  if (lead) await db.leads.updateOne({ phone }, { $set: { hot: true, hotAt: new Date(), hotWhy: why } });
  const hours = await getCampaign();
  const { hour } = istParts();
  const soon = hour >= hours.startHour && hour < hours.endHour ? 'within an hour' : `tomorrow after ${hours.startHour} AM`;
  await send('yneet', phone, { type: 'text', text: `Thank you! 🙏 ${OWNER} from ${config.wa.businessName} will message you here personally, usually ${soon}.\n\nYou can type your question now so he sees it first. (Send MENU anytime to use the assistant again.)` });
  const l = lead || { phone };
  await alertOwner(`🔥 Hot lead: ${who(l)}${l.segment ? ` (${SEGMENTS[l.segment].label}${l.city ? ', ' + l.city : ''})` : ''}\nWhy: ${why}\nReply now: ${chatLink(phone)}`, { phone });
}

// ---- Stage tracking ------------------------------------------------------------------
async function advance(phone, stage, extra = {}) {
  const lead = await db.leads.findOne({ phone });
  if (!lead) return null;
  const $set = { ...extra };
  const reopen = (lead.stage === 'cold' && rank(stage) > 0) || (lead.stage === 'lost' && rank(stage) >= rank('demo'));
  if ((!EXITS.includes(lead.stage) && rank(stage) > rank(lead.stage)) || reopen) {
    $set.stage = stage; $set.stageAt = new Date();
  }
  if (!Object.keys($set).length) return lead;
  return db.leads.updateOne({ phone }, { $set });
}

// Every inbound message (any product) from a lead
export async function onInbound(phone, product) {
  const lead = await db.leads.findOne({ phone });
  if (!lead) return;
  const patch = { lastInboundAt: new Date() };
  if (!lead.repliedAt) patch.repliedAt = new Date();
  await advance(phone, 'replied', patch);
  if (lead.stage === 'demo' || lead.stage === 'replied') {
    // Started using the product for real → trial
    const used = product === 'classcoach'
      ? ((await db.classes.findOne({ tutorPhone: phone }))?.quizzes?.length || 0) > 0
      : (await db.attempts.count({ phone })) > 0;
    if (used) await advance(phone, 'trial', { trialAt: new Date() });
  }
}

export async function onPaid(order) {
  const lead = await db.leads.findOne({ phone: order.phone });
  if (!lead || order.amount <= 0) return;
  await advance(order.phone, 'customer', { paidAt: new Date(), revenue: (lead.revenue || 0) + order.amount, paidProduct: order.product, onboard: { step: 0, at: new Date(), product: order.product } });
  await alertOwner(`💰 Lead converted: ${who(lead)} paid ₹${order.amount} for ${order.title}`, { phone: order.phone });
}

// ---- Inbound interception (called by the webhook before normal routing) -----------------
const HELP_WORDS = /^(HELP|HUMAN|AGENT|AKBAR|CALL ME|CALL|TALK|SUPPORT|CONTACT)$/;
const BOT_WORDS = /^(MENU|START|BOT|SWITCH)$/;

/** Returns true when the message was fully handled here. */
export async function intercept(ev, { setPick } = {}) {
  const phone = ev.from;
  const typed = ev.replyId ? '' : String(ev.text || '').trim();
  const upper = typed.toUpperCase();
  if (ownerPhones().includes(phone)) {
    if (/^(REPORT|LEADS)$/.test(upper)) { await dailySummary(); return true; }
    return false;
  }

  if (ev.replyId?.startsWith('lead:')) {
    await handleLeadReply(phone, ev.replyId, { setPick, name: ev.name });
    return true;
  }
  if (/^DELETE (MY )?DATA$/.test(upper)) {
    await log('delete_request', phone);
    await send('yneet', phone, { type: 'text', text: 'Got it ✅ Your request to delete your data is recorded. We will delete your records within 7 days and confirm here.' });
    await alertOwner(`🗑️ Data deletion request from +${phone}. Delete within 7 days and confirm to them.`, { phone });
    return true;
  }
  if (HELP_WORDS.test(upper)) { await handover(phone, `typed "${typed}"`); return true; }
  if (upper === 'STOP' || upper === 'UNSUBSCRIBE') {
    if (await db.leads.findOne({ phone })) { await handleLeadReply(phone, 'lead:stop', { setPick, name: ev.name }); return true; }
    return false;
  }
  if (upper === 'DEMO' && (await db.leads.findOne({ phone }))) { await handleLeadReply(phone, 'lead:demo', { setPick, name: ev.name }); return true; }

  const until = await humanUntil(phone);
  if (until > Date.now() && typed && !BOT_WORDS.test(upper)) {
    const lead = await db.leads.findOne({ phone });
    if (lead) await onInbound(phone, lead.product);
    await log('human_chat_in', phone, { text: typed.slice(0, 200) });
    return true; // a person is handling this chat
  }
  if (until > Date.now() && BOT_WORDS.test(upper)) await setHuman(phone, 0);

  const lead = await db.leads.findOne({ phone });
  if (lead && typed && lead.stage === 'contacted') {
    // First typed reply to a campaign: show the right options and tell the owner
    await onInbound(phone, lead.product);
    await leadMenu(lead, `Thanks for replying${lead.name ? ', ' + lead.name.split(' ')[0] : ''}! 🙏 I'm the ${config.wa.businessName} assistant. ${OWNER} has your message and may also reply personally.\n\nWhat would you like to see?`);
    await alertOwner(`💬 Lead replied: ${who(lead)} (${SEGMENTS[lead.segment].label})\n"${typed.slice(0, 200)}"\nChat: ${chatLink(phone)}`, { phone });
    return true;
  }
  return false;
}

async function leadMenu(lead, text) {
  const btns = {
    neet: [['lead:demo', '🎓 Student demo'], ['lead:sell', '💰 Sell NEET tests'], ['lead:human', '📞 Talk to us']],
    tutor: [['lead:demo', '▶️ Show me demo'], ['lead:prices', '💎 See prices'], ['lead:human', '📞 Talk to us']],
    school: [['lead:demo', '▶️ Show me demo'], ['lead:prices', '💎 See prices'], ['lead:human', '📞 Talk to us']],
    institute: [['lead:sell', '💰 Sell my tests'], ['lead:demo:classcoach', '📝 Test my students'], ['lead:human', '📞 Talk to us']],
    student: [['lead:demo', '🧠 Try free quiz'], ['lead:prices', '💎 See plans'], ['lead:human', '📞 Talk to us']],
  }[lead.segment] || [['lead:demo', '▶️ Show me demo'], ['lead:human', '📞 Talk to us']];
  await send(lead.product, lead.phone, { type: 'buttons', text, buttons: btns.map(([id, title]) => ({ id, title })) });
}

async function handleLeadReply(phone, replyId, { setPick, name } = {}) {
  const [, action, arg] = replyId.split(':');
  let lead = await db.leads.findOne({ phone });
  if (!lead) {
    // Someone forwarded a campaign message, or a template tap from a number not in the list
    lead = await db.leads.insertOne({ phone, name: name || '', org: '', city: '', segment: 'tutor', product: 'classcoach', stage: 'replied', step: 0, sent: 0, source: 'forward', notes: [], owner: '', hot: false, createdAt: new Date(), stageAt: new Date() });
  }
  await log('lead_tap', phone, { action, arg });
  if (action !== 'stop' && action !== 'no') await onInbound(phone, lead.product);
  const { handleInbound } = await import('./engine.js');
  const enter = async (product, input) => {
    if (setPick) await setPick(phone, product);
    await handleInbound({ product, phone, name: name || lead.name || '', ...input });
  };

  switch (action) {
    case 'stop':
    case 'no':
      await db.leads.updateOne({ phone }, { $set: { stage: 'lost', stageAt: new Date(), lostWhy: action } });
      await log(action === 'stop' ? 'lead_stop' : 'lead_no', phone);
      for (const p of Object.keys(products)) await db.users.updateOne({ product: p, phone }, { $set: { optedOut: true } });
      return send(lead.product, phone, { type: 'text', text: action === 'stop' ? 'Done ✅ You won\'t get any more messages from us. If you ever need us, just send Hi.' : 'No problem, thank you for letting us know 🙏 We won\'t message you again about this. Send Hi anytime if you need us.' });
    case 'later':
      await db.leads.updateOne({ phone }, { $set: { snoozeUntil: new Date(Date.now() + 7 * DAY) } });
      return send(lead.product, phone, { type: 'text', text: 'Sure, no rush 🙂 I\'ll check back in a week. If you want to see it sooner, just send DEMO.' });
    case 'human':
      return handover(phone, 'tapped "Talk to us"');
    case 'fb':
      await feedback(phone, Number(arg) || 0);
      return send(lead.product, phone, { type: 'text', text: Number(arg) >= 4 ? 'Thank you! 🙏 If you know another teacher who would like this, send REFER for your invite link and earn free months.' : `Thanks for telling us. ${OWNER} will reach out to make it work better for you.` });
    case 'calc':
      return earnings(lead, Number(arg) || 100);
    case 'sell':
      await advance(phone, 'demo', { demoAt: new Date(), demoProduct: 'testmandi' });
      if (setPick) await setPick(phone, 'testmandi');
      return send('testmandi', phone, { type: 'buttons', text: `💰 Sell your mock tests on TestMandi\n• You set the price, you keep ${Math.round(products.testmandi.sellerShare * 100)}% of every sale\n• Students buy on testmandi.in and right here on WhatsApp\n• Each test gets its own WhatsApp link to share with your students\n• ₹200 for every teacher or student you refer who buys\n\nHow many students do you reach (classroom + WhatsApp groups)?`, buttons: [{ id: 'lead:calc:50', title: 'About 50' }, { id: 'lead:calc:200', title: 'About 200' }, { id: 'lead:calc:1000', title: '1,000+' }] });
    case 'prices':
      if (lead.product === 'classcoach') return enter('classcoach', { replyId: 'cc:plans' });
      if (lead.product === 'yneet') return enter('yneet', { replyId: 'y:plans' });
      return earnings(lead, 200);
    case 'demo': {
      const product = arg || lead.product;
      await advance(phone, 'demo', { demoAt: new Date(), demoProduct: product });
      if (product === 'classcoach') {
        await send('classcoach', phone, { type: 'text', text: '▶️ ClassCoach in 3 steps:\n1️⃣ Pick a subject and topic, and I make a 10-question quiz\n2️⃣ Forward one link to your class WhatsApp group\n3️⃣ Every student\'s marks come back to you here, automatically\n\nNo app, no login for students. Your 30-day free trial starts now. Let\'s make your first quiz 👇' });
        return enter('classcoach', { replyId: 'cc:new' });
      }
      if (product === 'yneet') {
        await send('yneet', phone, { type: 'text', text: lead.segment === 'neet'
          ? '🎓 This is what your students get with YNeet: chapter practice from 3,600+ NEET questions, full mock tests with NEET marking, rank estimate and a daily quiz, all on WhatsApp.\nTry it as a student 👇'
          : '🧠 Free NEET practice on WhatsApp: a daily quiz, chapter practice and a free full mock test with rank estimate. Let\'s start 👇' });
        return enter('yneet', { text: 'Hi' });
      }
      return handleLeadReply(phone, 'lead:sell', { setPick, name });
    }
    default:
      return leadMenu(lead, 'What would you like to see?');
  }
}

async function earnings(lead, students) {
  const price = 49, buyers = Math.round(students * 0.3), share = products.testmandi.sellerShare;
  const one = Math.round(buyers * price * share);
  await send('testmandi', lead.phone, { type: 'text', text: `📈 What you could earn\nIf ${buyers} of your ${students.toLocaleString('en-IN')} students (30%) buy one ₹${price} test:\n${buyers} × ₹${price} × ${Math.round(share * 100)}% = *₹${one.toLocaleString('en-IN')}* for one test\nPublish 5 tests → *₹${(one * 5).toLocaleString('en-IN')}*, and you keep earning as new students join.\n\nIt's free to list. You upload questions once on testmandi.in and get paid to your bank.` });
  await send('testmandi', lead.phone, { type: 'link', text: 'Create your free seller account (2 minutes). Use this WhatsApp number as your phone so sale alerts reach you here.', url: products.testmandi.webBase, label: 'Start selling' });
  await send('testmandi', lead.phone, { type: 'buttons', text: 'Want help uploading your first test? We\'ll do it with you.', buttons: [{ id: 'lead:human', title: '📞 Help me start' }, { id: 'lead:demo:classcoach', title: '📝 Test my students' }] });
}

// ---- Campaign sending --------------------------------------------------------------------
const firstName = (l) => (l.name ? l.name.split(/\s+/)[0] : '') || l.org || 'Sir/Madam';
const PRODUCT_LINE = { classcoach: 'ClassCoach WhatsApp quizzes', testmandi: 'selling your tests on TestMandi', yneet: 'YNeet NEET practice' };

function messageFor(lead, step) {
  const seg = SEGMENTS[lead.segment] || SEGMENTS.institute;
  if (step === 0) return { name: seg.template, params: [firstName(lead)], buttons: seg.buttons };
  if (step === 1) return { name: FOLLOWUP_TPL, params: [firstName(lead), seg.pitch], buttons: ['lead:demo', 'lead:human', 'lead:stop'] };
  return { name: FINAL_TPL, params: [firstName(lead), PRODUCT_LINE[lead.product] || seg.pitch], buttons: ['lead:demo', 'lead:no'] };
}

export async function sendStep(lead, step, { test = false } = {}) {
  const m = messageFor(lead, step);
  const r = await send(lead.product, lead.phone, { type: 'template', name: m.name, lang: TPL_LANG, params: m.params, buttons: m.buttons, direct: true });
  if (test) return r;
  if (r && r.ok === false) {
    await log('lead_send_failed', lead.phone, { step, status: r.status, body: String(r.body || '').slice(0, 300) });
    const body = String(r.body || '');
    if (/132001|132000|132012|132015|132016|template/i.test(body)) {
      await setCampaign({ running: false, pausedReason: `WhatsApp rejected template "${m.name}": check it is approved with the exact name, language and buttons.` });
      await alertOwner(`⏸️ Lead campaign paused: template "${m.name}" was rejected by WhatsApp. Open the leads page for details.`);
      return r;
    }
    if (/131026|1013|recipient|not a valid/i.test(body)) await db.leads.updateOne({ phone: lead.phone }, { $set: { stage: 'invalid', stageAt: new Date() } });
    if (/131048|131056|130429|80007|368/.test(body)) await pauseForSafety(`WhatsApp is limiting messages (${body.match(/\b(131048|131056|130429|80007|368)\b/)?.[1]})`);
    return r;
  }
  const id = r?.messages?.[0]?.id || '';
  await db.leads.updateOne({ phone: lead.phone }, {
    $set: { step: step + 1, lastSentAt: new Date(), lastMsgId: id, ...(lead.stage === 'new' ? { stage: 'contacted', stageAt: new Date() } : {}) },
    $inc: { sent: 1 },
  });
  await log('lead_sent', lead.phone, { step, template: m.name, segment: lead.segment });
  return r;
}

async function pauseForSafety(reason) {
  const c = await getCampaign();
  if (!c.running) return;
  await setCampaign({ running: false, pausedReason: reason });
  await alertOwner(`⏸️ Lead campaign paused for safety: ${reason}. Your number's quality matters more than speed; check the leads page before turning it back on.`);
}

export async function sentToday() {
  return db.events.count({ product: 'leads', type: 'lead_sent', at: { $gte: istMidnight() } });
}

// Pick who to message next. Follow-ups first (they already know us), then new contacts.
async function dueLeads(limit, c, now) {
  const out = [];
  const take = async (filter, step, sort = { lastSentAt: 1 }) => {
    if (out.length >= limit) return;
    const rows = await db.leads.find(filter, { sort, limit: (limit - out.length) * 2 });
    for (const l of rows) {
      if (out.length >= limit) break;
      if (l.snoozeUntil && new Date(l.snoozeUntil).getTime() > now) continue;
      if (out.some((x) => x.lead.phone === l.phone)) continue;
      out.push({ lead: l, step });
    }
  };
  const before = (days) => new Date(now - days * DAY);
  // Replied or saw a demo but went quiet: one gentle follow-up template after 3 days
  await take({ stage: { $in: ['replied', 'demo'] }, warmFollowed: { $ne: true }, lostWhy: { $exists: false }, lastInboundAt: { $lte: before(c.followupDays) }, hot: { $ne: true } }, 'warm', { lastInboundAt: 1 });
  await take({ stage: 'contacted', step: 2, lastSentAt: { $lte: before(c.finalDays) } }, 2);
  await take({ stage: 'contacted', step: 1, lastSentAt: { $lte: before(c.followupDays) } }, 1);
  await take({ stage: 'new' }, 0, { createdAt: 1 });
  return out;
}

let ticking = false;
export async function campaignTick(now = Date.now()) {
  if (ticking) return { skipped: 'busy' };
  ticking = true;
  try {
    // Contacts who never replied after the last message → cold (no more messages)
    for (const l of await db.leads.find({ stage: 'contacted', step: { $gte: 3 }, lastSentAt: { $lte: new Date(now - 5 * DAY) } }, { limit: 500 })) {
      await db.leads.updateOne({ phone: l.phone }, { $set: { stage: 'cold', stageAt: new Date() } });
    }
    const c = await getCampaign();
    if (!c.running) return { skipped: 'paused' };
    const { hour, min, dow } = istParts(now);
    if (hour < c.startHour || hour >= c.endHour) return { skipped: 'outside hours' };
    if (dow === 0 && !c.sundays) return { skipped: 'sunday' };
    await safetyCheck();
    if (!(await getCampaign()).running) return { skipped: 'paused' };
    const remaining = c.dailyCap - (await sentToday());
    if (remaining <= 0) return { skipped: 'daily cap reached' };
    // Spread the day's messages evenly across the sending window (ticks every 5 minutes)
    const ticksLeft = Math.max(1, Math.ceil(((c.endHour * 60) - (hour * 60 + min)) / 5));
    const batch = Math.min(remaining, Math.max(1, Math.ceil(remaining / ticksLeft)), 40);
    const due = await dueLeads(batch, c, now);
    let sent = 0;
    for (const { lead, step } of due) {
      if (!(await getCampaign()).running) break;
      if (step === 'warm') {
        await db.leads.updateOne({ phone: lead.phone }, { $set: { warmFollowed: true } });
        const r = await sendStep({ ...lead, stage: 'contacted' }, 1);
        if (r?.ok !== false) sent++;
        continue;
      }
      const r = await sendStep(lead, step);
      if (r?.ok !== false) sent++;
      if (config.provider !== 'sim') await new Promise((res) => setTimeout(res, 1200));
    }
    return { sent, batch };
  } finally { ticking = false; }
}

// Pause automatically when too many people say stop, or WhatsApp starts failing messages
export async function safetyCheck() {
  const since = new Date(Date.now() - 7 * DAY);
  const sent = await db.events.count({ product: 'leads', type: 'lead_sent', at: { $gte: since } });
  if (sent < 50) return;
  const stops = await db.events.count({ product: 'leads', type: 'lead_stop', at: { $gte: since } });
  const limitPct = Number(env.LEAD_MAX_STOP_PCT || 5);
  if ((stops / sent) * 100 > limitPct) await pauseForSafety(`${stops} of ${sent} people (${Math.round((stops / sent) * 100)}%) tapped Stop this week, above the ${limitPct}% limit. Try a better-targeted segment or a softer first message`);
}

// Delivery receipts from WhatsApp
export async function onStatus(st) {
  if (!st?.recipient) return;
  const lead = await db.leads.findOne({ phone: st.recipient });
  if (!lead) return;
  if (st.status === 'read' && !lead.readAt && lead.lastMsgId === st.id) await db.leads.updateOne({ phone: lead.phone }, { $set: { readAt: new Date() } });
  if (st.status === 'delivered' && lead.lastMsgId === st.id) await db.leads.updateOne({ phone: lead.phone }, { $set: { deliveredAt: new Date() } });
  if (st.status !== 'failed') return;
  const code = Number(st.errors?.[0]?.code || 0);
  await log('lead_failed', lead.phone, { code, title: st.errors?.[0]?.title || '' });
  if (code === 131026) await db.leads.updateOne({ phone: lead.phone }, { $set: { stage: 'invalid', stageAt: new Date() } });
  else if (code === 131049) {
    // Meta held back a marketing message to protect the user's inbox; try again later without counting it
    await db.leads.updateOne({ phone: lead.phone }, { $set: { snoozeUntil: new Date(Date.now() + 4 * DAY), step: Math.max(0, (lead.step || 1) - 1), ...(lead.step <= 1 ? { stage: 'new' } : {}) } });
  } else if ([131048, 131056, 130429, 368].includes(code)) await pauseForSafety(`WhatsApp error ${code}: ${st.errors?.[0]?.title || 'sending limited'}`);
}

export async function onQualityUpdate(v) {
  const event = String(v?.event || '').toUpperCase();
  await log('quality_update', '', { event, limit: v?.current_limit || v?.messaging_limit_tier || '' });
  if (/FLAGGED|DOWNGRADE/.test(event)) await pauseForSafety(`WhatsApp marked your number's quality as ${event}`);
  else if (/UPGRADE|UNFLAGGED/.test(event)) await alertOwner(`✅ WhatsApp update for your number: ${event}${v?.current_limit ? ` (limit ${v.current_limit})` : ''}`);
}

// ---- Onboarding new users from the campaign --------------------------------------------------
// Free messages inside the 24-hour window only (no cost); a template is used outside it if set.
export async function onboardingTick(now = Date.now()) {
  const { hour } = istParts(now);
  const c = await getCampaign();
  if (hour < c.startHour || hour >= c.endHour) return 0;
  let n = 0;
  const leads = await db.leads.find({ stage: { $in: ['demo', 'trial', 'customer'] }, onboardDone: { $ne: true } }, { limit: 300 });
  for (const l of leads) {
    const product = l.paidProduct || l.demoProduct || l.product;
    const user = await db.users.findOne({ product, phone: l.phone });
    if (!user || user.optedOut) continue;
    const startedAt = new Date(l.paidAt || l.trialAt || l.demoAt || l.stageAt).getTime();
    const days = (now - startedAt) / DAY;
    const done = l.onboardSteps || [];
    const fresh = user.lastInboundAt && now - new Date(user.lastInboundAt).getTime() < 23.5 * HOUR;
    const step = await nextOnboardStep(l, product, user, days, done);
    if (!step) continue;
    await db.leads.updateOne({ phone: l.phone }, { $set: { onboardSteps: [...done, step.id], ...(step.last ? { onboardDone: true } : {}) } });
    if (fresh) await send(product, l.phone, step.msg);
    else if (env.TEMPLATE_ONBOARD_CHECKIN) await send(product, l.phone, { type: 'template', name: env.TEMPLATE_ONBOARD_CHECKIN, lang: TPL_LANG, params: [firstName(l), products[product].name], direct: true });
    else continue;
    await log('onboard', l.phone, { step: step.id, product });
    n++;
  }
  return n;
}

async function nextOnboardStep(l, product, user, days, done) {
  const btn = (text, buttons) => ({ type: 'buttons', text, buttons: buttons.map(([id, title]) => ({ id, title })) });
  if (product === 'classcoach') {
    const cls = await db.classes.findOne({ tutorPhone: l.phone });
    const students = cls?.students?.length || 0, quizzes = cls?.quizzes?.length || 0;
    if (!done.includes('cc_d1') && days >= 1) {
      if (!quizzes) return { id: 'cc_d1', msg: btn('👋 Quick tip: your first quiz takes 30 seconds. Pick a subject, I make 10 questions, you forward one link to your class group.', [['cc:new', '✨ Make a quiz'], ['lead:human', '📞 Help me']]) };
      if (students < 3) return { id: 'cc_d1', msg: btn(`👍 Your quiz is ready. Students join from your class link: forward it to your class WhatsApp group so marks start coming in.\n${waLink(config.wa.displayNumbers.classcoach, `JOIN ${cls.code}`)}`, [['cc:class', '👥 My class'], ['lead:human', '📞 Help me']]) };
      return { id: 'cc_d1', msg: btn(`🎉 Great start: ${students} students in your class. Send one quiz a week and parents see the progress.`, [['cc:new', '✨ New quiz'], ['cc:results', '📊 Results']]) };
    }
    if (!done.includes('cc_d3') && days >= 3) return { id: 'cc_d3', msg: btn(`📊 Your class so far: ${students} students, ${quizzes} quiz${quizzes === 1 ? '' : 'zes'}.\nTeachers who send 2 quizzes a week see the most students joining. Shall we make the next one?`, [['cc:new', '✨ Make a quiz'], ['cc:results', '📊 Results']]) };
    if (!done.includes('cc_d7') && days >= 7) return { id: 'cc_d7', last: true, msg: btn('How is ClassCoach working for you so far?', [['lead:fb:5', '😀 Very useful'], ['lead:fb:3', '🙂 It\'s okay'], ['lead:human', '😕 Need help']]) };
    return null;
  }
  if (product === 'yneet') {
    if (!done.includes('y_d1') && days >= 1) return { id: 'y_d1', msg: btn('🧠 Your free NEET practice is ready: try today\'s chapter practice or the free full mock with a rank estimate.', [['y:quiz', '🧠 Daily quiz'], ['y:mock', '🧪 Free mock']]) };
    if (!done.includes('y_d4') && days >= 4) return { id: 'y_d4', last: true, msg: btn('How is YNeet practice going? Reply with any doubt, or let us help you plan your NEET preparation.', [['y:more', '⭐ More practice'], ['lead:human', '📞 Talk to us']]) };
    return null;
  }
  if (product === 'testmandi') {
    if (!done.includes('tm_d2') && days >= 2) return { id: 'tm_d2', last: true, msg: btn('📤 Did you list your first test on testmandi.in? If you send us your questions (PDF, Word or Excel), we\'ll help you upload them.', [['lead:human', '📞 Help me upload'], ['lead:calc:200', '📈 See earnings']]) };
    return null;
  }
  return null;
}

// Feedback from the 7-day check-in
export async function feedback(phone, score) {
  await db.leads.updateOne({ phone }, { $set: { feedback: score, feedbackAt: new Date() } });
  if (score <= 3) await alertOwner(`⚠️ Feedback ${score}/5 from ${who((await db.leads.findOne({ phone })) || { phone })}. Worth a call: ${chatLink(phone)}`, { phone });
}

// ---- Reports -------------------------------------------------------------------------------
export async function funnel() {
  const all = await db.leads.find({}, { projection: { stage: 1, segment: 1, hot: 1, revenue: 1 } });
  const bySeg = {};
  const total = { all: 0, hot: 0, revenue: 0 };
  for (const l of all) {
    const s = (bySeg[l.segment] ||= { all: 0 });
    s.all++; s[l.stage] = (s[l.stage] || 0) + 1;
    total.all++; total[l.stage] = (total[l.stage] || 0) + 1;
    if (l.hot && !['customer', 'lost'].includes(l.stage)) total.hot++;
    total.revenue += l.revenue || 0;
  }
  return { bySeg, total };
}

export async function dailySummary() {
  const since = new Date(Date.now() - DAY);
  const cnt = (type) => db.events.count({ product: 'leads', type, at: { $gte: since } });
  const [sent, taps, stops] = await Promise.all([cnt('lead_sent'), cnt('lead_tap'), cnt('lead_stop')]);
  const replied = await db.leads.count({ repliedAt: { $gte: since } });
  const paid = await db.leads.find({ paidAt: { $gte: since } });
  const hot = await db.leads.find({ hot: true, stage: { $nin: ['customer', 'lost'] } }, { sort: { hotAt: -1 }, limit: 5 });
  const c = await getCampaign();
  const lines = [
    `📊 Leads report · ${istDate()}`,
    `Last 24h: ${sent} sent · ${replied} replied · ${taps} button taps · ${stops} stops · ${paid.length} paid (₹${paid.reduce((s, l) => s + (l.revenue || 0), 0)})`,
    `Campaign: ${c.running ? `running, ${c.dailyCap}/day` : `paused${c.pausedReason ? ' (' + c.pausedReason + ')' : ''}`}`,
  ];
  if (hot.length) lines.push('', '🔥 Waiting for you:', ...hot.map((l) => `• ${who(l)}: ${chatLink(l.phone)}`));
  await alertOwner(lines.join('\n'));
  return lines.join('\n');
}
