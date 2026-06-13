/**
 * SQLite document store. Documents (businesses, editions, asset metadata)
 * live as JSON columns — this is a small-team in-house tool; we want
 * document semantics with optimistic concurrency, not normalized tables.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface DataDirs {
  root: string;
  assets: string;
  thumbs: string;
  exports: string;
}

/** Ensure the data directory layout exists; returns the resolved paths. */
export function ensureDataDirs(dataDir: string): DataDirs {
  const dirs: DataDirs = {
    root: dataDir,
    assets: path.join(dataDir, 'assets'),
    thumbs: path.join(dataDir, 'thumbs'),
    exports: path.join(dataDir, 'exports'),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  return dirs;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS editions (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    meta TEXT NOT NULL,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    edition_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    diagnostics TEXT,
    stats TEXT,
    filename TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  )`,
];

/** Open (creating if needed) the database at <dataDir>/guide.db. */
export function openDb(dataDir: string): Database.Database {
  ensureDataDirs(dataDir);
  const db = new Database(path.join(dataDir, 'guide.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const sql of MIGRATIONS) db.exec(sql);
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Monotonic timestamp for optimistic-concurrency tokens: always strictly
 * after `prev`, even when two writes land in the same millisecond.
 */
export function nextTimestamp(prev?: string | null): string {
  let t = Date.now();
  if (prev) {
    const p = Date.parse(prev);
    if (!Number.isNaN(p) && t <= p) t = p + 1;
  }
  return new Date(t).toISOString();
}
