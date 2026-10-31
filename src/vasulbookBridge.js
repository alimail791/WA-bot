// Link to www.vasulbook.com (the udhaar / dues app). When VASULBOOK_API_URL and VASULBOOK_BOT_KEY are set,
// the bot can welcome new VasulBook owners, ask them to confirm their WhatsApp number and email,
// invite them to refer & earn, and say "we miss you" after 5 idle days (src/vasulbookLifecycle.js).
let impl = null; // tests can swap in a fake

export function enabled() { return !!(impl || (process.env.VASULBOOK_BOT_KEY)); }
export function setImpl(fake) { impl = fake; }

async function call(path, opts = {}) {
  const base = (process.env.VASULBOOK_API_URL || 'https://www.vasulbook.com').replace(/\/$/, '');
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'x-bot-key': process.env.VASULBOOK_BOT_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`vasulbook.com ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function check() {
  if (impl) return impl.check ? impl.check() : { ok: true };
  if (!enabled()) return null;
  return call('/api/bot/check');
}
export async function newOwners(hours = 36) {
  if (impl) return impl.newOwners(hours);
  if (!enabled()) return [];
  return (await call(`/api/bot/new-owners?hours=${hours}`)).owners;
}
export async function lifecycleOwners() {
  if (impl) return impl.lifecycleOwners();
  if (!enabled()) return [];
  return (await call('/api/bot/lifecycle-owners')).owners;
}
export async function owner(phone) {
  if (impl) return impl.owner ? impl.owner(phone) : null;
  if (!enabled()) return null;
  return (await call(`/api/bot/owner?phone=${encodeURIComponent(phone)}`)).owner;
}
export async function phoneVerified(phone) {
  if (impl) return impl.phoneVerified ? impl.phoneVerified(phone) : [];
  if (!enabled()) return [];
  return (await call('/api/bot/phone-verified', { method: 'POST', body: JSON.stringify({ phone }) })).owners;
}
export async function optOut(phone, out = true) {
  if (impl) return impl.optOut ? impl.optOut(phone, out) : [];
  if (!enabled()) return [];
  return (await call('/api/bot/opt-out', { method: 'POST', body: JSON.stringify({ phone, out }) })).owners;
}
