// Orders and Razorpay Payment Links. Without Razorpay keys, links point to a dev page that simulates payment.
import { db } from './store.js';
import { config } from './config.js';
import { hmac, safeEqual } from './util.js';
import { dispatchPaid, track } from './engine.js';

export class PaymentsNotReady extends Error {
  constructor() { super('Payments not configured'); this.code = 'NO_PAYMENTS'; }
}

export async function createOrder({ product, phone, item, title, amount, meta = {} }) {
  // Live WhatsApp without Razorpay: never hand out the free test-payment page
  if (!config.razorpay.keyId && config.provider !== 'sim') {
    await track(product, phone, 'order_blocked_no_payments', { item, amount });
    throw new PaymentsNotReady();
  }
  // Reuse a recent unpaid order for the same item so repeated taps don't create many links
  const recent = await db.orders.findOne({ product, phone, item, status: 'created', createdAt: { $gte: new Date(Date.now() - 6 * 3600e3) } });
  if (recent && recent.amount === amount && (!config.razorpay.keyId || (recent.rzpOrderId && recent.link === (config.payBase ? `${config.payBase}/pay/${recent._id}` : recent.rzpLink)))) return recent;

  const order = await db.orders.insertOne({ product, phone, item, title, amount, meta, status: 'created', createdAt: new Date(), nudged: false });
  let link = `${config.baseUrl}/dev/pay/${order._id}`;
  let providerId = null, rzpLink = null, rzpOrderId = null;

  if (config.razorpay.keyId) {
    // 1) Razorpay Order for our own payment page (UPI apps first on phones, QR first on computers)
    const ord = await rzp('orders', { method: 'POST', body: { amount: Math.round(amount * 100), currency: 'INR', receipt: String(order._id).slice(0, 40), notes: { order_id: String(order._id), product, item } } });
    if (ord.ok) rzpOrderId = ord.data.id; else console.error('[razorpay] order failed', ord.data);
    // 2) Razorpay Payment Link as a backup ("other ways to pay") and for the payment_link.paid webhook
    const pl = await rzp('payment_links', { method: 'POST', body: {
      amount: Math.round(amount * 100), currency: 'INR', description: title.slice(0, 2048), reference_id: String(order._id),
      customer: { contact: '+' + phone }, notify: { sms: false, email: false }, reminder_enable: false,
      callback_url: `${config.baseUrl}/paid/${order._id}`, callback_method: 'get', notes: { product, item },
    } });
    if (pl.ok) { rzpLink = pl.data.short_url; providerId = pl.data.id; } else console.error('[razorpay] link failed', pl.data);
    if (!rzpOrderId && !rzpLink) throw new Error('Could not create payment link');
    link = rzpOrderId && (config.payBase || !rzpLink) ? `${config.payBase || config.baseUrl}/pay/${order._id}` : rzpLink;
  }
  await db.orders.updateOne({ _id: order._id }, { $set: { link, providerId, rzpLink, rzpOrderId } });
  await track(product, phone, 'order_created', { item, amount });
  return { ...order, link, providerId, rzpLink, rzpOrderId };
}

async function rzp(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method,
      headers: { Authorization: 'Basic ' + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64'), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch (e) { return { ok: false, data: { error: { description: e.message } } }; }
}

// Payment page success: Razorpay signs order_id|payment_id with our key secret
export async function verifyCheckout(orderId, { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = {}) {
  const order = await db.orders.findOne({ _id: orderId });
  if (!order || !oid || !pid || !sig || oid !== order.rzpOrderId) return { ok: false };
  if (!safeEqual(hmac(`${oid}|${pid}`, config.razorpay.keySecret), sig)) return { ok: false };
  await markPaid(orderId, pid);
  return { ok: true };
}

// Ask Razorpay directly whether an order was paid (covers missed webhooks and UPI app hand-offs)
const lastSync = new Map();
export async function syncOrder(order) {
  if (!order || order.status !== 'created' || !config.razorpay.keyId) return order;
  const k = String(order._id);
  if (Date.now() - (lastSync.get(k) || 0) < 4000) return order;
  lastSync.set(k, Date.now());
  if (order.rzpOrderId) {
    const r = await rzp(`orders/${order.rzpOrderId}/payments`);
    const p = r.ok && (r.data.items || []).find((x) => x.status === 'captured' || x.status === 'authorized');
    if (p) return markPaid(order._id, p.id);
  }
  if (order.providerId) {
    const r = await rzp(`payment_links/${order.providerId}`);
    if (r.ok && r.data.status === 'paid') return markPaid(order._id, r.data.payments?.[0]?.payment_id || null);
  }
  return order;
}

// Every few minutes: confirm recent unpaid orders with Razorpay
export async function syncRecentOrders(now = Date.now()) {
  if (!config.razorpay.keyId) return 0;
  const orders = await db.orders.find({ status: 'created', amount: { $gt: 0 }, createdAt: { $gte: new Date(now - 3 * 3600e3) } }, { limit: 100 });
  let n = 0;
  for (const o of orders) { const r = await syncOrder(o); if (r?.status === 'paid') n++; }
  return n;
}

export async function markPaid(orderId, paymentId = null) {
  const order = await db.orders.findOne({ _id: orderId });
  if (!order || order.status === 'paid') return order; // idempotent: webhooks can arrive twice
  const paid = await db.orders.updateOne({ _id: orderId, status: 'created' }, { $set: { status: 'paid', paidAt: new Date(), paymentId } });
  if (!paid) return order;
  await track(order.product, order.phone, 'paid', { item: order.item, amount: order.amount });
  await dispatchPaid(paid);
  return paid;
}

// Razorpay webhook: verify signature over the raw body, then mark the order paid
export async function razorpayWebhook(rawBody, signature) {
  if (!config.razorpay.webhookSecret) throw new Error('RAZORPAY_WEBHOOK_SECRET not set');
  const expected = hmac(rawBody, config.razorpay.webhookSecret);
  if (!signature || !safeEqual(expected, signature)) return { ok: false, status: 400 };
  const body = JSON.parse(rawBody);
  if (body.event === 'order.paid' || body.event === 'payment.captured') {
    const ent = body.payload.order?.entity || {};
    const pay = body.payload.payment?.entity || {};
    const ours = ent.notes?.order_id || pay.notes?.order_id || ent.receipt;
    if (ours) await markPaid(ours, pay.id || null);
  }
  if (body.event === 'payment_link.paid') {
    const pl = body.payload.payment_link.entity;
    const paymentId = body.payload.payment?.entity?.id;
    await markPaid(pl.reference_id, paymentId);
  }
  return { ok: true, status: 200 };
}
