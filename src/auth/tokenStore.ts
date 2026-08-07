import { db } from '../db';

export interface StoredTokens {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix ms
}

export function getStoredTokens(): StoredTokens | undefined {
  return db.prepare('SELECT user_id, access_token, refresh_token, expires_at FROM tokens WHERE id = 1').get() as StoredTokens | undefined;
}

export function saveTokens(tokens: StoredTokens): void {
  db.prepare(`
    INSERT INTO tokens (id, user_id, access_token, refresh_token, expires_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id       = excluded.user_id,
      access_token  = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at    = excluded.expires_at
  `).run(tokens.user_id, tokens.access_token, tokens.refresh_token, tokens.expires_at);
}

export function getBroadcasterTokens(): StoredTokens | undefined {
  return db.prepare('SELECT user_id, access_token, refresh_token, expires_at FROM broadcaster_tokens WHERE id = 1').get() as StoredTokens | undefined;
}

export function deleteBroadcasterTokens(): void {
  db.prepare('DELETE FROM broadcaster_tokens WHERE id = 1').run();
}

export function saveBroadcasterTokens(tokens: StoredTokens): void {
  db.prepare(`
    INSERT INTO broadcaster_tokens (id, user_id, access_token, refresh_token, expires_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id       = excluded.user_id,
      access_token  = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at    = excluded.expires_at
  `).run(tokens.user_id, tokens.access_token, tokens.refresh_token, tokens.expires_at);
}

export function getDebugBroadcasterTokens(): StoredTokens | undefined {
  return db.prepare('SELECT user_id, access_token, refresh_token, expires_at FROM debug_broadcaster_tokens WHERE id = 1').get() as StoredTokens | undefined;
}

export function saveDebugBroadcasterTokens(tokens: StoredTokens): void {
  db.prepare(`
    INSERT INTO debug_broadcaster_tokens (id, user_id, access_token, refresh_token, expires_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id       = excluded.user_id,
      access_token  = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at    = excluded.expires_at
  `).run(tokens.user_id, tokens.access_token, tokens.refresh_token, tokens.expires_at);
}
