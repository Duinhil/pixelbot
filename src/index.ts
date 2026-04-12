import { config } from './config';
import { getStoredTokens } from './auth/tokenStore';
import { startAuthServer } from './auth/server';
import { startBot } from './bot';

(async () => {
  const stored = getStoredTokens();

  if (stored) {
    console.log('Found stored tokens. Starting bot...');
    await startBot(stored);
  } else {
    console.log('No tokens found. Starting authorization flow...');
    console.log(`Open http://localhost:${config.port}/authorize to begin.`);
    const tokens = await startAuthServer();
    await startBot(tokens);
  }
})();
