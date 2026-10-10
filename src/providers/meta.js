// WhatsApp Cloud API format. Works with Meta directly, and with BSPs that expose the same
// API (AiSensy Direct API, 360dialog, Gupshup partner API): set WA_API_BASE and WA_TOKEN.
import { config } from '../config.js';

function phoneIdFor(product) {
  return config.wa.numbers[product] || config.wa.sharedNumberId;
}

export function toMeta(phone, m) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone };
  switch (m.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: m.text, preview_url: true } };
    case 'buttons':
      return {
        ...base, type: 'interactive',
        interactive: {
          type: 'button', body: { text: m.text },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: { buttons: m.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      };
    case 'list':
      return {
        ...base, type: 'interactive',
        interactive: { type: 'list', body: { text: m.text }, action: { button: m.button, sections: m.sections } },
      };
    case 'link':
      return {
        ...base, type: 'interactive',
        interactive: { type: 'cta_url', body: { text: m.text }, action: { name: 'cta_url', parameters: { display_text: m.label, url: m.url } } },
      };
    case 'template':
      return {
        ...base, type: 'template',
        template: {
          name: m.name, language: { code: m.lang || 'en' },
          components: [
            ...(m.params?.length ? [{ type: 'body', parameters: m.params.map((t) => ({ type: 'text', text: String(t) })) }] : []),
            // Quick-reply buttons: send our own payload so taps come back as e.g. "lead:demo"
            ...(m.buttons || []).map((payload, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })),
          ],
        },
      };
    default:
      throw new Error('Unknown message type ' + m.type);
  }
}

export async function send(product, phone, m) {
  const id = phoneIdFor(product);
  if (!id || !config.wa.token) throw new Error(`WhatsApp number not configured for ${product}`);
  const res = await fetch(`${config.wa.apiBase}/${id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.wa.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(toMeta(phone, m)),
  });
  if (!res.ok) {
    const body = await res.text();
    if (m.direct) return { ok: false, status: res.status, body };
    console.error(`[wa] send failed ${res.status} to ${phone}: ${body.slice(0, 300)}`);
    return { ok: false, status: res.status, body };
  }
  return { ok: true, ...(await res.json()) };
}

// Delivery receipts, app echoes (messages typed in the WhatsApp Business app) and quality updates
export function parseExtras(body) {
  const out = { statuses: [], echoes: [], quality: [] };
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const s of v.statuses || []) out.statuses.push({ id: s.id, status: s.status, recipient: s.recipient_id, errors: s.errors || [] });
      for (const e of v.message_echoes || []) out.echoes.push({ to: e.to, type: e.type });
      if (change.field === 'phone_number_quality_update') out.quality.push(v);
    }
  }
  return out;
}

// Turn a webhook payload into simple inbound events: { phoneNumberId, from, name, text, replyId }
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of v.messages || []) {
        const ev = { phoneNumberId: v.metadata?.phone_number_id, from: msg.from, name: names[msg.from] || '', id: msg.id };
        if (msg.type === 'text') ev.text = msg.text.body;
        else if (msg.type === 'interactive') {
          const r = msg.interactive.button_reply || msg.interactive.list_reply;
          ev.replyId = r?.id; ev.text = r?.title;
        } else if (msg.type === 'button') { ev.text = msg.button.text; ev.replyId = msg.button.payload; }
        else ev.text = '';
        out.push(ev);
      }
    }
  }
  return out;
}
