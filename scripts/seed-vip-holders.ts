import { getStoredTokens } from '../src/auth/tokenStore';
import { lookupUserId, refreshAccessToken } from '../src/twitchApi';
import { db } from '../src/db';
import { saveTokens } from '../src/auth/tokenStore';

async function main() {
  const usernames = process.argv.slice(2);
  if (usernames.length === 0) {
    console.error('Usage: npx ts-node scripts/seed-vip-holders.ts <username1> [username2] ...');
    process.exit(1);
  }

  let tokens = getStoredTokens();
  if (!tokens) {
    console.error('No stored bot tokens found. Run the bot once to authorize first.');
    process.exit(1);
  }

  if (Date.now() >= tokens.expires_at - 60_000) {
    console.log('Token expiring soon, refreshing...');
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    tokens = {
      ...tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: Date.now() + refreshed.expires_in * 1000,
    };
    saveTokens(tokens);
  }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO vip_steal_holders (user_id, user_login, added_at) VALUES (?, ?, ?)',
  );

  for (const username of usernames) {
    try {
      const user = await lookupUserId(username, tokens.access_token);
      const result = insert.run(user.id, user.login, Date.now());
      if (result.changes > 0) {
        console.log(`✓ Added ${user.login} (${user.id})`);
      } else {
        console.log(`- Skipped ${user.login} (already in table)`);
      }
    } catch (err) {
      console.error(`✗ Failed to add "${username}":`, (err as Error).message);
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
