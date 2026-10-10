// Public website for pay.yneet.in: home, refund policy and contact. Razorpay reviews these before
// approving the payment address, so they describe the business, products, prices and policies plainly.
import { config } from './config.js';
import { products } from './products.js';
import { esc, waLink } from './util.js';

const NAME = () => config.wa.businessName;
const PHONE = () => config.wa.displayNumbers.yneet;
const EMAIL = () => process.env.CONTACT_EMAIL || '';
const nav = `<nav><a href="/">Home</a><a href="/contact">Contact</a><a href="/refund">Refunds</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav>`;

export function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(NAME())}</title><meta name="description" content="${esc(NAME())}: secure online payments for YNeet, TestMandi and ClassCoach.">
<style>
:root{--brand:#2b3a8f;--ink:#1b1d2e;--muted:#5d6278;--bg:#f5f6fa;--card:#fff;--line:#e2e4ee;--ok:#1f8a4c}
@media(prefers-color-scheme:dark){:root{--brand:#8e9cf0;--ink:#eceef6;--muted:#a0a5bd;--bg:#12131c;--card:#1b1d2a;--line:#2e3144;--ok:#4cc47e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:#2b3a8f;color:#fff;padding:14px 16px}header .in{max-width:960px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
header b{font-size:18px}nav{display:flex;gap:14px;flex-wrap:wrap}nav a{color:#fff;opacity:.9;text-decoration:none;font-size:14px}nav a:hover{opacity:1;text-decoration:underline}
main{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:28px;line-height:1.25;margin:0 0 8px}h2{font-size:20px;margin:28px 0 10px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}.card h3{margin:0 0 6px;font-size:18px}
.price{font-weight:700}.btn{display:inline-block;background:#1f8a4c;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600}
.btn.alt{background:transparent;color:var(--brand);border:1px solid var(--line)}ul{padding-left:20px}footer{border-top:1px solid var(--line);margin-top:36px;padding:20px 16px;text-align:center;font-size:14px}footer a{color:var(--brand)}
</style></head><body><header><div class="in"><b>${esc(NAME())}</b>${nav}</div></header><main>${body}</main>
<footer class="muted">© ${new Date().getFullYear()} ${esc(NAME())} · <a href="https://www.yneet.in">yneet.in</a> · <a href="https://testmandi.in">testmandi.in</a> · <a href="https://classcoach.in">classcoach.in</a><br>Payments are processed securely by Razorpay.</footer></body></html>`;
}

export function homePage() {
  const y = products.yneet, cc = products.classcoach;
  const monthly = Object.values(y.monthlyByClass);
  const ccPlans = Object.values(cc.plans);
  const general = ccPlans.filter((p) => p.track !== 'neet_jee'), nj = ccPlans.filter((p) => p.track === 'neet_jee');
  const wa = waLink(PHONE(), 'Hi YNeet');
  return shell('Secure payments', `
<h1>${esc(NAME())} payments</h1>
<p class="muted">This is the official payment page of ${esc(NAME())}, the team behind <a href="https://www.yneet.in">YNeet</a> (NEET preparation), <a href="https://testmandi.in">TestMandi</a> (mock test marketplace) and <a href="https://classcoach.in">ClassCoach</a> (quizzes for teachers). Students and teachers buy our plans and tests through our WhatsApp assistant or our websites, and pay here by UPI, card, net banking or wallet.</p>
<p><a class="btn" href="${esc(wa)}">Start on WhatsApp</a> &nbsp; <a class="btn alt" href="https://www.yneet.in">Visit yneet.in</a></p>

<h2>What you can buy</h2>
<div class="grid">
  <div class="card"><h3>YNeet · NEET preparation</h3><p class="muted">Chapter practice from 3,600+ NEET questions, full mock tests with NEET marking, previous year papers and rank estimate.</p>
    <ul><li><span class="price">₹${y.trial.price}</span> for ${y.trial.days} days full access</li><li>Monthly plan <span class="price">₹${Math.min(...monthly)}–₹${Math.max(...monthly)}</span> by class (6th to Dropper)</li></ul></div>
  <div class="card"><h3>TestMandi · Mock tests</h3><p class="muted">Mock tests for NEET, SSC, TNPSC, banking and more, created by verified teachers and institutes.</p>
    <ul><li>Single tests and test packs, typically <span class="price">₹29–₹199</span>, price shown before payment</li><li>Explanations and rank included</li></ul></div>
  <div class="card"><h3>ClassCoach · For teachers</h3><p class="muted">Make a quiz in seconds, send one link to the class WhatsApp group, and get every student's marks automatically. 30-day free trial.</p>
    <ul>${general.map((p) => `<li>${esc(p.title)}: <span class="price">₹${p.price}</span> for ${p.months} months</li>`).join('')}${nj.length ? `<li>NEET/JEE question bank plans from <span class="price">₹${Math.min(...nj.map((p) => p.price))}</span></li>` : ''}</ul></div>
</div>

<h2>How payment works</h2>
<ol><li>Choose a plan or test in our WhatsApp assistant or on our website.</li><li>You receive a secure payment link on this site (pay.yneet.in) showing the item and amount.</li><li>Pay with GPay, PhonePe, Paytm or any UPI app, card, net banking or wallet. Payments are processed by Razorpay; we never see your card or bank details.</li><li>Access is delivered instantly on WhatsApp and on the product website.</li></ol>

<h2>Need help?</h2>
<p>WhatsApp <a href="${esc(wa)}">+${esc(PHONE())}</a>${EMAIL() ? ` · Email <a href="mailto:${esc(EMAIL())}">${esc(EMAIL())}</a>` : ''}. See our <a href="/refund">refund policy</a>, <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</p>`);
}

export function refundPage() {
  return shell('Refund & cancellation policy', `
<h1>Refund & cancellation policy</h1><p class="muted">Last updated 10 October 2026</p>
<p>All our products are digital (online tests, practice access and teaching tools) and are delivered instantly after payment.</p>
<h2>When you get a full refund</h2><ul>
<li>You were charged but access was not delivered within 24 hours.</li>
<li>You were charged twice for the same item.</li>
<li>A technical problem on our side stopped you from using what you paid for, and we could not fix it.</li></ul>
<h2>When refunds are not given</h2><ul><li>After a test has been attempted or a plan has been used.</li><li>For change of mind after access has been delivered.</li></ul>
<h2>Cancellation</h2><p>Plans are prepaid for a fixed period and do not renew automatically, so there is nothing to cancel. You can stop using a plan at any time.</p>
<h2>How to ask for a refund</h2><p>Message us on WhatsApp at <a href="${esc(waLink(PHONE(), 'Refund request'))}">+${esc(PHONE())}</a>${EMAIL() ? ` or email ${esc(EMAIL())}` : ''} within 7 days of payment with your phone number and payment ID. Approved refunds are sent to the original payment method within 5–7 working days.</p>`);
}

export function contactPage() {
  return shell('Contact us', `
<h1>Contact us</h1>
<div class="card"><p><b>${esc(NAME())}</b><br>${esc(process.env.CONTACT_ADDRESS || 'Tamil Nadu, India')}</p>
<p>WhatsApp / phone: <a href="${esc(waLink(PHONE(), 'Hi'))}">+${esc(PHONE())}</a>${EMAIL() ? `<br>Email: <a href="mailto:${esc(EMAIL())}">${esc(EMAIL())}</a>` : ''}</p>
<p class="muted">We reply on WhatsApp between 10 AM and 7 PM, Monday to Saturday.</p></div>
<h2>Our websites</h2><ul><li><a href="https://www.yneet.in">www.yneet.in</a> · NEET preparation</li><li><a href="https://testmandi.in">testmandi.in</a> · Mock test marketplace</li><li><a href="https://classcoach.in">classcoach.in</a> · Quizzes for teachers</li></ul>`);
}
