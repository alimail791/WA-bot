// VasulBook WhatsApp messages to shop owners, from real activity on www.vasulbook.com:
//   welcome   right after sign-up (checked every 10 minutes, 8 AM–9:30 PM IST)
//   verify    6 h–4 days after sign-up, WhatsApp number or email not confirmed yet (once)
//   refer     7+ days after sign-up and really using it (3+ customers or 5+ entries, active this week);
//             again after 30 and 60 days (at most 3 times)
//   missyou   no activity for 5+ days (again only after a new break, max once in 21 days, stop after 45 idle days)
// One VasulBook message per owner per day. Owners who replied STOP get nothing.
// Inside WhatsApp's 24-hour window: a free message with a button. Outside it: the approved template
// vasulbook_<kind> in the owner's app language (English if that language is not approved yet).
import { config } from './config.js';
import { db } from './store.js';
import { send } from './providers/index.js';
import { within24h } from './engine.js';
import * as vb from './vasulbookBridge.js';
import { KINDS, NAME, LANGS, tr, fill, definition, APP_URL, REFER_URL } from './vasulbookTemplates.js';
import { DAY, HOUR } from './util.js';

const PRODUCT = 'vasulbook';
const SITE = () => (process.env.VASULBOOK_API_URL || 'https://www.vasulbook.com').replace(/\/$/, '');
const REWARD_MONTHS = () => process.env.VASULBOOK_REFER_MONTHS || '5';
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
export const waPhone = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(d) ? '91' + d : null; };
const istDay = (t = Date.now()) => new Date(t + 5.5 * HOUR).toISOString().slice(0, 10);
const istStartOfDay = (t = Date.now()) => new Date(Date.parse(istDay(t) + 'T00:00:00Z') - 5.5 * HOUR);

// ---------- template approval status (from Meta, cached) ----------
let statusCache = { at: 0, map: {} };
export function setStatusMap(map) { statusCache = { at: Date.now(), map }; } // tests
async function templateStatuses(force = false) {
  if (!force && Date.now() - statusCache.at < 30 * 60e3) return statusCache.map;
  if (config.provider !== 'meta' || !config.wa.token || !config.wa.wabaId) return statusCache.map;
  const map = {};
  let url = `${config.wa.apiBase}/${config.wa.wabaId}/message_templates?fields=name,language,status,category,rejected_reason&limit=200`;
  for (let i = 0; url && i < 20; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.wa.token}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`templates ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    for (const t of j.data || []) if (t.name.startsWith('vasulbook_')) map[`${t.name}|${t.language}`] = { status: t.status, category: t.category, reason: t.rejected_reason };
    url = j.paging?.next || null;
  }
  statusCache = { at: Date.now(), map };
  return map;
}
// Approved language to use for this owner (their language, else English), or null
async function approvedLang(kind, lang) {
  const map = await templateStatuses().catch((e) => { console.warn('[vasulbook] template status', e.message); return statusCache.map; });
  for (const l of [lang, 'en']) if (map[`${NAME(kind)}|${l}`]?.status === 'APPROVED') return l;
  return null;
}

// ---------- what to say ----------
export function compose(kind, o) {
  const n = first(o.name);
  const lang = LANGS.includes(o.lang) ? o.lang : 'en';
  const t = tr(lang);
  let params, url = APP_URL, label = t.open;
  if (kind === 'welcome' || kind === 'verify') params = [n, o.shop || 'your business'];
  else if (kind === 'refer') { params = [n, REWARD_MONTHS(), `${SITE()}/?ref=${o.referralCode}`]; url = REFER_URL; label = t.share; }
  else if (kind === 'missyou') params = [n, String(Math.max(5, Math.floor((Date.now() - new Date(o.lastActive || o.createdAt).getTime()) / DAY)))];
  else return null;
  return { lang, params, text: fill(t[kind], params), url, label, yes: t.yes };
}

// Which messages this owner is due today, in priority order
export function dueKind(o, now = Date.now()) {
  if (o.optedOut) return [];
  const age = now - new Date(o.createdAt).getTime();
  const idle = now - new Date(o.lastActive || o.createdAt).getTime();
  const due = [];
  if ((!o.emailVerified || !o.phoneVerified) && age >= 6 * HOUR && age < 4 * DAY) due.push('verify');
  if (o.emailVerified && o.referralCode && age >= 7 * DAY && idle < 7 * DAY && (o.customers >= 3 || o.entries >= 5)
    && Math.floor((age - 7 * DAY) / (30 * DAY)) < 3) due.push('refer');
  if (age >= 5 * DAY && idle >= 5 * DAY && idle < 45 * DAY) due.push('missyou');
  return due;
}
const keyFor = (kind, o, now) => kind === 'missyou' ? `vb-life:${o.id}:missyou:${istDay(new Date(o.lastActive || o.createdAt).getTime())}`
  : kind === 'refer' ? `vb-life:${o.id}:refer:${Math.floor((now - new Date(o.createdAt).getTime() - 7 * DAY) / (30 * DAY))}`
    : `vb-life:${o.id}:${kind}`;

async function deliver(kind, o, phone, now) {
  const u = await db.users.findOne({ product: PRODUCT, phone });
  if (u?.optedOut || o.optedOut) return 'opted-out';
  const m = compose(kind, o);
  let res;
  try {
    if (u && within24h(u)) {
      res = kind === 'verify'
        ? await send(PRODUCT, phone, { type: 'buttons', text: `${m.text}\n\n${APP_URL}`, buttons: [{ id: 'vb:phone-ok', title: m.yes }] })
        : await send(PRODUCT, phone, { type: 'link', text: m.text, url: m.url, label: m.label });
    } else {
      const lang = await approvedLang(kind, m.lang);
      if (!lang) return 'no-template';
      const params = lang === m.lang ? m.params : compose(kind, { ...o, lang }).params;
      res = await send(PRODUCT, phone, { type: 'template', name: NAME(kind), lang, params, ...(kind === 'verify' ? { buttons: ['vb:phone-ok'] } : {}), direct: true });
    }
  } catch (e) { res = { ok: false, status: 'error', body: e.message }; }
  if (res && res.ok === false) { console.warn('[vasulbook] send failed', kind, phone, res.status, String(res.body || '').slice(0, 200)); return 'failed'; }
  await db.events.insertOne({ product: PRODUCT, phone, type: 'lifecycle', kind, at: new Date(now) });
  return 'sent';
}
const messagedToday = async (phone, now) => (await db.events.count({ product: PRODUCT, phone, type: 'lifecycle', at: { $gte: istStartOfDay(now) } })) > 0;

/** Welcome: every 10 minutes during the day; night sign-ups are welcomed next morning. */
export async function welcomeTick(now = Date.now()) {
  if (!vb.enabled()) return { sent: 0 };
  const ist = new Date(now + 5.5 * HOUR), h = ist.getUTCHours() + ist.getUTCMinutes() / 60;
  if (h < 8 || h > 21.5) return { sent: 0, quiet: true };
  let sent = 0;
  for (const o of await vb.newOwners(36)) {
    if (o.optedOut || now - new Date(o.createdAt).getTime() < 5 * 60e3) continue;
    const phone = waPhone(o.phone), key = `vb-life:${o.id}:welcome`;
    if (!phone || await db.kv.findOne({ key })) continue;
    const r = await deliver('welcome', o, phone, now);
    if (r === 'no-template' || r === 'failed') continue; // try again next tick
    await db.kv.insertOne({ key, at: new Date(now), result: r });
    if (r === 'sent') sent++;
  }
  return { sent };
}

/** Verify / refer / miss-you: once a day, at most one per owner. */
export async function lifecycleDaily(now = Date.now()) {
  if (!vb.enabled()) return { sent: 0 };
  let sent = 0;
  const counts = {};
  for (const o of await vb.lifecycleOwners()) {
    const phone = waPhone(o.phone);
    if (!phone) continue;
    for (const kind of dueKind(o, now)) {
      const key = keyFor(kind, o, now);
      if (await db.kv.findOne({ key })) continue;
      if (kind === 'missyou' && await db.events.count({ product: PRODUCT, phone, type: 'lifecycle', kind: 'missyou', at: { $gte: new Date(now - 21 * DAY) } })) continue;
      if (await messagedToday(phone, now)) break;
      const r = await deliver(kind, o, phone, now);
      if (r === 'no-template' || r === 'failed') continue;
      await db.kv.insertOne({ key, at: new Date(now), result: r });
      if (r === 'sent') { sent++; counts[kind] = (counts[kind] || 0) + 1; }
      break;
    }
  }
  return { sent, counts };
}

/** How many owners each message is due for today (nothing is sent). */
export async function previewLifecycle(now = Date.now()) {
  if (!vb.enabled()) return null;
  const list = await vb.lifecycleOwners();
  const due = {};
  for (const o of list) for (const k of dueKind(o, now)) due[k] = (due[k] || 0) + 1;
  return { owners: list.length, withWhatsApp: list.filter((o) => waPhone(o.phone)).length, due, newLast36h: (await vb.newOwners(36)).length };
}

// ---------- replies from owners on the shared number ----------
const OTHER = /\b(Y\s?NEET|NEET|TEST\s?MANDI|CLASS\s?COACH|TEACHER|TUTOR)\b|^(JOIN|TEST|BUY)\s/;
/** Returns true when the message was a VasulBook one and has been answered. */
export async function intercept(ev) {
  if (!vb.enabled()) return false;
  const upper = String(ev.text || '').trim().toUpperCase();
  const phone = ev.from;
  let mine = String(ev.replyId || '').startsWith('vb:') || /VASUL\s?BOOK/.test(upper);
  if (!mine && !OTHER.test(upper)) {
    mine = (await db.events.count({ product: PRODUCT, phone, type: 'lifecycle', at: { $gte: new Date(Date.now() - 3 * DAY) } })) > 0;
  }
  if (!mine) return false;
  const now = new Date();
  await db.users.updateOne({ product: PRODUCT, phone }, { $set: { lastInboundAt: now, ...(ev.name ? { name: ev.name } : {}) }, $setOnInsert: { createdAt: now, credits: {}, optedOut: false } }, { upsert: true });
  let owner = null;
  try { owner = await vb.owner(phone); } catch (e) { console.warn('[vasulbook] owner lookup', e.message); }
  const t = tr(owner?.lang);
  try {
    if (ev.replyId === 'vb:phone-ok' || upper === tr(owner?.lang).yes.toUpperCase()) {
      const rows = await vb.phoneVerified(phone);
      await send(PRODUCT, phone, { type: 'link', text: t.thanks.replace('{shop}', rows[0]?.shop || owner?.shop || 'VasulBook'), url: APP_URL, label: t.open });
    } else if (upper === 'STOP' || upper === 'UNSUBSCRIBE') {
      await db.users.updateOne({ product: PRODUCT, phone }, { $set: { optedOut: true } });
      await vb.optOut(phone, true).catch((e) => console.warn('[vasulbook] opt-out', e.message));
      await send(PRODUCT, phone, { type: 'text', text: t.stopped });
    } else if (upper === 'START') {
      await db.users.updateOne({ product: PRODUCT, phone }, { $set: { optedOut: false } });
      await vb.optOut(phone, false).catch((e) => console.warn('[vasulbook] opt-in', e.message));
      await send(PRODUCT, phone, { type: 'text', text: t.started });
    } else {
      await send(PRODUCT, phone, { type: 'link', text: t.help, url: APP_URL, label: t.open });
    }
  } catch (e) { console.error('[vasulbook] reply', e.message); }
  await db.events.insertOne({ product: PRODUCT, phone, type: 'inbound', data: { text: String(ev.text || '').slice(0, 200), replyId: ev.replyId || '' }, at: now });
  return true;
}

// ---------- templates: submit to Meta and show their status ----------
export async function submitTemplates() {
  if (config.provider !== 'meta' || !config.wa.token || !config.wa.wabaId) throw new Error('WhatsApp (WA_TOKEN, WA_WABA_ID) is not set up');
  const have = await templateStatuses(true).catch(() => ({}));
  const out = [];
  for (const kind of KINDS) {
    for (const lang of LANGS) {
      const k = `${NAME(kind)}|${lang}`;
      if (have[k] && have[k].status !== 'REJECTED') { out.push({ name: NAME(kind), lang, result: have[k].status }); continue; }
      const res = await fetch(`${config.wa.apiBase}/${config.wa.wabaId}/message_templates`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.wa.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(definition(kind, lang)), signal: AbortSignal.timeout(20000),
      });
      const j = await res.json().catch(() => ({}));
      out.push({ name: NAME(kind), lang, result: res.ok ? (j.status || 'PENDING') : `error: ${j.error?.error_user_msg || j.error?.message || res.status}` });
    }
  }
  statusCache.at = 0;
  return out;
}
export async function statusTable() {
  const map = await templateStatuses(true).catch((e) => ({ _error: e.message }));
  return { map, kinds: KINDS, langs: LANGS };
}
