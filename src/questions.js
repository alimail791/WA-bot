// Question bank: picking, grading and CSV import.
import { db } from './store.js';
import { shuffle } from './util.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// Pick n questions for a product, avoiding ones this user has already seen when possible
export async function pickQuestions(product, n, { subject, topic, exclude = [] } = {}) {
  const filter = { product };
  if (subject) filter.subject = subject;
  let pool = await db.questions.find(filter);
  if (topic) {
    const t = topic.toLowerCase();
    const narrowed = pool.filter((q) => (q.topic || '').toLowerCase().includes(t) || q.question.toLowerCase().includes(t));
    if (narrowed.length >= Math.min(n, 3)) pool = narrowed;
  }
  const fresh = pool.filter((q) => !exclude.includes(q._id));
  const chosen = shuffle(fresh.length >= n ? fresh : pool).slice(0, n);
  return chosen;
}

export async function getQuestions(ids) {
  const rows = await db.questions.find({ _id: { $in: ids } });
  const byId = new Map(rows.map((q) => [q._id, q]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// answers: { [questionId]: optionIndex }
export function grade(questions, answers) {
  let correct = 0;
  const bySubject = {}, wrongTopics = {};
  for (const q of questions) {
    const s = (bySubject[q.subject] ??= { total: 0, correct: 0 });
    s.total++;
    if (Number(answers[q._id]) === q.answer) { correct++; s.correct++; }
    else wrongTopics[q.topic || q.subject] = (wrongTopics[q.topic || q.subject] || 0) + 1;
  }
  const weak = Object.entries(wrongTopics).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { correct, total: questions.length, bySubject, weak };
}

// ---- CSV import ---------------------------------------------------------
// Accepts common header names. Answer may be a letter (A-D), a number (1-4) or the option text.
const ALIASES = {
  subject: ['subject', 'sub'],
  topic: ['topic', 'chapter', 'unit'],
  question: ['question', 'question_text', 'q', 'questiontext'],
  a: ['option_a', 'a', 'opt_a', 'option1', 'optiona', 'op1'],
  b: ['option_b', 'b', 'opt_b', 'option2', 'optionb', 'op2'],
  c: ['option_c', 'c', 'opt_c', 'option3', 'optionc', 'op3'],
  d: ['option_d', 'd', 'opt_d', 'option4', 'optiond', 'op4'],
  answer: ['answer', 'correct', 'correct_answer', 'correct_option', 'ans', 'key'],
  explanation: ['explanation', 'solution', 'explain'],
  level: ['level', 'difficulty'],
  tags: ['tags', 'source', 'year', 'pyq'],
};

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export function csvToQuestions(text, product, defaults = {}) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) return { questions: [], skipped: 0, errors: ['CSV has no data rows'] };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const idx = head.findIndex((h) => names.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const missing = ['question', 'a', 'b', 'answer'].filter((k) => col[k] == null);
  if (missing.length) return { questions: [], skipped: rows.length - 1, errors: [`Missing columns: ${missing.join(', ')}. Found: ${head.join(', ')}`] };

  const questions = [], errors = [];
  rows.slice(1).forEach((r, i) => {
    const get = (k) => (col[k] == null ? '' : (r[col[k]] || '').trim());
    const options = ['a', 'b', 'c', 'd'].map(get).filter(Boolean);
    const raw = get('answer');
    let answer = LETTERS.indexOf(raw.toUpperCase().replace(/^OPTION[_\s]*/, '').replace(/[().]/g, ''));
    if (answer < 0 && /^\d$/.test(raw)) answer = Number(raw) - 1;
    if (answer < 0) answer = options.findIndex((o) => o.toLowerCase() === raw.toLowerCase());
    if (!get('question') || options.length < 2 || answer < 0 || answer >= options.length) {
      errors.push(`Row ${i + 2}: missing question/options or unreadable answer "${raw}"`);
      return;
    }
    questions.push({
      product,
      subject: get('subject') || defaults.subject || 'General',
      topic: get('topic') || defaults.topic || '',
      question: get('question'),
      options, answer,
      explanation: get('explanation'),
      level: get('level'),
      tags: get('tags') ? get('tags').split(/[;|]/).map((t) => t.trim()) : [],
      createdAt: new Date(),
    });
  });
  return { questions, skipped: errors.length, errors: errors.slice(0, 20) };
}
