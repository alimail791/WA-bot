// Shared building blocks for the product flows.
import { db } from '../store.js';
import { config } from '../config.js';
import { pickQuestions, getQuestions } from '../questions.js';
import { istDate, fmtNum } from '../util.js';
import { rupees } from '../products.js';

// ---- In-chat quiz --------------------------------------------------------
// Session keeps { quiz: { qids, i, score, wrong:[], tag } }. Answer button ids: "ans:<i>:<option>"
export async function startChatQuiz(ctx, { n, subject, topic, tag, qids }) {
  if (!qids) {
    const seen = ctx.user.seenQ || [];
    const qs = await pickQuestions(ctx.product, n, { subject, topic, exclude: seen });
    qids = qs.map((q) => q._id);
  }
  if (!qids.length) {
    await ctx.say('No questions are loaded yet for this. Please try again later.');
    return false;
  }
  await ctx.setSession({ state: 'quiz', quiz: { qids, i: 0, score: 0, wrong: [], tag } });
  await askQuestion(ctx);
  return true;
}

export async function askQuestion(ctx) {
  const quiz = ctx.session.data.quiz;
  const [q] = await getQuestions([quiz.qids[quiz.i]]);
  const head = `Q${quiz.i + 1}/${quiz.qids.length}${q.topic ? ' · ' + q.topic : ''}`;
  const letters = ['A', 'B', 'C', 'D'];
  const longOpts = q.options.some((o) => o.length > 20) || q.options.length > 3;
  if (longOpts) {
    // Options too long for buttons: show them in the text, answer with a list
    const body = `${head}\n${q.question}\n\n${q.options.map((o, i) => `${letters[i]}) ${o}`).join('\n')}`;
    await ctx.list(body, 'Choose answer', [{ title: 'Your answer', rows: q.options.map((o, i) => ({ id: `ans:${quiz.i}:${i}`, title: `${letters[i]}) ${o}`, description: o.length > 22 ? o : undefined })) }]);
  } else {
    await ctx.buttons(`${head}\n${q.question}`, q.options.map((o, i) => [`ans:${quiz.i}:${i}`, o]));
  }
}

// Returns null while the quiz continues, or the final result when it ends
export async function answerQuestion(ctx, replyId) {
  const quiz = ctx.session.data.quiz;
  const [, iStr, optStr] = replyId.split(':');
  if (Number(iStr) !== quiz.i) return null; // stale button from an earlier question
  const [q] = await getQuestions([quiz.qids[quiz.i]]);
  const right = Number(optStr) === q.answer;
  const note = q.explanation ? `\n💡 ${q.explanation}` : '';
  if (right) { quiz.score++; await ctx.say('✅ Correct!' + note); }
  else { quiz.wrong.push(q.topic || q.subject); await ctx.say(`❌ Correct answer: ${q.options[q.answer]}${note}`); }
  quiz.i++;
  await ctx.setUser({ seenQ: [...(ctx.user.seenQ || []), q._id].slice(-500) });
  if (quiz.i < quiz.qids.length) {
    await ctx.setSession({ quiz });
    await askQuestion(ctx);
    return null;
  }
  await ctx.setSession({ quiz: null, state: 'idle' });
  return quiz;
}

// ---- Streak -------------------------------------------------------------
export async function bumpStreak(ctx) {
  const today = istDate();
  const yesterday = istDate(new Date(Date.now() - 86400e3));
  const s = ctx.user.streak || { count: 0, last: null };
  if (s.last === today) return { ...s, rewarded: false };
  const count = s.last === yesterday ? s.count + 1 : 1;
  await ctx.setUser({ streak: { count, last: today } });
  return { count, last: today };
}

// ---- Social proof (real numbers only, shown when they are big enough to help) ----
export async function todayCount(product, type, min = 20) {
  const start = new Date(new Date(istDate() + 'T00:00:00+05:30'));
  const n = await db.events.count({ product, type, at: { $gte: start } });
  return n >= min ? fmtNum(n) : null;
}

// ---- Offer footer for a real deadline -----------------------------------
export function offerFooter() {
  if (!config.offerEndsOn) return undefined;
  const end = new Date(config.offerEndsOn + 'T23:59:59+05:30');
  if (end < new Date()) return undefined;
  return `Offer price till ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}`;
}

export function priceLine(o) {
  return o.anchor ? `${rupees(o.price)} (was ${rupees(o.anchor)})` : rupees(o.price);
}

export async function pendingOrder(ctx) {
  return db.orders.findOne({ product: ctx.product, phone: ctx.phone, status: 'created', createdAt: { $gte: new Date(Date.now() - 24 * 3600e3) } });
}
