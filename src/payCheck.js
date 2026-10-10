// Payment check: which Razorpay mode and payment methods are active, and the latest payment links.
// Open /admin/payments?key=ADMIN_KEY
import { config } from './config.js';
import { db } from './store.js';
import { esc } from './util.js';

export async function check() {
  const out = { keyMode: '', methods: null, error: '', orders: [] };
  const id = config.razorpay.keyId || '';
  out.keyMode = !id ? 'missing' : id.startsWith('rzp_live_') ? 'live' : id.startsWith('rzp_test_') ? 'test' : 'unknown';
  if (id) {
    try {
      const res = await fetch(`https://api.razorpay.com/v1/methods?key_id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) out.methods = body; else out.error = body?.error?.description || `HTTP ${res.status}`;
    } catch (e) { out.error = e.message; }
  }
  out.orders = (await db.orders.find({ amount: { $gt: 0 } }, { sort: { createdAt: -1 }, limit: 8 })).map((o) => ({ at: o.createdAt, product: o.product, title: o.title, amount: o.amount, status: o.status, link: o.link }));
  out.webhookHits = await db.orders.count({ status: 'paid', amount: { $gt: 0 } });
  return out;
}

export function page(r) {
  const m = r.methods || {};
  const upi = m.upi === true || (m.upi && typeof m.upi === 'object');
  const row = (ok, title, detail = '') => `<div class="c ${ok ? 'ok' : 'bad'}"><div class="t">${esc(title)}</div>${detail ? `<div class="d">${esc(detail)}</div>` : ''}</div>`;
  const banks = m.netbanking && typeof m.netbanking === 'object' ? Object.keys(m.netbanking).length : 0;
  const rows = [
    row(r.keyMode === 'live', `Razorpay keys: ${r.keyMode.toUpperCase()}`, r.keyMode === 'test' ? 'Test keys only take fake payments. In Razorpay Dashboard switch to Live mode → Account & Settings → API keys → Generate live key, and paste the live Key ID and Secret into RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in Railway.' : r.keyMode === 'missing' ? 'RAZORPAY_KEY_ID is not set in Railway.' : ''),
    r.error ? row(false, 'Could not read payment methods from Razorpay', r.error) : '',
    r.methods ? row(upi, upi ? 'UPI is ON (QR on computer, GPay/PhonePe/Paytm on phone)' : 'UPI is OFF on your Razorpay account', upi ? '' : 'This is why only the bank list shows. Razorpay Dashboard → Account & Settings → Payment methods → UPI → Activate (or request activation). If it says "under review", Razorpay support can speed it up.') : '',
    r.methods ? row(true, `Netbanking: ${m.netbanking ? `on (${banks || 'many'} banks)` : 'off'} · Cards: ${m.card ? 'on' : 'off'} · Wallets: ${m.wallet && Object.keys(m.wallet).length ? 'on' : 'off'}`) : '',
  ].join('');
  const orders = r.orders.map((o) => `<tr><td>${esc(new Date(o.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}</td><td>${esc(o.product)}</td><td>${esc(o.title)}</td><td>₹${o.amount}</td><td>${esc(o.status)}</td><td>${o.link ? `<a href="${esc(o.link)}" target="_blank">open</a>` : ''}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment check</title>
<style>:root{--bg:#f5f6fa;--card:#fff;--ink:#1d2030;--muted:#646a80;--bad:#b42318;--line:#e3e5ee}@media (prefers-color-scheme:dark){:root{--bg:#12141b;--card:#1b1e28;--ink:#e9ebf2;--muted:#9aa0b4;--bad:#f87171;--line:#2c3040}}
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}main{max-width:820px;margin:0 auto;padding:16px}.c{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-top:10px}
.t{font-weight:600}.ok .t:before{content:"✅ "}.bad .t:before{content:"❌ "}.bad{border-color:var(--bad)}.d{color:var(--muted);font-size:14px;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left}.wrap{overflow-x:auto}</style></head><body><main>
<h1 style="font-size:20px">Payment check</h1>${rows}
<h2 style="font-size:16px;margin-top:20px">Latest payment links</h2><div class="wrap"><table><tr><th>When</th><th>Product</th><th>Item</th><th>Amount</th><th>Status</th><th>Link</th></tr>${orders || '<tr><td colspan="6">No payment links yet</td></tr>'}</table></div>
<p class="d">Paid orders so far: ${r.webhookHits}. If you paid but it shows "created", check the Razorpay webhook (Settings → Webhooks → payment_link.paid → ${esc(config.baseUrl)}/webhooks/razorpay).</p></main></body></html>`;
}
