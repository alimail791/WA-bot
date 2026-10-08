// Message shapes used by the flows, independent of the WhatsApp provider:
//   { type:'text', text }
//   { type:'buttons', text, buttons:[{id,title}], footer? }          max 3 buttons, title ≤ 20 chars
//   { type:'list', text, button, sections:[{title, rows:[{id,title,description}]}] }  max 10 rows
//   { type:'link', text, url, label }                                  call-to-action URL button
//   { type:'template', name, lang, params:[...] }                      for messages outside the 24h window
import { config } from '../config.js';
import * as meta from './meta.js';
import * as sim from './sim.js';
import * as aisensy from './aisensy.js';

const providers = { meta, sim };

export function provider() {
  return providers[config.provider] || sim;
}

export async function send(product, phone, msg) {
  // Template messages can go through AiSensy's Campaign API when its key is set
  if (msg.type === 'template' && config.aisensy.apiKey && config.provider !== 'sim') {
    return aisensy.sendTemplate(phone, msg);
  }
  return provider().send(product, phone, clamp(msg));
}

// Enforce WhatsApp limits so a long title never makes Meta reject the whole message.
export function clamp(msg) {
  const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
  const m = structuredClone(msg);
  if (m.text) m.text = cut(m.text, m.type === 'text' ? 4096 : 1024);
  if (m.type === 'buttons') {
    m.buttons = m.buttons.slice(0, 3).map((b) => ({ id: cut(b.id, 256), title: cut(b.title, 20) }));
    if (m.footer) m.footer = cut(m.footer, 60);
  }
  if (m.type === 'list') {
    m.button = cut(m.button || 'Choose', 20);
    let left = 10;
    m.sections = m.sections.map((s) => {
      const rows = s.rows.slice(0, left).map((r) => ({ id: cut(r.id, 200), title: cut(r.title, 24), description: cut(r.description, 72) }));
      left -= rows.length;
      return { title: cut(s.title, 24), rows };
    }).filter((s) => s.rows.length);
  }
  if (m.type === 'link') m.label = cut(m.label || 'Open', 20);
  return m;
}
