// Tiny data layer with two backends: MongoDB (production) and in-memory (tests, local simulator).
// Supports equality filters plus $in, $gte, $lte, $ne, $exists — enough for this app.
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const COLLECTIONS = ['users', 'sessions', 'questions', 'tests', 'attempts', 'orders', 'tokens', 'classes', 'events'];

function match(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), doc);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === '$in') return x.some((y) => eq(v, y) || (Array.isArray(v) && v.some((z) => eq(z, y))));
        if (op === '$gte') return v != null && v >= x;
        if (op === '$lte') return v != null && v <= x;
        if (op === '$gt') return v != null && v > x;
        if (op === '$lt') return v != null && v < x;
        if (op === '$ne') return !eq(v, x);
        if (op === '$exists') return (v !== undefined) === x;
        throw new Error('Unsupported operator ' + op);
      });
    }
    if (Array.isArray(v) && !Array.isArray(cond)) return v.some((z) => eq(z, cond));
    return eq(v, cond);
  });
}
const eq = (a, b) => (a instanceof Date && b instanceof Date ? +a === +b : a === b);
const clone = (d) => (d == null ? d : structuredClone(d));

function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = val;
}
function getPath(obj, path) {
  return path.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);
}

class MemoryCollection {
  constructor() { this.rows = []; }
  async insertOne(doc) { const d = { _id: randomUUID(), ...clone(doc) }; this.rows.push(d); return clone(d); }
  async insertMany(docs) { for (const d of docs) await this.insertOne(d); }
  async findOne(f = {}) { return clone(this.rows.find((r) => match(r, f)) || null); }
  async find(f = {}, { sort, limit, skip } = {}) {
    let r = this.rows.filter((x) => match(x, f));
    if (sort) {
      const [[k, dir]] = Object.entries(sort);
      r = [...r].sort((a, b) => (getPath(a, k) > getPath(b, k) ? dir : getPath(a, k) < getPath(b, k) ? -dir : 0));
    }
    if (skip) r = r.slice(skip);
    if (limit) r = r.slice(0, limit);
    return r.map(clone);
  }
  async count(f = {}) { return this.rows.filter((x) => match(x, f)).length; }
  async updateOne(f, { $set = {}, $inc = {}, $push = {}, $setOnInsert = {} }, { upsert } = {}) {
    let row = this.rows.find((r) => match(r, f));
    if (!row) {
      if (!upsert) return null;
      row = { _id: randomUUID() };
      for (const [k, v] of Object.entries(f)) if (typeof v !== 'object' || v === null) setPath(row, k, v);
      for (const [k, v] of Object.entries($setOnInsert)) setPath(row, k, clone(v));
      this.rows.push(row);
    }
    for (const [k, v] of Object.entries($set)) setPath(row, k, clone(v));
    for (const [k, v] of Object.entries($inc)) setPath(row, k, (getPath(row, k) || 0) + v);
    for (const [k, v] of Object.entries($push)) { const a = getPath(row, k) || []; a.push(clone(v)); setPath(row, k, a); }
    return clone(row);
  }
  async deleteMany(f = {}) { this.rows = this.rows.filter((r) => !match(r, f)); }
}

class MongoCollection {
  constructor(c) { this.c = c; }
  async insertOne(doc) { const d = { _id: randomUUID(), ...doc }; await this.c.insertOne(d); return d; }
  async insertMany(docs) { if (docs.length) await this.c.insertMany(docs.map((d) => ({ _id: randomUUID(), ...d }))); }
  async findOne(f = {}) { return this.c.findOne(f); }
  async find(f = {}, { sort, limit, skip } = {}) {
    let q = this.c.find(f);
    if (sort) q = q.sort(sort);
    if (skip) q = q.skip(skip);
    if (limit) q = q.limit(limit);
    return q.toArray();
  }
  async count(f = {}) { return this.c.countDocuments(f); }
  async updateOne(f, update, { upsert } = {}) {
    const clean = Object.fromEntries(Object.entries(update).filter(([, v]) => v && Object.keys(v).length));
    return this.c.findOneAndUpdate(f, clean, { upsert: !!upsert, returnDocument: 'after' });
  }
  async deleteMany(f = {}) { await this.c.deleteMany(f); }
}

export const db = {};
let client;

export async function connect() {
  if (config.store === 'mongo') {
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(config.mongoUri);
    await client.connect();
    const d = client.db(config.mongoDb);
    for (const name of COLLECTIONS) db[name] = new MongoCollection(d.collection(name));
    await Promise.all([
      d.collection('users').createIndex({ product: 1, phone: 1 }, { unique: true }),
      d.collection('sessions').createIndex({ product: 1, phone: 1 }, { unique: true }),
      d.collection('tokens').createIndex({ token: 1 }, { unique: true }),
      d.collection('orders').createIndex({ providerId: 1 }),
      d.collection('questions').createIndex({ product: 1, subject: 1 }),
      d.collection('tests').createIndex({ code: 1 }, { unique: true }),
      d.collection('classes').createIndex({ code: 1 }, { unique: true }),
      d.collection('attempts').createIndex({ testId: 1, score: -1 }),
    ]);
  } else {
    for (const name of COLLECTIONS) db[name] = new MemoryCollection();
  }
  return db;
}

export async function close() { if (client) await client.close(); }
