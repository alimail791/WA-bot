// HTTP routes. server.js starts this; tests import createApp() directly.
import express from 'express';
import { config } from './config.js';
import { db } from './store.js';
import { products, productKeys } from './products.js';
import { handleInbound, dispatchAttempt, getUser } from './engine.js';
import { parseWebhook, parseExtras } from './providers/meta.js';
import * as leads from './leads.js';
import { leadsPage } from './leadsPage.js';
import * as sim from './providers/sim.js';
import { openMagicLink, consumeMagicLink } from './magic.js';
import { getQuestions, grade, csvToQuestions } from './questions.js';
import { markPaid, razorpayWebhook } from './payments.js';
import { testPage, resultPage, messagePage, devPayPage } from './pages.js';
import { hmac, safeEqual, maskPhone, waLink, sign, verify } from './util.js';
import { seed } from './seed.js';

function productForNumber(phoneNumberId) {
  const hit = Object.entries(config.wa.numbers).find(([, id]) => id && id === phoneNumberId);
  return hit ? hit[0] : null;
}

const backToChat = (product) => waLink(config.wa.displayNumbers[product], 'Hi');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Keep the raw body for signature checks
  app.use(express.json({ limit: '8mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, provider: config.provider, store: config.store }));

  // ---- WhatsApp webhook ----------------------------------------------
  app.get('/webhooks/whatsapp', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.wa.verifyToken) return res.send(req.query['hub.challenge']);
    res.sendStatus(403);
  });

  const seen = new Map(); // message id -> time, to ignore WhatsApp retries
  app.post('/webhooks/whatsapp', async (req, res) => {
    if (config.wa.appSecret) {
      const sig = String(req.get('x-hub-signature-256') || '').replace('sha256=', '');
      if (!safeEqual(sig, hmac(req.rawBody || '', config.wa.appSecret))) return res.sendStatus(401);
    }
    res.sendStatus(200); // answer fast; WhatsApp retries slow webhooks
    const extras = parseExtras(req.body);
    for (const st of extras.statuses) leads.onStatus(st).catch((e) => console.error('[leads] status', e.message));
    for (const e of extras.echoes) leads.onAppEcho(e.to).catch((err) => console.error('[leads] echo', err.message));
    for (const q of extras.quality) leads.onQualityUpdate(q).catch((e) => console.error('[leads] quality', e.message));
    for (const ev of parseWebhook(req.body)) {
      if (ev.id && seen.has(ev.id)) continue;
      if (ev.id) seen.set(ev.id, Date.now());
      if (seen.size > 5000) for (const [k, t] of seen) if (Date.now() - t > 3600e3) seen.delete(k);
      try {
        if (await leads.intercept(ev, { setPick })) continue;
      } catch (e) { console.error('[leads] intercept', e); }
      let product = productForNumber(ev.phoneNumberId);
      const shared = !product && ev.phoneNumberId === config.wa.sharedNumberId;
      if (shared) product = await productOnSharedNumber(ev);
      if (!product) {
        // On the shared number, no product yet means we just sent the "what are you here for?" menu
        if (!shared) console.warn('[wa] message for unknown number', ev.phoneNumberId);
        continue;
      }
      handleInbound({ product, phone: ev.from, name: ev.name, text: ev.text, replyId: ev.replyId }).catch((e) => console.error(e));
    }
  });

  // ---- Magic link test pages -----------------------------------------
  app.get('/t/:token', async (req, res) => {
    const { row, error } = await openMagicLink(req.params.token);
    if (error) return res.status(410).send(messagePage(row?.product, 'Link not available', error, backToChat(row?.product)));
    const questions = await getQuestions(row.qids);
    const remainingSec = row.durationMin * 60 - (Date.now() - new Date(row.openedAt).getTime()) / 1000;
    res.send(testPage(row, questions, { remainingSec, phoneMasked: maskPhone(row.phone) }));
  });

  // Grade a submitted test and send the WhatsApp follow-up. answersById: { [questionId]: optionIndex }
  async function submit(token, answersById) {
    const row = await db.tokens.findOne({ token });
    if (!row || !row.openedAt) return { status: 410, row };
    if (!(await consumeMagicLink(token))) return { status: 409, row };
    const questions = await getQuestions(row.qids);
    const answers = {};
    for (const q of questions) {
      const v = answersById[q._id];
      if (v !== undefined && v !== '' && v !== null) answers[q._id] = Number(v);
    }
    const g = grade(questions, answers);
    const user = await getUser(row.product, row.phone);
    const attempt = await db.attempts.insertOne({
      product: row.product, phone: row.phone, name: user?.name || '', kind: row.kind, ref: row.ref, title: row.title,
      answers, answered: Object.keys(answers).length, correct: g.correct, total: g.total, bySubject: g.bySubject, weak: g.weak, wrongIds: g.wrongIds, at: new Date(),
      timeSec: Math.max(0, Math.round((Date.now() - new Date(row.openedAt).getTime()) / 1000)),
    });
    try { await dispatchAttempt(attempt); } catch (e) { console.error('[attempt] follow-up failed', e); }
    return { status: 200, row, questions, attempt };
  }

  app.post('/t/:token', async (req, res) => {
    const byId = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => k.startsWith('q_')).map(([k, v]) => [k.slice(2), v]));
    const r = await submit(req.params.token, byId);
    if (r.status === 410) return res.status(410).send(messagePage(r.row?.product, 'Link not available', 'This link is not valid any more.', backToChat(r.row?.product)));
    if (r.status === 409) return res.status(409).send(messagePage(r.row.product, 'Already submitted', 'This test was already submitted. Your result is in WhatsApp.', backToChat(r.row.product)));
    res.send(resultPage(r.row, r.questions, r.attempt, backToChat(r.row.product)));
  });

  // For product web apps that run the test themselves: submit answers here so WhatsApp follow-ups still go out
  app.post('/api/results', async (req, res) => {
    if (req.get('x-api-key') !== config.adminKey) return res.sendStatus(401);
    const r = await submit(req.body.token, req.body.answers || {});
    if (r.status !== 200) return res.status(r.status).json({ error: r.status === 409 ? 'already submitted' : 'invalid token' });
    res.json({ correct: r.attempt.correct, total: r.attempt.total, weak: r.attempt.weak });
  });

  // For product web apps that want to run the test themselves: verify a magic token and get the phone.
  app.post('/api/magic/verify', async (req, res) => {
    if (req.get('x-api-key') !== config.adminKey) return res.sendStatus(401);
    const { row, error } = await openMagicLink(req.body.token);
    if (error) return res.status(410).json({ error });
    res.json({ product: row.product, phone: row.phone, kind: row.kind, ref: row.ref, qids: row.qids, session: sign({ product: row.product, phone: row.phone, token: row.token }) });
  });

  // ---- Payments -------------------------------------------------------
  app.post('/webhooks/razorpay', async (req, res) => {
    try {
      const r = await razorpayWebhook(req.rawBody || '', req.get('x-razorpay-signature'));
      res.sendStatus(r.status);
    } catch (e) { console.error('[razorpay]', e); res.sendStatus(500); }
  });

  app.get('/paid/:id', async (req, res) => {
    const order = await db.orders.findOne({ _id: req.params.id });
    res.send(messagePage(order?.product, 'Payment', order ? 'Thank you! Your payment is being confirmed. Go back to WhatsApp — your purchase will be there in a moment.' : 'Order not found.', backToChat(order?.product)));
  });

  if (!config.razorpay.keyId && config.provider === 'sim') {
    app.get('/dev/pay/:id', async (req, res) => {
      const order = await db.orders.findOne({ _id: req.params.id });
      if (!order) return res.status(404).send('Order not found');
      res.send(devPayPage(order));
    });
    app.post('/dev/pay/:id', async (req, res) => {
      await markPaid(req.params.id, 'dev_' + Date.now());
      const order = await db.orders.findOne({ _id: req.params.id });
      res.send(messagePage(order.product, 'Paid', 'Payment simulated. Check the chat.', backToChat(order.product)));
    });
  }

  // ---- Simulator (only with the sim provider) -------------------------
  if (config.provider === 'sim') {
    app.get('/', (_req, res) => res.redirect('/sim'));
    app.get('/sim', (_req, res) => res.sendFile(new URL('../public/sim.html', import.meta.url).pathname));
    app.post('/dev/send', async (req, res) => {
      const { product, phone, text, replyId, name } = req.body;
      if (!productKeys.includes(product)) return res.status(400).json({ error: 'unknown product' });
      await handleInbound({ product, phone: String(phone), text, replyId, name });
      res.json({ ok: true });
    });
    app.get('/dev/messages', (req, res) => res.json(sim.messages(req.query.product, String(req.query.phone), Number(req.query.since || 0))));
    app.post('/dev/reset', async (_req, res) => { sim.clear(); for (const c of Object.values(db)) await c.deleteMany({}); await seed(); res.json({ ok: true }); });
  }

  // ---- Admin ----------------------------------------------------------
  const admin = (req, res, next) => (req.get('x-api-key') === config.adminKey ? next() : res.sendStatus(401));

  app.post('/admin/questions/import', admin, express.text({ type: '*/*', limit: '20mb' }), async (req, res) => {
    const product = req.query.product;
    if (!productKeys.includes(product)) return res.status(400).json({ error: 'product must be one of ' + productKeys.join(', ') });
    const { questions, skipped, errors } = csvToQuestions(String(req.body || ''), product, { subject: req.query.subject, topic: req.query.topic });
    if (req.query.tag) questions.forEach((q) => q.tags.push(req.query.tag));
    if (req.query.dryRun !== '1') await db.questions.insertMany(questions);
    res.json({ imported: req.query.dryRun === '1' ? 0 : questions.length, valid: questions.length, skipped, errors });
  });

  // Create or update a TestMandi test or bundle
  app.post('/admin/tests', admin, async (req, res) => {
    const b = req.body;
    if (!b.code || !b.title || !b.price) return res.status(400).json({ error: 'code, title and price are required' });
    const code = String(b.code).toUpperCase();
    let qids = b.qids;
    if (!qids && b.type !== 'bundle') {
      const filter = { product: 'testmandi', ...(b.subject ? { subject: b.subject } : {}), ...(b.tag ? { tags: b.tag } : {}) };
      qids = (await db.questions.find(filter, { limit: b.count || 50 })).map((q) => q._id);
    }
    const doc = {
      code, title: b.title, type: b.type || 'test', price: Number(b.price), anchor: b.anchor ? Number(b.anchor) : undefined,
      sellerPhone: b.sellerPhone || '', sellerName: b.sellerName || 'TestMandi', sellerShare: b.sellerShare ?? products.testmandi.sellerShare,
      durationMin: Number(b.durationMin || 30), language: b.language || '', listed: b.listed !== false,
      ...(b.category ? { category: String(b.category).trim() } : {}),
      ...(b.type === 'bundle' ? { testCodes: (b.testCodes || []).map((c) => String(c).toUpperCase()) } : { qids }),
    };
    const saved = await db.tests.updateOne({ code }, { $set: doc, $setOnInsert: { attemptsCount: 0, salesCount: 0, ratingSum: 0, ratingCount: 0, revenue: 0, createdAt: new Date() } }, { upsert: true });
    res.json({ ok: true, test: { ...saved, qidsCount: saved.qids?.length }, shareLink: waLink(config.wa.displayNumbers.testmandi, `TEST ${code}`) });
  });

  async function stats(days) {
    const out = {};
    const since = new Date(Date.now() - days * 86400e3);
    for (const p of productKeys) {
      const paid = await db.orders.find({ product: p, status: 'paid', paidAt: { $gte: since } });
      const r = {
        users: await db.users.count({ product: p }),
        newUsers: await db.users.count({ product: p, createdAt: { $gte: since } }),
        activeUsers: await db.users.count({ product: p, lastInboundAt: { $gte: since } }),
        tests: await db.attempts.count({ product: p, at: { $gte: since } }),
        payLinks: await db.orders.count({ product: p, createdAt: { $gte: since }, amount: { $gt: 0 } }),
        paid: paid.filter((o) => o.amount > 0).length,
        revenue: paid.reduce((s, o) => s + (o.amount || 0), 0),
      };
      r.conversion = r.payLinks ? Math.round((r.paid / r.payLinks) * 100) : null;
      out[p] = r;
    }
    return out;
  }

  app.get('/admin/stats', admin, async (req, res) => res.json(await stats(Number(req.query.days) || 7)));

  // Owner dashboard in the browser: /admin/dashboard?key=ADMIN_KEY
  app.get('/admin/dashboard', async (req, res) => {
    if (!safeEqual(String(req.query.key || ''), config.adminKey)) return res.status(401).send('Add ?key=YOUR_ADMIN_KEY to the address. The key is the ADMIN_KEY variable in Railway.');
    const ranges = [[1, 'Today (24h)'], [7, 'Last 7 days'], [30, 'Last 30 days']];
    const data = await Promise.all(ranges.map(([d]) => stats(d)));
    const names = { yneet: 'YNeet', testmandi: 'TestMandi', classcoach: 'ClassCoach' };
    const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
    const rows = (st) => productKeys.map((p) => {
      const r = st[p];
      const hint = r.payLinks >= 5 && r.conversion !== null && r.conversion < 20 ? 'Many tap Pay but few finish: try a lower first price' : r.activeUsers >= 20 && r.payLinks === 0 ? 'People use it but nobody taps Pay: push the paid offer harder' : '';
      return `<tr><td>${names[p]}</td><td>${r.newUsers}</td><td>${r.activeUsers}</td><td>${r.tests}</td><td>${r.payLinks}</td><td>${r.paid}</td><td><b>${inr(r.revenue)}</b></td><td>${r.conversion === null ? '–' : r.conversion + '%'}</td><td class="hint">${hint}</td></tr>`;
    }).join('');
    const total = (st) => productKeys.reduce((s, p) => s + st[p].revenue, 0);
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Raise Academy bot · numbers</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px;background:#f5f6fa;color:#1b1d2e}main{max-width:980px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.muted{color:#5d6278;font-size:13px}
section{background:#fff;border:1px solid #dfe1ea;border-radius:12px;padding:14px;margin-top:14px;overflow-x:auto}h2{font-size:17px;margin:0 0 8px;display:flex;justify-content:space-between}table{border-collapse:collapse;width:100%;min-width:720px}
th,td{text-align:left;padding:8px;border-bottom:1px solid #eceef4;font-variant-numeric:tabular-nums}th{font-size:12px;color:#5d6278;text-transform:uppercase;letter-spacing:.04em}.hint{color:#a35a00;font-size:13px}</style></head>
<body><main><h1>Raise Academy WhatsApp bot</h1><div class="muted">Updated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST · Refresh the page for new numbers</div>
${ranges.map(([, label], i) => `<section><h2><span>${label}</span><span>${inr(total(data[i]))}</span></h2><table><thead><tr><th>Product</th><th>New users</th><th>Active users</th><th>Tests taken</th><th>Pay taps</th><th>Paid</th><th>Revenue</th><th>Pay → paid</th><th>What to do</th></tr></thead><tbody>${rows(data[i])}</tbody></table></section>`).join('')}
<p class="muted">Pay taps = payment links sent. Pay → paid = how many of those were completed.</p></main></body></html>`);
  });

  // ---- Leads console: /admin/leads?key=ADMIN_KEY ------------------------
  const keyed = (req, res, next) => (safeEqual(String(req.query.key || req.get('x-api-key') || ''), config.adminKey) ? next() : res.status(401).send('Add ?key=YOUR_ADMIN_KEY to the address. The key is the ADMIN_KEY variable in Railway.'));
  app.get('/admin/leads', keyed, (_req, res) => res.send(leadsPage()));
  app.get('/admin/leads/summary', keyed, async (_req, res) => {
    const since = new Date(Date.now() - 7 * 86400e3);
    const cnt = (type) => db.events.count({ product: 'leads', type, at: { $gte: since } });
    const [sent, taps, stops, failed] = await Promise.all([cnt('lead_sent'), cnt('lead_tap'), cnt('lead_stop'), cnt('lead_failed')]);
    const read = await db.leads.count({ readAt: { $gte: since } });
    const { bySeg, total } = await leads.funnel();
    res.json({
      campaign: await leads.getCampaign(), sentToday: await leads.sentToday(), bySeg, total,
      week: { sent, read, taps, stops, failed, stopPct: sent ? Math.round((stops / sent) * 1000) / 10 : 0 },
      maxStopPct: Number(process.env.LEAD_MAX_STOP_PCT || 5),
      segments: Object.fromEntries(Object.entries(leads.SEGMENTS).map(([k, v]) => [k, { label: v.label, product: v.product, template: v.template }])),
      team: String(process.env.LEAD_TEAM || 'Akbar,Assistant').split(',').map((s) => s.trim()).filter(Boolean),
      owner: leads.ownerPhones()[0] || '',
    });
  });
  app.get('/admin/leads/list', keyed, async (req, res) => {
    const view = String(req.query.view || 'hot');
    const filter = view === 'hot' ? { hot: true, stage: { $nin: ['customer', 'lost'] } } : view === 'all' ? {} : { stage: view };
    if (leads.SEGMENTS[req.query.segment]) filter.segment = req.query.segment;
    const size = 25, page = Math.max(0, Number(req.query.page) || 0);
    const sort = view === 'hot' ? { hotAt: -1 } : view === 'all' ? { createdAt: -1 } : { stageAt: -1 };
    const q = String(req.query.q || '').trim().toLowerCase();
    let rows;
    if (q) {
      const digits = q.replace(/\D/g, '');
      rows = (await db.leads.find(filter, { sort })).filter((l) => (digits.length >= 4 && l.phone.includes(digits)) || `${l.name} ${l.org} ${l.city}`.toLowerCase().includes(q));
      rows = rows.slice(page * size, page * size + size + 1);
    } else rows = await db.leads.find(filter, { sort, skip: page * size, limit: size + 1 });
    res.json({ leads: rows.slice(0, size), more: rows.length > size });
  });
  app.post('/admin/leads/import', keyed, async (req, res) => {
    const text = String(req.body?.text || '');
    if (text.length > 5e6) return res.status(413).json({ error: 'File too large. Split it into smaller sheets.' });
    res.json(await leads.importLeads(text, { defaultType: req.body?.defaultType || '', tag: String(req.body?.tag || '').slice(0, 40) }));
  });
  app.post('/admin/leads/campaign', keyed, async (req, res) => {
    const b = req.body || {};
    const patch = {};
    for (const k of ['running', 'sundays']) if (typeof b[k] === 'boolean') patch[k] = b[k];
    for (const k of ['dailyCap', 'startHour', 'endHour']) if (b[k] !== undefined) patch[k] = Number(b[k]);
    res.json(await leads.setCampaign(patch));
  });
  app.post('/admin/leads/update', keyed, async (req, res) => {
    const { phone, stage, owner, note, hot, by } = req.body || {};
    const lead = await db.leads.findOne({ phone: String(phone || '') });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const $set = {}, extra = {};
    if (stage && [...leads.STAGES, 'lost', 'cold'].includes(stage)) { $set.stage = stage; $set.stageAt = new Date(); if (stage === 'lost') $set.lostWhy = 'manual'; }
    if (typeof owner === 'string') $set.owner = owner.slice(0, 30);
    if (typeof hot === 'boolean') $set.hot = hot;
    if (note) extra.$push = { notes: { text: String(note).slice(0, 500), by: String(by || '').slice(0, 30), at: new Date() } };
    res.json({ ok: true, lead: await db.leads.updateOne({ phone: lead.phone }, { $set: { ...$set, updatedAt: new Date() }, ...extra }) });
  });
  app.post('/admin/leads/test', keyed, async (req, res) => {
    const { cleanPhone, SEGMENTS, sendStep } = leads;
    const phone = cleanPhone(req.body?.phone);
    const segment = SEGMENTS[req.body?.segment] ? req.body.segment : 'tutor';
    if (!phone) return res.status(400).json({ ok: false, error: 'Enter a 10-digit mobile number' });
    const r = await sendStep({ phone, name: 'Akbar', org: '', segment, product: SEGMENTS[segment].product, stage: 'new' }, Number(req.body?.step) || 0, { test: true });
    let error = '';
    if (r?.ok === false) { try { error = JSON.parse(r.body).error?.message || r.body; } catch { error = String(r.body || r.status); } }
    res.json({ ok: r?.ok !== false, error: String(error).slice(0, 300) });
  });

  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });
  return app;
}

async function setPick(phone, pick) {
  await db.sessions.updateOne({ product: '_shared', phone }, { $set: { pick } }, { upsert: true });
}

// One shared number for all products: remember the user's choice, otherwise ask.
async function productOnSharedNumber(ev) {
  const upper = ev.replyId ? '' : String(ev.text || '').toUpperCase();
  if (/^(TEST|BUY)\s/.test(upper)) return 'testmandi';
  if (/\b[TS]REF\s/.test(upper)) return 'testmandi';
  if (/^JOIN\s/.test(upper) || /\bCREF\s/.test(upper)) return 'classcoach';
  if (/\bREF\s/.test(upper)) return 'yneet';
  // Website buttons and ads send "Hi YNeet", "Hi TestMandi" or "Hi ClassCoach": go straight there and remember it
  const kw = /\bTEST\s?MANDI\b/.test(upper) ? 'testmandi'
    : /\b(CLASS\s?COACH|TEACHER|TUTOR)\b/.test(upper) ? 'classcoach'
    : /\b(Y\s?NEET|NEET)\b/.test(upper) ? 'yneet' : null;
  if (ev.replyId === 'pick:switch') await db.sessions.updateOne({ product: '_shared', phone: ev.from }, { $set: { pick: null } }, { upsert: true });
  const pick = kw || { 'pick:yneet': 'yneet', 'pick:testmandi': 'testmandi', 'pick:classcoach': 'classcoach' }[ev.replyId];
  if (pick) { await db.sessions.updateOne({ product: '_shared', phone: ev.from }, { $set: { pick } }, { upsert: true }); return pick; }
  const s = await db.sessions.findOne({ product: '_shared', phone: ev.from });
  if (s?.pick && upper !== 'SWITCH') return s.pick;
  const { send } = await import('./providers/index.js');
  await send(Object.keys(products)[0], ev.from, { type: 'buttons', text: `Hi! 👋 Welcome to ${config.wa.businessName}.\nWhat are you here for?\n\n(Send SWITCH anytime to change.)`, buttons: [{ id: 'pick:yneet', title: 'NEET preparation' }, { id: 'pick:testmandi', title: 'Buy mock tests' }, { id: 'pick:classcoach', title: 'I\'m a teacher' }] });
  return null;
}

export { verify };
