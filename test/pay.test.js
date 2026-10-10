// Our payment page: Razorpay order + checkout, signature check, and status sync.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.STORE = 'memory';
process.env.PROVIDER = 'sim';
process.env.ENABLE_CRON = 'false';
process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
process.env.RAZORPAY_KEY_SECRET = 'secret123';

const realFetch = globalThis.fetch;
const rzpCalls = [];
let captured = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.razorpay.com/')) return realFetch(url, opts);
  rzpCalls.push({ u, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.endsWith('/orders') && opts.method === 'POST') return new Response(JSON.stringify({ id: 'order_TEST1' }));
  if (u.endsWith('/payment_links') && opts.method === 'POST') return new Response(JSON.stringify({ id: 'plink_1', short_url: 'https://rzp.io/rzp/abc' }));
  if (u.includes('/orders/order_TEST1/payments')) return new Response(JSON.stringify({ items: captured ? [{ id: 'pay_sync', status: 'captured' }] : [] }));
  if (u.includes('/payment_links/plink_1')) return new Response(JSON.stringify({ status: 'created' }));
  return new Response('{}', { status: 404 });
};

const { connect, db } = await import('../src/store.js');
const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');
const pay = await import('../src/payments.js');

let server, base;
before(async () => { await connect(); server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; config.baseUrl = base; });
after(() => { server.close(); globalThis.fetch = realFetch; });

test('Order gets our payment page link with a Razorpay order and a backup payment link', async () => {
  const o = await pay.createOrder({ product: 'testmandi', phone: '919000000700', item: 'test:X', title: 'NEET Physics Test 7', amount: 49 });
  assert.equal(o.link, `${base}/pay/${o._id}`);
  assert.equal(o.rzpOrderId, 'order_TEST1');
  assert.equal(o.rzpLink, 'https://rzp.io/rzp/abc');
  assert.equal(rzpCalls.find((c) => c.u.endsWith('/orders')).body.amount, 4900);
});

test('Phone sees UPI apps first, computer sees the QR, WhatsApp browser gets the Chrome hint', async () => {
  const o = await db.orders.findOne({ rzpOrderId: 'order_TEST1' });
  const get = (ua) => realFetch(`${base}/pay/${o._id}`, { headers: { 'user-agent': ua } }).then((r) => r.text());
  const phone = await get('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36');
  assert.match(phone, /Pay with GPay \/ PhonePe \/ Paytm/);
  assert.match(phone, /"flows":\["intent","collect"\]/);
  assert.match(phone, /"order_id":"order_TEST1"/);
  assert.doesNotMatch(phone, /Opened inside WhatsApp/);
  const desk = await get('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130');
  assert.match(desk, /Show UPI QR code/);
  assert.match(desk, /"flows":\["qr","collect"\]/);
  const wa = await get('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Version/4.0 Chrome/130 Mobile Safari/537.36 WhatsApp/2.24');
  assert.match(wa, /Opened inside WhatsApp/);
  assert.match(wa, /Other ways to pay/);
});

test('Checkout success with a valid signature marks the order paid; a bad one does not', async () => {
  const o = await db.orders.findOne({ rzpOrderId: 'order_TEST1' });
  const post = (b) => realFetch(`${base}/pay/${o._id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  assert.equal((await post({ razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_1', razorpay_signature: 'bad' })).ok, false);
  const sig = createHmac('sha256', 'secret123').update('order_TEST1|pay_1').digest('hex');
  assert.equal((await post({ razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_1', razorpay_signature: sig })).ok, true);
  const paid = await db.orders.findOne({ _id: o._id });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paymentId, 'pay_1');
  const page = await realFetch(`${base}/pay/${o._id}`).then((r) => r.text());
  assert.match(page, /already paid/);
});

test('Paid in a UPI app without coming back: status check asks Razorpay and confirms', async () => {
  const o = await pay.createOrder({ product: 'yneet', phone: '919000000701', item: 'plan:trial5d', title: 'YNeet 5 days', amount: 99 });
  let s = await realFetch(`${base}/pay/${o._id}/status`).then((r) => r.json());
  assert.equal(s.paid, false);
  captured = true;
  await new Promise((r) => setTimeout(r, 4100)); // status sync is rate-limited per order
  s = await realFetch(`${base}/pay/${o._id}/status`).then((r) => r.json());
  assert.equal(s.paid, true);
  assert.equal((await db.orders.findOne({ _id: o._id })).paymentId, 'pay_sync');
});
