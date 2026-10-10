// Core: turns one inbound WhatsApp message into a flow call with a context of helpers.
import { db } from './store.js';
import { send } from './providers/index.js';
import { products } from './products.js';
import { flows } from './flows/index.js';
import { HOUR } from './util.js';

export function within24h(user) {
  return user?.lastInboundAt && Date.now() - new Date(user.lastInboundAt).getTime() < 23.5 * HOUR;
}

export async function getUser(product, phone) {
  return db.users.findOne({ product, phone });
}

export async function track(product, phone, type, data = {}) {
  await db.events.insertOne({ product, phone, type, data, at: new Date() });
}

// Helpers handed to every flow function
export function makeCtx(product, user, session) {
  const ctx = {
    product, phone: user.phone, user, session, cfg: products[product],
    say: (text) => send(product, user.phone, { type: 'text', text }),
    buttons: (text, btns, footer) => send(product, user.phone, { type: 'buttons', text, footer, buttons: btns.map(([id, title]) => ({ id, title })) }),
    list: (text, button, sections) => send(product, user.phone, { type: 'list', text, button, sections }),
    link: (text, url, label) => send(product, user.phone, { type: 'link', text, url, label }),
    async setUser(patch, extra = {}) {
      ctx.user = await db.users.updateOne({ product, phone: user.phone }, { $set: patch, ...extra });
      return ctx.user;
    },
    async setSession(patch) {
      const $set = Object.fromEntries(Object.entries(patch).map(([k, v]) => ['data.' + k, v]));
      ctx.session = await db.sessions.updateOne({ product, phone: user.phone }, { $set: { ...$set, updatedAt: new Date() } }, { upsert: true });
      return ctx.session;
    },
    go: (state) => ctx.setSession({ state }),
    track: (type, data) => track(product, user.phone, type, data),
  };
  return ctx;
}

export async function contextFor(product, phone) {
  const user = await getUser(product, phone);
  if (!user) return null;
  const session = (await db.sessions.findOne({ product, phone })) || { data: {} };
  return makeCtx(product, user, session);
}

// Entry point for every inbound message
export async function handleInbound({ product, phone, name = '', text = '', replyId = '' }) {
  const now = new Date();
  const isNew = !(await getUser(product, phone));
  const user = await db.users.updateOne(
    { product, phone },
    { $set: { lastInboundAt: now, ...(name ? { name } : {}) }, $setOnInsert: { createdAt: now, credits: {}, optedOut: false } },
    { upsert: true },
  );
  const session = (await db.sessions.findOne({ product, phone })) || { data: {} };
  const ctx = makeCtx(product, user, session);
  ctx.isNew = isNew;
  // A button/list tap also carries its title as text; only typed text is read as a command
  const typed = replyId ? '' : String(text || '').trim();
  const input = { text: typed, replyId: replyId || '', upper: typed.toUpperCase() };

  if (input.upper === 'STOP' || input.upper === 'UNSUBSCRIBE') {
    await ctx.setUser({ optedOut: true });
    return ctx.say('You won\'t get reminders from us any more. Send START anytime to turn them back on.');
  }
  if (input.upper === 'START' && user.optedOut) {
    await ctx.setUser({ optedOut: false });
  }

  await ctx.track('in', { text: input.text.slice(0, 200), replyId: input.replyId });
  try { await (await import('./leads.js')).onInbound(phone, product); } catch (e) { console.error('[leads] inbound', e.message); }
  try {
    await flows[product].handle(ctx, input);
  } catch (err) {
    if (err.code === 'NO_PAYMENTS') {
      return ctx.say('Thanks for your interest! 🙏 Online payment is being set up right now. Reply here with "PAY" and our team will send you the payment details personally.');
    }
    console.error(`[${product}] flow error for ${phone}:`, err);
    await ctx.say('Sorry, something went wrong on our side. Send MENU to start again.');
  }
}

// Called by payments.js when an order is paid
export async function dispatchPaid(order) {
  const ctx = await contextFor(order.product, order.phone);
  if (ctx) await flows[order.product].onPaid(ctx, order);
  try { await (await import('./leads.js')).onPaid(order); } catch (e) { console.error('[leads] paid', e.message); }
}

// Called when a web test is submitted
export async function dispatchAttempt(attempt) {
  const ctx = await contextFor(attempt.product, attempt.phone);
  if (ctx) await flows[attempt.product].onAttempt(ctx, attempt);
}
