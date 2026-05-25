import { config } from './config';
import { getStoredTokens, getBroadcasterTokens, getDebugBroadcasterTokens } from './auth/tokenStore';
import { startAuthServer, startBroadcasterAuthServer, startDebugBroadcasterAuthServer } from './auth/server';
import { startBot } from './bot';
import { startWebhookServer } from './webhookServer';
import {
  getAppAccessToken,
  listEventSubSubscriptions,
  deleteEventSubSubscription,
  registerWebhookEventSubListeners,
  registerWebhookRedemptionListener,
  validateToken,
  lookupUserId,
} from './twitchApi';
import { loadVipStealConfig } from './vipSteal';

(async () => {
  // Bot OAuth
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

  // Broadcaster OAuth
  let broadcasterTokens = getBroadcasterTokens();
  if (!broadcasterTokens) {
    console.log('No broadcaster tokens found. Starting broadcaster authorization...');
    console.log(`Open http://localhost:${config.port}/authorize-broadcaster to authorize the broadcaster account.`);
    broadcasterTokens = await startBroadcasterAuthServer();
  } else {
    console.log('Found stored broadcaster tokens.');
  }

  // Debug broadcaster OAuth (one-time, only needed when DEBUG_CHANNEL is configured)
  if (config.debugChannel) {
    if (!getDebugBroadcasterTokens()) {
      console.log(`Debug channel configured but not yet authorized.`);
      console.log(`Open http://localhost:${config.port}/authorize-debug-broadcaster and log in as the ${config.debugChannel} broadcaster.`);
      await startDebugBroadcasterAuthServer();
    } else {
      console.log('Found stored debug broadcaster tokens.');
    }
  }

  // Webhook server must be running before subscriptions are registered
  startWebhookServer();

  // App access token (client credentials — no user interaction needed)
  let appTokenData = await getAppAccessToken();
  let appTokenExpiresAt = Date.now() + appTokenData.expires_in * 1000;

  async function getValidAppToken(): Promise<string> {
    if (Date.now() >= appTokenExpiresAt - 60_000) {
      appTokenData = await getAppAccessToken();
      appTokenExpiresAt = Date.now() + appTokenData.expires_in * 1000;
    }
    return appTokenData.access_token;
  }

  // Validate bot token and resolve channel IDs for subscription registration
  await validateToken(botTokens.access_token);
  const botUserId = botTokens.user_id;
  const primaryChannel = await lookupUserId(config.chatChannel, botTokens.access_token);
  const primaryChannelId = primaryChannel.id;
  const debugChannelId = config.debugChannel
    ? (await lookupUserId(config.debugChannel, botTokens.access_token)).id
    : null;
  const allChannelIds = [primaryChannelId, ...(debugChannelId ? [debugChannelId] : [])];

  // Clean up stale subscriptions from previous runs
  console.log('Cleaning up existing EventSub subscriptions...');
  let cursor: string | undefined;
  do {
    const appToken = await getValidAppToken();
    const page = await listEventSubSubscriptions(appToken, cursor);
    for (const sub of page.data) {
      if (sub.transport.callback === config.webhookCallbackUrl) {
        console.log(`Deleting stale subscription: ${sub.type} [${sub.id}]`);
        await deleteEventSubSubscription(appToken, sub.id);
      }
    }
    cursor = page.pagination.cursor;
  } while (cursor);

  // Register webhook subscriptions
  const appToken = await getValidAppToken();
  for (const channelId of allChannelIds) {
    await registerWebhookEventSubListeners(
      appToken,
      botUserId,
      channelId,
      config.webhookCallbackUrl,
      config.webhookSecret,
    );
  }

  const vipStealConfig = loadVipStealConfig();
  if (broadcasterTokens && vipStealConfig?.enabled) {
    await registerWebhookRedemptionListener(
      broadcasterTokens.access_token,
      primaryChannelId,
      config.webhookCallbackUrl,
      config.webhookSecret,
    );
  }

  await startBot(botTokens, broadcasterTokens ?? undefined);
})();
