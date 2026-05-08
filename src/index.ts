import { config } from './config';
import { getStoredTokens, getBroadcasterTokens } from './auth/tokenStore';
import { startAuthServer, startBroadcasterAuthServer } from './auth/server';
import { startBot } from './bot';
import { startOverlayServer } from './overlayServer';

(async () => {
  startOverlayServer();

  const stored = getStoredTokens();

  let botTokens;
  if (stored) {
    console.log('Found stored tokens. Starting bot...');
    botTokens = stored;
  } else {
    console.log('No tokens found. Starting authorization flow...');
    console.log(`Open http://localhost:${config.port}/authorize to begin.`);
    botTokens = await startAuthServer();
  }

  let broadcasterTokens = getBroadcasterTokens();
  if (!broadcasterTokens) {
    console.log('No broadcaster tokens found. Starting broadcaster authorization...');
    console.log(`Open http://localhost:${config.port}/authorize-broadcaster to authorize the broadcaster account.`);
    broadcasterTokens = await startBroadcasterAuthServer();
  } else {
    console.log('Found stored broadcaster tokens.');
  }

  await startBot(botTokens, broadcasterTokens);
})();
