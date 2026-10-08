// AiSensy Campaign API: sends approved template messages only (no replies, buttons or incoming messages).
// Used for the template messages (reminders, parent reports, seller alerts) when AISENSY_API_KEY is set.
// In AiSensy, create one "API campaign" per template and put the campaign NAME in the TEMPLATE_* variables.
import { config } from '../config.js';

export async function sendTemplate(phone, m) {
  const res = await fetch(config.aisensy.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: config.aisensy.apiKey,
      campaignName: m.name,
      destination: String(phone),
      userName: m.userName || config.wa.businessName,
      templateParams: (m.params || []).map(String),
      source: 'wa-bot',
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[aisensy] campaign "${m.name}" to ${phone} failed ${res.status}: ${body.slice(0, 300)}`);
    return { ok: false, status: res.status, body };
  }
  return { ok: true, body };
}
