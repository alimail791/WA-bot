// Leads console: one page for the owner and assistant to run the campaign and work hot leads.
// Served at /admin/leads?key=ADMIN_KEY. All actions call the JSON routes in app.js with the same key.
export function leadsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leads · Raise Academy</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<style>
:root{--bg:#f5f6fa;--card:#fff;--ink:#1d2030;--muted:#646a80;--line:#e3e5ee;--brand:#1f6f5c;--brand2:#e8f4f0;--hot:#c2410c;--hotbg:#fff3ea;--bad:#b42318;--badbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--bg:#12141b;--card:#1b1e28;--ink:#e9ebf2;--muted:#9aa0b4;--line:#2c3040;--brand:#4cc3a1;--brand2:#18342d;--hot:#fb923c;--hotbg:#3a2416;--bad:#f87171;--badbg:#3a1a1a}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
main{max-width:1000px;margin:0 auto;padding:16px}h1{font-size:21px;margin:4px 0 2px}h2{font-size:16px;margin:0 0 10px}
.muted{color:var(--muted);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-top:14px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.grow{flex:1}
button,.btn{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:8px 12px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;min-height:40px}
button.primary,.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}button.danger{color:var(--bad)}
input,select,textarea{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:10px;padding:8px 10px;min-height:40px}
input[type=number]{width:90px}.pill{font-size:12px;border-radius:99px;padding:3px 9px;background:var(--brand2);color:var(--brand);font-weight:600;white-space:nowrap}
.pill.off{background:var(--badbg);color:var(--bad)}.pill.hot{background:var(--hotbg);color:var(--hot)}
.banner{background:var(--badbg);color:var(--bad);border-radius:10px;padding:10px;margin-top:10px;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.stat{border:1px solid var(--line);border-radius:12px;padding:10px}
.stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.stat span{font-size:12px;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);font-size:14px}th{font-size:12px;color:var(--muted)}
.tablewrap{overflow-x:auto}.lead{border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:10px}.lead h3{margin:0;font-size:15px}
.lead .meta{font-size:13px;color:var(--muted);margin:3px 0 8px}.notes{font-size:13px;color:var(--muted);margin-top:6px;white-space:pre-wrap}
.tabs{display:flex;gap:6px;flex-wrap:wrap}.tabs button[aria-pressed=true]{background:var(--brand);color:#fff;border-color:var(--brand)}
#toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:10px;display:none;z-index:9;max-width:90vw}
</style></head><body><main>
<h1>Leads</h1><div class="muted">Raise Academy WhatsApp bot · <a href="#" id="dash">Sales numbers</a></div>

<section class="card" id="campaign"><h2>Campaign</h2><div id="campBody" class="muted">Loading…</div></section>

<section class="card"><h2>Funnel</h2><div class="stats" id="stats"></div><div class="tablewrap" style="margin-top:12px"><table id="segTable"></table></div></section>

<section class="card"><div class="row"><h2 class="grow" style="margin:0">Leads to work</h2>
<div class="tabs" id="tabs"><button data-v="hot" aria-pressed="true">🔥 Hot</button><button data-v="replied">Replied</button><button data-v="demo">Demo</button><button data-v="trial">Trial</button><button data-v="customer">Customers</button><button data-v="all">All</button></div></div>
<div class="row" style="margin-top:10px"><input id="q" class="grow" placeholder="Search name, institute, city or number"><select id="seg"><option value="">All types</option></select></div>
<div id="list"></div><div class="row" style="margin-top:10px"><button id="more" style="display:none">Show more</button></div></section>

<section class="card"><h2>Import contacts</h2>
<p class="muted" style="margin-top:0">Excel (.xlsx) or CSV. Columns can be in any order: phone/mobile, name, institute/school, type, city. Duplicates, landlines and people already using our products are skipped automatically.</p>
<div class="row"><input type="file" id="file" accept=".xlsx,.xls,.csv,.txt"><select id="defType"><option value="">Type: detect from the sheet</option></select><input id="tag" placeholder="List name (optional)"></div>
<div class="row" style="margin-top:8px"><textarea id="paste" class="grow" rows="3" placeholder="…or paste rows here: 9443012345, Ravi Kumar, Sri Vidya Academy, coaching, Madurai"></textarea></div>
<div class="row" style="margin-top:8px"><button class="primary" id="importBtn">Import</button><span class="muted" id="importMsg"></span></div>
<details style="margin-top:12px"><summary>Add one lead</summary><div class="row" style="margin-top:8px"><input id="aPhone" placeholder="Mobile"><input id="aName" placeholder="Name"><input id="aOrg" placeholder="Institute / school"><select id="aSeg"></select><input id="aCity" placeholder="City"><button id="addBtn">Add</button></div></details>
</section>
<p class="muted">Stages: new → contacted → replied → demo → trial → customer. Exits: lost (said stop / not interested), cold (no reply after 3 messages), invalid (not on WhatsApp), existing (already our user, never messaged).</p>
</main><div id="toast"></div>
<script>
const KEY = new URLSearchParams(location.search).get('key') || '';
document.getElementById('dash').href = '/admin/dashboard?key=' + encodeURIComponent(KEY);
const api = async (path, body) => {
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error((await r.text()) || r.status);
  return r.json();
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const toast = (t) => { const el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(el._t); el._t = setTimeout(() => (el.style.display = 'none'), 3500); };
const ago = (d) => { if (!d) return ''; const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
let SEGS = {}, TEAM = [], view = 'hot', page = 0;

async function loadSummary() {
  const s = await api('/admin/leads/summary');
  SEGS = s.segments; TEAM = s.team;
  if (!$('seg').options.length || $('seg').options.length === 1) {
    for (const [k, v] of Object.entries(SEGS)) { $('seg').add(new Option(v.label, k)); $('defType').add(new Option('Type: all ' + v.label, k)); $('aSeg').add(new Option(v.label, k)); }
  }
  const c = s.campaign;
  $('campBody').className = '';
  $('campBody').innerHTML = \`
    <div class="row"><span class="pill \${c.running ? '' : 'off'}">\${c.running ? '● Running' : '❚❚ Paused'}</span>
    <span class="grow muted">Sent today: <b>\${s.sentToday}</b> of \${c.dailyCap} · \${c.startHour}:00–\${c.endHour}:00 IST\${c.sundays ? '' : ', Mon–Sat'} · Ready to send: \${s.total.new || 0} new</span>
    <button class="\${c.running ? 'danger' : 'primary'}" id="toggle">\${c.running ? 'Pause' : 'Start campaign'}</button></div>
    \${c.pausedReason ? '<div class="banner">⏸️ ' + esc(c.pausedReason) + '</div>' : ''}
    <div class="row" style="margin-top:10px"><label class="muted">Messages per day <input type="number" id="cap" min="0" max="5000" value="\${c.dailyCap}"></label>
    <label class="muted">From <input type="number" id="sh" min="6" max="22" value="\${c.startHour}"></label><label class="muted">to <input type="number" id="eh" min="7" max="23" value="\${c.endHour}"></label>
    <label class="muted"><input type="checkbox" id="sun" \${c.sundays ? 'checked' : ''}> Sundays</label><button id="saveCamp">Save</button></div>
    <div class="row muted" style="margin-top:8px">This week: \${s.week.sent} sent · \${s.week.read} read · \${s.week.taps} taps · <span style="color:\${s.week.stopPct > 3 ? 'var(--bad)' : 'inherit'}">\${s.week.stops} stops (\${s.week.stopPct}%)</span> · \${s.week.failed} failed. Auto-pause above \${s.maxStopPct}% stops.</div>
    <details style="margin-top:10px"><summary>Send a test to your own WhatsApp first</summary><div class="row" style="margin-top:8px"><input id="tPhone" placeholder="Your mobile" value="\${esc(s.owner || '')}"><select id="tSeg">\${Object.entries(SEGS).map(([k, v]) => '<option value="' + k + '">' + esc(v.label) + '</option>').join('')}</select>
    <select id="tStep"><option value="0">First message</option><option value="1">Follow-up</option><option value="2">Last message</option></select><button id="testBtn">Send test</button></div></details>\`;
  $('toggle').onclick = async () => { await api('/admin/leads/campaign', { running: !c.running }); toast(c.running ? 'Paused' : 'Campaign started. Messages go out every 5 minutes in sending hours.'); loadSummary(); };
  $('saveCamp').onclick = async () => { await api('/admin/leads/campaign', { dailyCap: +$('cap').value, startHour: +$('sh').value, endHour: +$('eh').value, sundays: $('sun').checked }); toast('Saved'); loadSummary(); };
  $('testBtn').onclick = async () => { try { const r = await api('/admin/leads/test', { phone: $('tPhone').value, segment: $('tSeg').value, step: +$('tStep').value }); toast(r.ok ? 'Sent. Check WhatsApp.' : 'WhatsApp said: ' + (r.error || 'failed')); } catch (e) { toast(e.message); } };
  const t = s.total, order = [['all', 'Total'], ['new', 'Not sent yet'], ['contacted', 'Contacted'], ['replied', 'Replied'], ['demo', 'Saw demo'], ['trial', 'Trying'], ['customer', 'Customers'], ['hot', '🔥 Hot']];
  $('stats').innerHTML = order.map(([k, l]) => '<div class="stat"><b>' + (t[k] || 0) + '</b><span>' + l + '</span></div>').join('') + '<div class="stat"><b>₹' + (t.revenue || 0).toLocaleString('en-IN') + '</b><span>Revenue from leads</span></div>';
  const cols = ['new', 'contacted', 'replied', 'demo', 'trial', 'customer', 'lost', 'cold'];
  $('segTable').innerHTML = '<tr><th>Type</th><th>Total</th>' + cols.map((c) => '<th>' + c + '</th>').join('') + '</tr>' +
    Object.entries(s.bySeg).map(([k, r]) => '<tr><td>' + esc(SEGS[k]?.label || k) + '</td><td>' + r.all + '</td>' + cols.map((c) => '<td>' + (r[c] || 0) + '</td>').join('') + '</tr>').join('');
}

function card(l) {
  const seg = SEGS[l.segment]?.label || l.segment;
  const last = l.lastInboundAt ? 'replied ' + ago(l.lastInboundAt) : l.lastSentAt ? 'messaged ' + ago(l.lastSentAt) : 'added ' + ago(l.createdAt);
  return \`<div class="lead" data-p="\${l.phone}"><div class="row"><h3 class="grow">\${esc(l.name || l.org || '+' + l.phone)}\${l.name && l.org ? ' · <span class="muted">' + esc(l.org) + '</span>' : ''}</h3>
  \${l.hot && !['customer', 'lost'].includes(l.stage) ? '<span class="pill hot">🔥 ' + esc(l.hotWhy || 'hot') + '</span>' : ''}<span class="pill">\${esc(l.stage)}</span></div>
  <div class="meta">\${esc(seg)}\${l.city ? ' · ' + esc(l.city) : ''} · +\${l.phone} · \${last}\${l.revenue ? ' · ₹' + l.revenue : ''}\${l.feedback ? ' · feedback ' + l.feedback + '/5' : ''}</div>
  <div class="row"><a class="btn primary" target="_blank" href="https://wa.me/\${l.phone}">💬 WhatsApp</a><a class="btn" href="tel:+\${l.phone}">📞 Call</a>
  <select data-a="owner"><option value="">Assign…</option>\${TEAM.map((t) => '<option' + (t === l.owner ? ' selected' : '') + '>' + esc(t) + '</option>').join('')}</select>
  <select data-a="stage"><option value="">Move to…</option>\${['replied', 'demo', 'trial', 'customer', 'lost', 'cold'].map((s) => '<option value="' + s + '">' + s + '</option>').join('')}</select>
  \${l.hot ? '<button data-a="done">✓ Handled</button>' : ''}</div>
  <div class="row" style="margin-top:8px"><input class="grow" data-a="note" placeholder="Add a note (e.g. call back Monday, wants 50-student plan)"><button data-a="save">Save note</button></div>
  \${(l.notes || []).length ? '<div class="notes">' + l.notes.slice(-3).map((n) => '• ' + esc(n.text) + ' <span>(' + esc(n.by || '') + ', ' + ago(n.at) + ')</span>').join('\\n') + '</div>' : ''}</div>\`;
}

async function loadList(append = false) {
  if (!append) page = 0;
  const r = await api('/admin/leads/list?view=' + view + '&q=' + encodeURIComponent($('q').value) + '&segment=' + $('seg').value + '&page=' + page);
  $('list').innerHTML = (append ? $('list').innerHTML : '') + (r.leads.length || append ? r.leads.map(card).join('') : '<p class="muted">Nothing here yet.</p>');
  $('more').style.display = r.more ? '' : 'none';
}
$('more').onclick = () => { page++; loadList(true); };
$('tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; for (const x of $('tabs').children) x.setAttribute('aria-pressed', x === b); loadList(); };
let qT; $('q').oninput = () => { clearTimeout(qT); qT = setTimeout(loadList, 300); }; $('seg').onchange = () => loadList();
$('list').addEventListener('change', async (e) => {
  const el = e.target, phone = el.closest('.lead')?.dataset.p, a = el.dataset.a;
  if (!phone || !el.value || !['owner', 'stage'].includes(a)) return;
  await api('/admin/leads/update', { phone, [a]: el.value }); toast('Updated'); loadSummary(); if (a === 'stage') loadList();
});
$('list').addEventListener('click', async (e) => {
  const el = e.target.closest('button'); if (!el) return; const box = el.closest('.lead'); const phone = box?.dataset.p;
  if (el.dataset.a === 'save') { const inp = box.querySelector('[data-a=note]'); if (!inp.value.trim()) return; await api('/admin/leads/update', { phone, note: inp.value.trim(), by: box.querySelector('[data-a=owner]').value }); toast('Note saved'); loadList(); }
  if (el.dataset.a === 'done') { await api('/admin/leads/update', { phone, hot: false }); toast('Marked handled'); loadSummary(); loadList(); }
});

async function fileToCsv(f) {
  if (/\\.(csv|txt)$/i.test(f.name)) return f.text();
  if (!window.XLSX) throw new Error('Excel reader did not load. Save the sheet as CSV and try again.');
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join('\\n');
}
$('importBtn').onclick = async () => {
  try {
    $('importMsg').textContent = 'Importing…';
    let text = $('paste').value.trim();
    if ($('file').files[0]) text = await fileToCsv($('file').files[0]);
    if (!text) return ($('importMsg').textContent = 'Choose a file or paste rows first.');
    const r = await api('/admin/leads/import', { text, defaultType: $('defType').value, tag: $('tag').value });
    $('importMsg').textContent = \`Added \${r.added} · updated \${r.updated} · duplicates \${r.skipped} · not mobile numbers \${r.invalid} · already our users \${r.existing}\` + (Object.keys(r.bySegment).length ? ' · ' + Object.entries(r.bySegment).map(([k, n]) => (SEGS[k]?.label || k) + ': ' + n).join(', ') : '');
    $('paste').value = ''; $('file').value = ''; loadSummary(); loadList();
  } catch (e) { $('importMsg').textContent = 'Import failed: ' + e.message; }
};
$('addBtn').onclick = async () => {
  try { const r = await api('/admin/leads/import', { text: [$('aPhone').value, $('aName').value, $('aOrg').value, $('aSeg').value, $('aCity').value].map((x) => '"' + x.replace(/"/g, '""') + '"').join(','), defaultType: $('aSeg').value, tag: 'manual' });
    toast(r.added ? 'Lead added' : r.invalid ? 'That is not a mobile number' : 'Already in your list'); loadSummary(); loadList(); } catch (e) { toast(e.message); }
};
loadSummary().then(loadList).catch((e) => { $('campBody').textContent = 'Could not load: ' + e.message; });
setInterval(() => { if (!document.hidden) loadSummary(); }, 60000);
</script></body></html>`;
}
