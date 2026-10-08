// Magic links: one-time, short-lived links that open a test already logged in with the WhatsApp number.
import { db } from './store.js';
import { config } from './config.js';
import { token as newToken } from './util.js';

/**
 * kind: 'mock' | 'test' | 'class'
 * ref:  test code, class quiz id, etc.
 * qids: question ids for this attempt
 */
export async function createMagicLink({ product, phone, kind, ref, title, qids, durationMin = 60, ttlMin = 30, meta = {} }) {
  const t = newToken();
  await db.tokens.insertOne({
    token: t, product, phone, kind, ref, title, qids, durationMin, meta,
    createdAt: new Date(), expiresAt: new Date(Date.now() + ttlMin * 60e3), openedAt: null, usedAt: null,
  });
  return `${config.baseUrl}/t/${t}`;
}

// Opening marks the link as used by this device; it can be reopened for the test duration (e.g. page refresh)
export async function openMagicLink(t) {
  const row = await db.tokens.findOne({ token: t });
  if (!row) return { error: 'This link is not valid. Ask for a new one in WhatsApp.' };
  if (row.usedAt) return { error: 'This test was already submitted. Send MENU in WhatsApp for your next test.', row };
  const now = Date.now();
  if (!row.openedAt && new Date(row.expiresAt).getTime() < now) return { error: 'This link has expired. Ask for a new one in WhatsApp.' };
  if (row.openedAt && now - new Date(row.openedAt).getTime() > (row.durationMin + 30) * 60e3) return { error: 'This test session has ended. Ask for a new link in WhatsApp.' };
  if (!row.openedAt) await db.tokens.updateOne({ token: t }, { $set: { openedAt: new Date() } });
  return { row: { ...row, openedAt: row.openedAt || new Date() } };
}

export async function consumeMagicLink(t) {
  return db.tokens.updateOne({ token: t, usedAt: null }, { $set: { usedAt: new Date() } });
}
