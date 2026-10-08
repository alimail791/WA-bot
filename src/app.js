// HTTP routes. server.js starts this; tests import createApp() directly.
import express from 'express';
import { config } from './config.js';
import { db } from './store.js';
import { products, productKeys } from './products.js';
import { handleInbound, dispatchAttempt, getUser } from './engine.js';
import { parseWebhook } from './providers/meta.js';
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
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
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
    for (const ev of parseWebhook(req.body)) {
      if (ev.id && seen.has(ev.id)) continue;
      if (ev.id) seen.set(ev.id, Date.now());
      if (seen.size > 5000) for (const [k, t] of seen) if (Date.now() - t > 3600e3) seen.delete(k);
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

  app.get('/admin/stats', admin, async (_req, res) => {
    const out = {};
    const since = new Date(Date.now() - 7 * 86400e3);
    for (const p of productKeys) {
      const paid = await db.orders.find({ product: p, status: 'paid', paidAt: { $gte: since } });
      out[p] = {
        users: await db.users.count({ product: p }),
        newUsers7d: await db.users.count({ product: p, createdAt: { $gte: since } }),
        ordersCreated7d: await db.orders.count({ product: p, createdAt: { $gte: since } }),
        ordersPaid7d: paid.length,
        revenue7d: paid.reduce((s, o) => s + o.amount, 0),
        attempts7d: await db.attempts.count({ product: p, at: { $gte: since } }),
      };
      out[p].paymentConversion = out[p].ordersCreated7d ? Math.round((out[p].ordersPaid7d / out[p].ordersCreated7d) * 100) + '%' : '-';
    }
    res.json(out);
  });

  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });
  return app;
}

// One shared number for all products: remember the user's choice, otherwise ask.
async function productOnSharedNumber(ev) {
  const upper = ev.replyId ? '' : String(ev.text || '').toUpperCase();
  if (/^(TEST|BUY)\s/.test(upper)) return 'testmandi';
  if (/\b[TS]REF\s/.test(upper)) return 'testmandi';
  if (/^JOIN\s/.test(upper) || /\bCREF\s/.test(upper)) return 'classcoach';
  if (/\bREF\s/.test(upper)) return 'yneet';
  const pick = { 'pick:yneet': 'yneet', 'pick:testmandi': 'testmandi', 'pick:classcoach': 'classcoach' }[ev.replyId];
  if (pick) { await db.sessions.updateOne({ product: '_shared', phone: ev.from }, { $set: { pick } }, { upsert: true }); return pick; }
  const s = await db.sessions.findOne({ product: '_shared', phone: ev.from });
  if (s?.pick && upper !== 'SWITCH') return s.pick;
  const { send } = await import('./providers/index.js');
  await send(Object.keys(products)[0], ev.from, { type: 'buttons', text: `Hi! 👋 Welcome to ${config.wa.businessName}.\nWhat are you here for?\n\n(Send SWITCH anytime to change.)`, buttons: [{ id: 'pick:yneet', title: 'NEET preparation' }, { id: 'pick:testmandi', title: 'Buy mock tests' }, { id: 'pick:classcoach', title: 'I\'m a teacher' }] });
  return null;
}

export { verify };
