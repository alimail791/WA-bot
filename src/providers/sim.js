// Simulator provider: keeps outgoing messages in memory so the browser simulator and tests can read them.
const outbox = new Map(); // key product:phone -> [messages]
const listeners = new Set();

export async function send(product, phone, m) {
  const key = `${product}:${phone}`;
  const list = outbox.get(key) || [];
  const msg = { ...m, at: Date.now(), seq: list.length };
  list.push(msg);
  outbox.set(key, list);
  for (const fn of listeners) fn(product, phone, msg);
  return { ok: true };
}

export function messages(product, phone, since = 0) {
  return (outbox.get(`${product}:${phone}`) || []).slice(since);
}

export function clear(product, phone) {
  if (product && phone) outbox.delete(`${product}:${phone}`);
  else outbox.clear();
}

export function onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); }
