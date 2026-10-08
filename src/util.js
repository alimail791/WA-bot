import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

// Dates in India time, as YYYY-MM-DD
export function istDate(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
}
export function istYesterday(d = new Date()) {
  return istDate(new Date(d.getTime() - 86400e3));
}

export const DAY = 86400e3;
export const HOUR = 3600e3;

// Readable random codes without look-alike characters
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function code(n = 6) {
  const b = randomBytes(n);
  return [...b].map((x) => ALPHA[x % ALPHA.length]).join('');
}
export function token() {
  return randomBytes(18).toString('base64url');
}
export function refCodeFor(product, phone) {
  const h = createHash('sha256').update(product + ':' + phone).digest();
  return [...h.subarray(0, 6)].map((x) => ALPHA[x % ALPHA.length]).join('');
}

export function maskPhone(p = '') {
  const s = String(p);
  return s.length > 6 ? `+${s.slice(0, 2)} ${s.slice(2, 4)}•••••${s.slice(-3)}` : s;
}

export function hmac(data, key = config.secret) {
  return createHmac('sha256', key).update(data).digest('hex');
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Signed short-lived value for handing a verified phone to a product web app
export function sign(payload, ttlMs = 30 * 60e3) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  return body + '.' + hmac(body);
}
export function verify(signed) {
  const [body, sig] = String(signed || '').split('.');
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}

export function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function waLink(displayNumber, text) {
  if (!displayNumber) return '';
  return `https://wa.me/${displayNumber}?text=${encodeURIComponent(text)}`;
}

// Score out of a mock -> rough NEET rank range. Shown to users clearly labelled as an estimate.
const RANK_BANDS = [[700, 100], [680, 1000], [650, 5000], [620, 15000], [600, 25000], [550, 60000], [500, 100000], [450, 160000], [400, 230000], [350, 330000], [300, 450000], [250, 600000], [200, 800000], [0, 1500000]];
export function estimateNeetRank(scoreOf720) {
  for (let i = 0; i < RANK_BANDS.length; i++) {
    const [s, r] = RANK_BANDS[i];
    if (scoreOf720 >= s) {
      const lo = i === 0 ? 1 : Math.round(r * 0.8), hi = Math.round(r * 1.25);
      return [lo, hi];
    }
  }
  return [1000000, 2000000];
}
export const fmtNum = (n) => Number(n).toLocaleString('en-IN');
