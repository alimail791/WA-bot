// The NEET question bank shared with YNeet and ClassCoach (data/neet_bank.json, 3,600+ questions).
// Fields in the file: k id, s subject, c chapter, t topic, l class (11th/12th), d difficulty,
// q question, o options, a answer index, e explanation, p PYQ year(s), y 1 if PYQ.
import { readFileSync } from 'node:fs';
import { db } from './store.js';

let cache;
export function loadBankFile() {
  if (!cache) cache = JSON.parse(readFileSync(new URL('../data/neet_bank.json', import.meta.url), 'utf8'));
  return cache;
}

const pyqYear = (x) => (x.y ? Number(String(x.p || '').match(/\d{4}/)?.[0]) || null : null);

function toDoc(x, product) {
  return {
    _id: `${product === 'yneet' ? 'nb' : 'nbc'}_${x.k}`,
    product, bank: 'neet',
    subject: product === 'yneet' ? x.s : `NEET ${x.s}`,
    topic: x.c, subtopic: x.t || '', classLevel: x.l || '', level: x.d || 'medium',
    question: x.q, options: x.o.map(String), answer: Number(x.a) || 0, explanation: x.e || '',
    pyqYear: pyqYear(x), tags: x.y ? ['neet', 'pyq'] : ['neet'], createdAt: new Date(),
  };
}

// Load (or top up) the bank for YNeet and the ClassCoach NEET track. Safe to run on every start.
export async function ensureNeetBank() {
  const rows = loadBankFile().filter((x) => x?.k && x.q && Array.isArray(x.o) && x.o.length >= 2);
  const result = {};
  for (const product of ['yneet', 'classcoach']) {
    const have = await db.questions.count({ product, bank: 'neet' });
    if (have >= rows.length) { result[product] = 0; continue; }
    const existing = new Set((await db.questions.find({ product, bank: 'neet' })).map((q) => q._id));
    const docs = rows.map((x) => toDoc(x, product)).filter((d) => !existing.has(d._id));
    for (let i = 0; i < docs.length; i += 500) await db.questions.insertMany(docs.slice(i, i + 500));
    // The bank replaces the small sample set for these subjects
    if (product === 'yneet') await db.questions.deleteMany({ product: 'yneet', tags: 'sample' });
    else for (const s of ['NEET Biology', 'NEET Physics', 'NEET Chemistry']) await db.questions.deleteMany({ product: 'classcoach', subject: s, tags: 'sample' });
    result[product] = docs.length;
  }
  console.log(`[bank] NEET bank ready: added ${JSON.stringify(result)} (${rows.length} questions in file)`);
  return result;
}

// Chapter list per subject with question counts, for menus
let chapterCache;
export function chapters(subject) {
  if (!chapterCache) {
    chapterCache = {};
    for (const x of loadBankFile()) {
      const s = (chapterCache[x.s] ??= {});
      s[x.c] = (s[x.c] || 0) + 1;
    }
  }
  return Object.entries(chapterCache[subject] || {}).sort((a, b) => a[0].localeCompare(b[0]));
}

export function pyqYears() {
  const years = {};
  for (const x of loadBankFile()) { const y = pyqYear(x); if (y) years[y] = (years[y] || 0) + 1; }
  return Object.entries(years).map(([y, n]) => [Number(y), n]).sort((a, b) => b[0] - a[0]);
}
