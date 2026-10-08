// Keeps the bot's TestMandi catalogue in step with testmandi.in, and records WhatsApp sales in TestMandi's
// own database so sellers are paid through their normal TestMandi payouts.
//
// TestMandi data (database "testmandi" on the same cluster):
//   tests   { id, title, category, price, duration, sellerEmail, sellerName, rating, ratingCount, questions:[{text,options,correct,topic,explanation}] }
//   bundles { id, title, price, testIds, sellerEmail, sellerName }
//   users   { email, phone, role, referralCode, name, businessName }
//   meta    { _id:'settings', sellerSharePercent }
//   purchases / bundlePurchases { id, testId|bundleId, buyerEmail, price, paymentId, ts }
import { createHash, randomBytes } from 'node:crypto';
import { db, otherDb } from './store.js';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const enabled = () => process.env.TESTMANDI_SYNC === 'true';
const tmDbName = () => process.env.TESTMANDI_DB || 'testmandi';

// Short code people can type in WhatsApp ("TEST K7QM2X"), stable for each TestMandi test id
export function codeFor(id, len = 6) {
  const h = createHash('sha256').update(String(id)).digest();
  return [...h.subarray(0, len)].map((x) => ALPHA[x % ALPHA.length]).join('');
}

export function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return '91' + d;
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1);
  return d || '';
}

const isBlocked = (t) => t.ratingCount > 10 && t.rating < 3; // same rule as testmandi.in
const hashOf = (x) => createHash('sha1').update(JSON.stringify(x || [])).digest('hex');

/**
 * Sync from a source. In production the source is TestMandi's database; tests pass a plain object.
 * source: { tests: [], bundles: [], users: [], sellerSharePercent }
 */
export async function syncFrom(source) {
  const started = Date.now();
  const share = (source.sellerSharePercent ?? 70) / 100;
  const sellers = new Map(source.users.filter((u) => u.role === 'seller').map((u) => [u.email, u]));
  const seenIds = new Set();
  const codeById = new Map();
  let created = 0, updated = 0, questionsWritten = 0;

  let failed = 0;
  for (const t of source.tests) {
    if (!t?.id || !Array.isArray(t.questions) || !t.questions.length) continue;
    seenIds.add(t.id);
    try {
    const existing = await db.tests.findOne({ tmId: t.id });
    let code = existing?.code || codeFor(t.id);
    if (!existing) {
      const clash = await db.tests.findOne({ code });
      if (clash && clash.tmId !== t.id) code = codeFor(t.id, 8);
    }
    codeById.set(t.id, code);

    // Questions: rewrite only when they changed
    const qhash = hashOf(t.questions);
    let qids = existing?.qids;
    if (!existing || existing.qhash !== qhash) {
      await db.questions.deleteMany({ sourceTestId: t.id });
      const docs = t.questions
        .filter((q) => q && q.text && Array.isArray(q.options) && q.options.length >= 2)
        .map((q, i) => ({
          _id: `tmq_${t.id}_${i}`, product: 'testmandi', sourceTestId: t.id,
          subject: t.category || 'General', topic: q.topic || '', question: q.text,
          options: q.options.map(String), answer: Number(q.correct) || 0, explanation: q.explanation || '',
          tags: ['testmandi'], createdAt: new Date(),
        }));
      await db.questions.insertMany(docs);
      qids = docs.map((d) => d._id);
      questionsWritten += docs.length;
    }

    const seller = sellers.get(t.sellerEmail);
    const ratingCount = Number(t.ratingCount) || 0;
    const doc = {
      tmId: t.id, code, title: String(t.title || 'Untitled test').trim(), type: 'test',
      category: (t.category || 'Other').trim(), price: Math.max(0, Number(t.price) || 0),
      durationMin: Math.max(1, Number(t.duration) || 30), sellerEmail: t.sellerEmail || '',
      sellerName: t.sellerName || seller?.businessName || seller?.name || 'TestMandi',
      sellerPhone: normalizePhone(seller?.phone), sellerShare: share, language: t.language || '',
      ratingSum: Math.round((Number(t.rating) || 0) * ratingCount * 10) / 10, ratingCount,
      listed: !isBlocked(t), qids, qhash, source: 'testmandi', syncedAt: new Date(),
    };
    await db.tests.updateOne({ tmId: t.id }, { $set: doc, $setOnInsert: { attemptsCount: 0, salesCount: 0, revenue: 0, createdAt: new Date() } }, { upsert: true });
    existing ? updated++ : created++;
    } catch (e) {
      failed++;
      console.error(`[testmandi-sync] skipped test ${t.id}: ${e.message}`);
    }
  }

  // Tests removed from testmandi.in stop being sold here
  const stale = await db.tests.find({ source: 'testmandi', type: 'test' });
  for (const s of stale) if (!seenIds.has(s.tmId) && s.listed !== false) await db.tests.updateOne({ _id: s._id }, { $set: { listed: false } });

  // Bundles
  let bundles = 0;
  for (const b of source.bundles || []) {
    try {
    const testCodes = (b.testIds || []).map((id) => codeById.get(id)).filter(Boolean);
    if (!b?.id || testCodes.length < 2) continue;
    const seller = sellers.get(b.sellerEmail);
    await db.tests.updateOne({ tmId: b.id }, {
      $set: {
        tmId: b.id, code: codeFor(b.id), title: b.title, type: 'bundle', price: Number(b.price) || 0, testCodes,
        sellerEmail: b.sellerEmail || '', sellerName: b.sellerName || 'TestMandi', sellerPhone: normalizePhone(seller?.phone),
        sellerShare: share, source: 'testmandi', listed: true, syncedAt: new Date(),
      },
      $setOnInsert: { salesCount: 0, revenue: 0, createdAt: new Date() },
    }, { upsert: true });
    bundles++;
    } catch (e) { console.error(`[testmandi-sync] skipped bundle ${b?.id}: ${e.message}`); }
  }

  // Seller details the bot needs: phone → TestMandi email and referral code
  for (const u of sellers.values()) {
    const phone = normalizePhone(u.phone);
    if (!phone) continue;
    await db.users.updateOne(
      { product: 'testmandi', phone },
      { $set: { tmEmail: u.email, tmReferralCode: u.referralCode || '', tmName: u.businessName || u.name || '' }, $setOnInsert: { createdAt: new Date(), credits: {} } },
      { upsert: true },
    );
  }

  const result = { tests: seenIds.size, created, updated, failed, bundles, questionsWritten, ms: Date.now() - started };
  console.log(`[testmandi-sync] ${JSON.stringify(result)}`);
  return result;
}

export async function syncFromTestMandi() {
  const tm = otherDb(tmDbName());
  if (!tm) return null;
  const [tests, bundles, users, settings] = await Promise.all([
    tm.collection('tests').find({}).toArray(),
    tm.collection('bundles').find({}).toArray(),
    tm.collection('users').find({ role: 'seller' }, { projection: { email: 1, phone: 1, role: 1, referralCode: 1, name: 1, businessName: 1 } }).toArray(),
    tm.collection('meta').findOne({ _id: 'settings' }),
  ]);
  return syncFrom({ tests, bundles, users, sellerSharePercent: settings?.sellerSharePercent });
}

let running = false;
export function startSync(everyMinutes = 15) {
  const run = async () => {
    if (running) return;
    running = true;
    try { await syncFromTestMandi(); } catch (e) { console.error('[testmandi-sync] failed', e); } finally { running = false; }
  };
  run();
  setInterval(run, everyMinutes * 60e3).unref();
}

/**
 * Record a WhatsApp sale in TestMandi so the seller's payout page includes it.
 * The seller earns on the full list price; WhatsApp discounts and wallet credit are funded by the platform.
 */
let saleSink = null; // tests can capture sales here
export function setSaleSink(fn) { saleSink = fn; }

export async function recordSaleInTestMandi({ item, phone, listPrice, paymentId }) {
  if (!item?.tmId || !(listPrice > 0)) return false;
  const isBundle = item.type === 'bundle';
  const rec = {
    id: `${isBundle ? 'bp' : 'p'}_wa_${Date.now()}_${randomBytes(3).toString('hex')}`,
    [isBundle ? 'bundleId' : 'testId']: item.tmId,
    buyerEmail: `${phone}@whatsapp.testmandi.in`, price: listPrice, paymentId: paymentId || null, ts: Date.now(), source: 'whatsapp',
  };
  if (saleSink) { saleSink(isBundle ? 'bundlePurchases' : 'purchases', rec); return true; }
  const tm = otherDb(tmDbName());
  if (!tm || !enabled()) return false;
  await tm.collection(isBundle ? 'bundlePurchases' : 'purchases').insertOne(rec);
  return true;
}
