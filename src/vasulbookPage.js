// Owner page for VasulBook WhatsApp messages: template approval status, who is due today, submit templates.
import { NAME, LANGS, KINDS, CATEGORY, tr } from './vasulbookTemplates.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LABEL = { welcome: 'Welcome (new sign-up)', verify: 'Confirm number & email', refer: 'Refer & earn', missyou: 'We miss you (5 days idle)' };
const color = (s) => (s === 'APPROVED' ? '#1B7A3E' : s === 'REJECTED' ? '#B3261E' : s ? '#9A5B00' : '#888');

export function vasulbookPage({ st, preview, link, sentWeek, key, result }) {
  const map = st.map || {};
  const head = `<tr><th>Message</th>${LANGS.map((l) => `<th>${l}</th>`).join('')}</tr>`;
  const rows = KINDS.map((k) => `<tr><td><b>${LABEL[k]}</b><div class="m">${NAME(k)} · ${CATEGORY[k].toLowerCase()}</div></td>${LANGS.map((l) => {
    const s = map[`${NAME(k)}|${l}`];
    return `<td style="color:${color(s?.status)}">${s ? (s.status === 'APPROVED' ? '✓' : esc(s.status.toLowerCase())) : '–'}${s?.status === 'REJECTED' && s.reason && s.reason !== 'NONE' ? `<div class="m">${esc(String(s.reason).toLowerCase().replace(/_/g, ' '))}</div>` : ''}</td>`;
  }).join('')}</tr>`).join('');
  const samples = KINDS.map((k) => `<details><summary>${LABEL[k]}</summary><p>${esc(tr('en')[k])}</p><p class="m">Footer: ${esc(tr('en').footer)}</p></details>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VasulBook WhatsApp</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#F2F5F4;color:#14211D}main{max-width:1000px;margin:auto;padding:20px 16px}
h1{font-size:24px}section{background:#fff;border:1px solid #D7E0DC;border-radius:12px;padding:16px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:6px 8px;border-bottom:1px solid #E5ECE9;text-align:center}td:first-child,th:first-child{text-align:left}
.m{color:#56665F;font-size:12.5px}.wrap{overflow-x:auto}button{font:inherit;font-weight:600;background:#2445B5;color:#fff;border:0;border-radius:9px;padding:10px 16px;cursor:pointer}
.k{display:inline-block;margin-right:18px}.k b{font-size:22px;display:block}.err{color:#B3261E}</style></head><body><main>
<h1>VasulBook WhatsApp messages</h1>
${result ? `<section><h2>Submitted to Meta</h2><div class="wrap"><table><tr><th>Template</th><th>Language</th><th>Result</th></tr>${result.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.lang)}</td><td>${esc(r.result)}</td></tr>`).join('')}</table></div><p class="m">Meta usually approves within minutes to 24 hours. Refresh this page later.</p></section>` : ''}
<section><h2>1. Link to www.vasulbook.com</h2>${link ? (link.error ? `<p class="err">Not connected: ${esc(link.error)}</p>` : `<p>✓ Connected · ${link.owners} owners, ${link.with_phone} with a phone number.</p>`) : '<p class="m">–</p>'}
${preview && !preview.error ? `<p><span class="k"><b>${preview.newLast36h}</b>new in 36 h</span>${KINDS.slice(1).map((k) => `<span class="k"><b>${preview.due[k] || 0}</b>${LABEL[k]} due</span>`).join('')}${sentWeek !== null ? `<span class="k"><b>${sentWeek}</b>sent in 7 days</span>` : ''}</p>` : ''}</section>
<section><h2>2. Templates (approval by Meta)</h2><div class="wrap"><table>${head}${rows}</table></div>
${map._error ? `<p class="err">${esc(map._error)}</p>` : ''}
<p class="m">✓ approved · pending = waiting for Meta · – = not submitted. Owners get their app language; if it isn't approved yet they get English. Messages only go out once a template is approved.</p>
<form method="post" action="/admin/vasulbook/templates?key=${encodeURIComponent(key)}"><button>Submit missing templates to Meta</button></form></section>
<section><h2>English wording</h2>${samples}</section>
<p class="m">Schedule (India time): welcome every 10 min from 8 AM to 9:30 PM; confirm, refer and we-miss-you daily at 5:45 PM, at most one VasulBook message per owner per day. STOP stops all of them.</p>
</main></body></html>`;
}
