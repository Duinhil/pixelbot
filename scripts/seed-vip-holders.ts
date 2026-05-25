import { getStoredTokens } from '../src/auth/tokenStore';
import { lookupUserId, refreshAccessToken } from '../src/twitchApi';
import { db } from '../src/db';
import { saveTokens } from '../src/auth/tokenStore';

// Accepts arguments as either plain usernames or username:DD/MM/YY pairs.
function parseArg(arg: string): { username: string; addedAt: number } {
  const sep = arg.lastIndexOf(':');
  if (sep === -1) return { username: arg, addedAt: Date.now() };

  const username = arg.slice(0, sep);
  const datePart = arg.slice(sep + 1);
  const [dd, mm, yy] = datePart.split('/').map(Number);
  const year = 2000 + yy;
  const ts = new Date(year, mm - 1, dd).getTime();
  if (isNaN(ts)) {
    console.warn(`Could not parse date "${datePart}" for ${username}, using today.`);
    return { username, addedAt: Date.now() };
  }
  return { username, addedAt: ts };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0) {
    console.error('Usage: npx ts-node scripts/seed-vip-holders.ts <username>[:<DD/MM/YY>] ...');
    console.error('Example: npx ts-node scripts/seed-vip-holders.ts alice:03/05/26 bob');
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

  for (const raw of rawArgs) {
    const { username, addedAt } = parseArg(raw);
    try {
      const user = await lookupUserId(username, tokens.access_token);
      const result = insert.run(user.id, user.login, addedAt);
      if (result.changes > 0) {
        console.log(`✓ Added ${user.login} (${user.id}) — added_at ${new Date(addedAt).toLocaleDateString()}`);
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
