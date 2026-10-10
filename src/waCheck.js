// Connection check for the WhatsApp number: asks Meta directly why messages might not be reaching the bot,
// and can re-connect the bot to the WhatsApp account. Open /admin/whatsapp?key=ADMIN_KEY
import { config } from './config.js';
import { db } from './store.js';
import { esc } from './util.js';

async function graph(path, opts = {}) {
  try {
    const res = await fetch(`${config.wa.apiBase}/${path}`, { ...opts, headers: { Authorization: `Bearer ${config.wa.token}`, ...(opts.headers || {}) }, signal: AbortSignal.timeout(10000) });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: body } : { ok: false, error: body.error || { message: `HTTP ${res.status}` } };
  } catch (e) { return { ok: false, error: { message: e.message } }; }
}

let lastHit = 0;
export async function noteWebhook() {
  if (Date.now() - lastHit < 30e3) return;
  lastHit = Date.now();
  await db.kv.updateOne({ key: 'lastWebhook' }, { $set: { value: { at: new Date() } } }, { upsert: true });
}

export async function check({ fix = false } = {}) {
  const out = { checks: [], fixed: '' };
  const add = (ok, title, detail) => out.checks.push({ ok, title, detail });
  if (fix) {
    const r = await graph(`${config.wa.wabaId}/subscribed_apps`, { method: 'POST' });
    out.fixed = r.ok ? 'Reconnected: your WhatsApp account will now send messages to the bot again.' : `Reconnect failed: ${r.error.message}`;
  }
  const phone = await graph(`${config.wa.sharedNumberId}?fields=display_phone_number,verified_name,status,quality_rating,messaging_limit_tier,platform_type,is_on_biz_app,code_verification_status,name_status,webhook_configuration`);
  if (!phone.ok) {
    const e = phone.error;
    const expired = e.code === 190 || /expired|session|access token/i.test(e.message || '');
    add(false, expired ? 'WhatsApp access token stopped working' : 'Could not read your WhatsApp number from Meta',
      expired ? 'The WA_TOKEN in Railway has expired or was revoked. Create a permanent token: Meta Business Settings → Users → System users → your system user → Generate new token (no expiry, permissions whatsapp_business_messaging and whatsapp_business_management), then paste it into WA_TOKEN in Railway.' : `${e.message || ''} (code ${e.code || '?'})`);
  } else {
    const p = phone.data;
    add(true, 'Access token works', `Number ${p.display_phone_number || ''} · ${p.verified_name || ''}`);
    const connected = !p.status || /CONNECTED/i.test(p.status) && !/DIS/i.test(p.status);
    add(connected, connected ? `Number status: ${p.status || 'OK'}` : `Number status: ${p.status}`,
      connected ? '' : 'The number is not connected to the WhatsApp Cloud API. If you reinstalled or logged in to the WhatsApp Business app on another phone, the link (coexistence) can break. Open WhatsApp Manager → Phone numbers to see what Meta says, and re-link the number to the app if asked.');
    if (p.is_on_biz_app !== undefined) add(true, p.is_on_biz_app ? 'WhatsApp Business app linked (coexistence on)' : 'Not linked to the WhatsApp Business app', '');
    if (p.quality_rating) add(!/RED|LOW/i.test(p.quality_rating), `Quality: ${p.quality_rating}`, /RED|LOW/i.test(p.quality_rating) ? 'Too many people blocked or reported your messages. Pause campaigns for a few days.' : '');
    if (p.messaging_limit_tier) add(true, `Messaging limit: ${p.messaging_limit_tier.replace('TIER_', '')} new people per day`, '');
    const wh = p.webhook_configuration || {};
    const url = wh.phone_number || wh.whatsapp_business_account || wh.application || '';
    const ours = `${config.baseUrl}/webhooks/whatsapp`;
    if (url) add(url.startsWith(config.baseUrl), url.startsWith(config.baseUrl) ? 'Messages are sent to this bot' : 'Messages are sent somewhere else', url.startsWith(config.baseUrl) ? url : `Meta is sending your messages to ${url}, not to ${ours}. Fix the Callback URL in your Meta app → WhatsApp → Configuration, or ask your previous provider (e.g. AiSensy) to release the number.`);
  }
  const subs = await graph(`${config.wa.wabaId}/subscribed_apps`);
  if (subs.ok) {
    const apps = subs.data.data || [];
    add(apps.length > 0, apps.length ? `Bot app connected to your WhatsApp account (${apps.map((a) => a.whatsapp_business_api_data?.name || a.name || a.id).join(', ')})` : 'Bot app is NOT connected to your WhatsApp account',
      apps.length ? '' : 'This is why the bot gets no messages. Tap "Reconnect" below.');
  } else add(false, 'Could not check which apps receive your messages', `${subs.error.message || ''} (WABA ${config.wa.wabaId})`);
  const lw = await db.kv.findOne({ key: 'lastWebhook' });
  out.lastWebhookAt = lw?.value?.at || null;
  return out;
}

export function page(r, key) {
  const when = r.lastWebhookAt ? new Date(r.lastWebhookAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'not since this check was added';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp check</title>
<style>:root{--bg:#f5f6fa;--card:#fff;--ink:#1d2030;--muted:#646a80;--ok:#1f6f5c;--bad:#b42318;--line:#e3e5ee}@media (prefers-color-scheme:dark){:root{--bg:#12141b;--card:#1b1e28;--ink:#e9ebf2;--muted:#9aa0b4;--ok:#4cc3a1;--bad:#f87171;--line:#2c3040}}
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--ink)}main{max-width:720px;margin:0 auto;padding:16px}.c{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-top:10px}
.t{font-weight:600}.ok .t:before{content:"✅ "}.bad .t:before{content:"❌ "}.bad{border-color:var(--bad)}.d{color:var(--muted);font-size:14px;margin-top:4px}.fix{background:#e8f4f0;color:var(--ok);padding:12px;border-radius:12px;margin-top:10px}
a.b{display:inline-block;margin-top:14px;background:var(--ok);color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none}</style></head><body><main>
<h1 style="font-size:20px">WhatsApp connection check</h1><div class="d">Last message received from WhatsApp: <b>${esc(when)}</b></div>
${r.fixed ? `<div class="fix">${esc(r.fixed)}</div>` : ''}
${r.checks.map((c) => `<div class="c ${c.ok ? 'ok' : 'bad'}"><div class="t">${esc(c.title)}</div>${c.detail ? `<div class="d">${esc(c.detail)}</div>` : ''}</div>`).join('')}
<a class="b" href="/admin/whatsapp?key=${encodeURIComponent(key)}&fix=1">🔄 Reconnect bot to WhatsApp</a>
<p class="d">After reconnecting, send "Hi" from another mobile and refresh this page: "Last message received" should update.</p></main></body></html>`;
}
