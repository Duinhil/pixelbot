import { db } from './db';

export function incrementCount(name: string): number {
  db.prepare(`
    INSERT INTO counters (name, value) VALUES (?, 1)
    ON CONFLICT(name) DO UPDATE SET value = value + 1
  `).run(name);

  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as { value: number };
  return row.value;
}
