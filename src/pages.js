// Server-rendered pages: the hosted test, its result, and the dev payment page.
import { esc } from './util.js';
import { products } from './products.js';

const BRAND = { yneet: '#2b3a8f', testmandi: '#0f6e66', classcoach: '#7a3b8f' };

export function layout(product, title, body) {
  const brand = BRAND[product] || '#2b3a8f';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--brand:${brand};--bg:#f4f5f9;--card:#fff;--ink:#1b1d2e;--muted:#5d6278;--line:#dfe1ea;--good:#1f8a4c;--bad:#c2402f}
@media(prefers-color-scheme:dark){:root{--bg:#12131c;--card:#1b1d2a;--ink:#eceef6;--muted:#a0a5bd;--line:#2e3144;--good:#4cc47e;--bad:#ec7463;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--brand);color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px}
header b{font-size:16px}#timer{font:600 15px ui-monospace,monospace;background:rgba(255,255,255,.18);padding:4px 10px;border-radius:8px}
main{max-width:720px;margin:0 auto;padding:16px;display:grid;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.ok{color:var(--good);font-weight:600;font-size:14px}.muted{color:var(--muted);font-size:14px}
.q{font-weight:600;margin:0 0 10px}.q small{color:var(--muted);font-weight:400}
label.opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:10px;margin-top:8px;cursor:pointer}
label.opt:has(input:checked){border-color:var(--brand);background:color-mix(in srgb,var(--brand) 10%,transparent)}
input[type=radio]{margin-top:4px;accent-color:var(--brand)}
button,.btn{display:block;width:100%;text-align:center;background:var(--brand);color:#fff;border:0;border-radius:12px;padding:14px;font:600 16px system-ui,sans-serif;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--brand);border:1px solid var(--line)}
.score{font-size:44px;font-weight:800;color:var(--brand);font-variant-numeric:tabular-nums}
.right{color:var(--good)}.wrong{color:var(--bad)}
.bar{position:sticky;bottom:0;background:var(--bg);padding:12px 0}
</style></head><body>${body}</body></html>`;
}

export function testPage(row, questions, { remainingSec, phoneMasked }) {
  const p = products[row.product];
  const qs = questions.map((q, i) => `
  <div class="card"><p class="q"><small>Q${i + 1} · ${esc(q.subject)}${q.topic ? ' · ' + esc(q.topic) : ''}</small><br>${esc(q.question)}</p>
  ${q.options.map((o, j) => `<label class="opt"><input type="radio" name="q_${esc(q._id)}" value="${j}"> <span>${esc(o)}</span></label>`).join('')}
  </div>`).join('');
  return layout(row.product, row.title, `
<header><b>${esc(p.name)} · ${esc(row.title)}</b><span id="timer">--:--</span></header>
<main>
  <div class="card"><div class="ok">✓ Logged in as ${esc(phoneMasked)} from WhatsApp</div>
  <div class="muted">${questions.length} questions · ${row.durationMin} minutes. Your answers are saved on this phone as you go.</div></div>
  <form method="post" id="f">${qs}
  <div class="bar"><button type="submit" id="sub">Submit test</button></div></form>
</main>
<script>
(function(){
  var key='ans-${esc(row.token)}', f=document.getElementById('f'), left=${Math.max(0, Math.floor(remainingSec))};
  try{var saved=JSON.parse(localStorage.getItem(key)||'{}');Object.keys(saved).forEach(function(n){var el=f.querySelector('input[name="'+n+'"][value="'+saved[n]+'"]');if(el)el.checked=true});}catch(e){}
  f.addEventListener('change',function(e){try{var s=JSON.parse(localStorage.getItem(key)||'{}');s[e.target.name]=e.target.value;localStorage.setItem(key,JSON.stringify(s));}catch(err){}});
  f.addEventListener('submit',function(e){
    var answered=f.querySelectorAll('input:checked').length, total=${questions.length};
    if(!window.__force && answered<total && !confirmBox(total-answered)){e.preventDefault();return}
    document.getElementById('sub').disabled=true;document.getElementById('sub').textContent='Submitting…';
  });
  function confirmBox(n){var b=document.getElementById('sub');if(b.dataset.c){return true}b.dataset.c=1;b.textContent=n+' unanswered. Tap again to submit';return false}
  var t=document.getElementById('timer');
  function tick(){var m=Math.floor(left/60),s=left%60;t.textContent=(m<10?'0':'')+m+':'+(s<10?'0':'')+s;if(left<=0){window.__force=true;f.requestSubmit?f.requestSubmit():f.submit();return}left--;setTimeout(tick,1000)}
  tick();
})();
</script>`);
}

export function resultPage(row, questions, attempt, waUrl) {
  const p = products[row.product];
  const review = questions.map((q, i) => {
    const mine = attempt.answers[q._id];
    const ok = Number(mine) === q.answer;
    return `<div class="card"><p class="q"><small>Q${i + 1}</small><br>${esc(q.question)}</p>
    <div class="${ok ? 'right' : 'wrong'}">${ok ? '✓' : '✗'} Your answer: ${mine == null || mine === '' ? 'Not answered' : esc(q.options[mine])}</div>
    ${ok ? '' : `<div class="right">Correct: ${esc(q.options[q.answer])}</div>`}
    ${q.explanation ? `<div class="muted" style="margin-top:6px">💡 ${esc(q.explanation)}</div>` : ''}</div>`;
  }).join('');
  return layout(row.product, 'Result · ' + row.title, `
<header><b>${esc(p.name)} · Result</b></header>
<main>
  <div class="card"><div class="muted">${esc(row.title)}</div><div class="score">${attempt.correct}<span style="font-size:20px;color:var(--muted)"> / ${attempt.total}</span></div>
  <div class="muted">Your detailed result has been sent to you on WhatsApp.</div></div>
  ${waUrl ? `<a class="btn" href="${esc(waUrl)}">Back to WhatsApp</a>` : ''}
  ${row.kind === 'mock' ? '' : review}
  ${row.kind === 'mock' ? '<div class="card muted">Question-by-question review and chapter analysis are in your full analysis on WhatsApp.</div>' : ''}
</main>`);
}

export function messagePage(product, title, text, waUrl) {
  return layout(product || 'yneet', title, `<header><b>${esc(title)}</b></header><main><div class="card">${esc(text)}</div>${waUrl ? `<a class="btn" href="${esc(waUrl)}">Open WhatsApp</a>` : ''}</main>`);
}

export function devPayPage(order) {
  return layout(order.product, 'Test payment', `
<header><b>Test payment (dev mode)</b></header>
<main><div class="card"><div class="muted">Razorpay keys are not set, so this page simulates a payment.</div>
<p class="q">${esc(order.title)}</p><div class="score">₹${esc(order.amount)}</div></div>
${order.status === 'paid' ? '<div class="card ok">Already paid ✓</div>' : `<form method="post"><button>Simulate successful payment</button></form>`}
</main>`);
}
