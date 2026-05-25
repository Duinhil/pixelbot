import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', 'bot.db');

export const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    user_id       TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS broadcaster_tokens (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    user_id       TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS debug_broadcaster_tokens (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    user_id       TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS vip_steal_holders (
    user_id    TEXT PRIMARY KEY,
    user_login TEXT NOT NULL,
    added_at   INTEGER NOT NULL
  );
`);
