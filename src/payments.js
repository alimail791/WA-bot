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
  if (recent && recent.amount === amount) return recent;

  const order = await db.orders.insertOne({ product, phone, item, title, amount, meta, status: 'created', createdAt: new Date(), nudged: false });
  let link = `${config.baseUrl}/dev/pay/${order._id}`;
  let providerId = null;

  if (config.razorpay.keyId) {
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100),
        currency: 'INR',
        description: title.slice(0, 2048),
        reference_id: order._id,
        customer: { contact: '+' + phone },
        notify: { sms: false, email: false },
        reminder_enable: false,
        callback_url: `${config.baseUrl}/paid/${order._id}`,
        callback_method: 'get',
        notes: { product, item },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[razorpay] link failed', data);
      throw new Error('Could not create payment link');
    }
    link = data.short_url;
    providerId = data.id;
  }
  await db.orders.updateOne({ _id: order._id }, { $set: { link, providerId } });
  await track(product, phone, 'order_created', { item, amount });
  return { ...order, link, providerId };
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
  if (body.event === 'payment_link.paid') {
    const pl = body.payload.payment_link.entity;
    const paymentId = body.payload.payment?.entity?.id;
    await markPaid(pl.reference_id, paymentId);
  }
  return { ok: true, status: 200 };
}
