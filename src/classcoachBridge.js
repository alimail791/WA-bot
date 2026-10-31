// Optional link to classcoach.in. When CLASSCOACH_API_URL and CLASSCOACH_BOT_KEY are set:
//   • a tutor whose WhatsApp number matches their classcoach.in account gets their real plan and limits here
//   • a plan bought on WhatsApp is applied to their classcoach.in account (and classcoach.in's referral rule runs)
let impl = null; // tests can swap in a fake
const cache = new Map();

export function enabled() { return !!(impl || (process.env.CLASSCOACH_API_URL && process.env.CLASSCOACH_BOT_KEY)); }
export function setImpl(fake) { impl = fake; cache.clear(); }

async function call(path, opts = {}) {
  const base = process.env.CLASSCOACH_API_URL.replace(/\/$/, '');
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'x-internal-key': process.env.CLASSCOACH_BOT_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`classcoach.in ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function lookup(phone) {
  if (impl) return impl.lookup(phone);
  if (!enabled()) return null;
  const hit = cache.get(phone);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.value;
  const r = await call(`/internal/wa/teacher?phone=${encodeURIComponent(phone)}`);
  const value = r?.found ? r.teacher : null;
  cache.set(phone, { at: Date.now(), value });
  return value;
}

export async function applyPlan({ phone, planId, paymentId, amount }) {
  if (impl) return impl.applyPlan({ phone, planId, paymentId, amount });
  if (!enabled()) return null;
  cache.delete(phone);
  const r = await call('/internal/wa/apply-plan', { method: 'POST', body: JSON.stringify({ phone, planId, paymentId, amount }) });
  return r?.ok ? r.teacher : null;
}

export async function check() {
  if (impl || !enabled()) return null;
  const res = await fetch(process.env.CLASSCOACH_API_URL.replace(/\/$/, '') + '/internal/wa/teacher?phone=0000000000', {
    headers: { 'x-internal-key': process.env.CLASSCOACH_BOT_KEY }, signal: AbortSignal.timeout(8000),
  });
  const host = (() => { try { return new URL(process.env.CLASSCOACH_API_URL).host; } catch { return 'invalid URL'; } })();
  if (res.status === 401) return `wrong CLASSCOACH_BOT_KEY (classcoach.in at ${host} refused it)`;
  if (res.status !== 404) return `unexpected ${res.status} from ${host}`;
  // classcoach.in answers an unknown phone with JSON {found:false}; any other "not found" page means the URL is wrong.
  const body = await res.json().catch(() => null);
  return body && body.found === false ? `ok (${host})` : `CLASSCOACH_API_URL looks wrong: ${host} is not classcoach.in`;
}

// ---- WhatsApp journey (see classcoachJourney.js) ----
// Teachers the journey may message, with what it needs to pick a stage.
export async function journeyCandidates() {
  if (impl) return impl.journeyCandidates ? impl.journeyCandidates() : [];
  if (!enabled()) return [];
  const r = await call('/internal/wa/journey');
  return r?.teachers || [];
}

// Mark the account with this phone as WhatsApp-verified. Returns { ok, alreadyVerified, emailVerified, name } or null.
export async function verifyPhone(phone) {
  if (impl) return impl.verifyPhone ? impl.verifyPhone(phone) : null;
  if (!enabled()) return null;
  cache.delete(phone);
  return call('/internal/wa/verify-phone', { method: 'POST', body: JSON.stringify({ phone }) });
}
