import WebSocket from 'ws';
import { config } from './config';
import { StoredTokens, saveTokens, saveBroadcasterTokens } from './auth/tokenStore';
import {
  validateToken,
  refreshAccessToken,
  sendChatMessage,
  registerEventSubListeners,
  registerRedemptionListener,
  lookupUserId,
  isStreamLive,
} from './twitchApi';
import { handleCommand } from './commands';
import { PeriodicMessageScheduler, loadPeriodicMessagesConfig } from './periodicMessages';
import { loadVipStealConfig, handleVipStealRedemption, expireVipHolders, VipStealConfig } from './vipSteal';

const periodicScheduler = new PeriodicMessageScheduler(loadPeriodicMessagesConfig());

const EVENTSUB_WEBSOCKET_URL = 'wss://eventsub.wss.twitch.tv/ws';

// --- EventSub message types ---

interface SessionWelcomeMessage {
  metadata: { message_type: 'session_welcome' };
  payload: { session: { id: string } };
}

interface NotificationMessage {
  metadata: {
    message_type: 'notification';
    subscription_type: string;
  };
  payload: {
    event: {
      broadcaster_user_id: string;
      broadcaster_user_login: string;
      broadcaster_user_name: string;
      chatter_user_login: string;
      chatter_user_name: string;
      message: { text: string };
      badges: Array<{ set_id: string }>;
    };
  };
}

interface RedemptionNotificationMessage {
  metadata: {
    message_type: 'notification';
    subscription_type: 'channel.channel_points_custom_reward_redemption.add';
  };
  payload: {
    event: {
      broadcaster_user_id: string;
      user_id: string;
      user_login: string;
      user_name: string;
      reward: {
        id: string;
        title: string;
        cost: number;
        prompt: string;
      };
      status: string;
    };
  };
}

interface SessionReconnectMessage {
  metadata: { message_type: 'session_reconnect' };
  payload: { session: { id: string; reconnect_url: string } };
}

interface StreamOnlineMessage {
  metadata: { message_type: 'notification'; subscription_type: 'stream.online' };
  payload: {
    event: {
      broadcaster_user_id: string;
      broadcaster_user_name: string;
    };
  };
}

interface StreamOfflineMessage {
  metadata: { message_type: 'notification'; subscription_type: 'stream.offline' };
  payload: {
    event: {
      broadcaster_user_id: string;
      broadcaster_user_name: string;
    };
  };
}

interface GenericMessage {
  metadata: { message_type: string };
  payload: Record<string, unknown>;
}

type EventSubMessage = SessionWelcomeMessage | SessionReconnectMessage | NotificationMessage | GenericMessage;

// --- Bot entry point ---

export async function startBot(initialTokens: StoredTokens, initialBroadcasterTokens?: StoredTokens): Promise<void> {
  let tokens = initialTokens;
  let broadcasterTokens = initialBroadcasterTokens;

  async function getValidToken(): Promise<string> {
    if (Date.now() >= tokens.expires_at - 60_000) {
      console.log('Access token expiring soon, refreshing...');
      const refreshed = await refreshAccessToken(tokens.refresh_token);
      tokens = {
        ...tokens,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: Date.now() + refreshed.expires_in * 1000,
      };
      saveTokens(tokens);
      console.log('Token refreshed.');
    }
    return tokens.access_token;
  }

  async function getValidBroadcasterToken(): Promise<string> {
    if (!broadcasterTokens) throw new Error('No broadcaster tokens available');
    if (Date.now() >= broadcasterTokens.expires_at - 60_000) {
      console.log('Broadcaster token expiring soon, refreshing...');
      const refreshed = await refreshAccessToken(broadcasterTokens.refresh_token);
      broadcasterTokens = {
        ...broadcasterTokens,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: Date.now() + refreshed.expires_in * 1000,
      };
      saveBroadcasterTokens(broadcasterTokens);
      console.log('Broadcaster token refreshed.');
    }
    return broadcasterTokens.access_token;
  }

  const vipStealConfig: VipStealConfig | null = loadVipStealConfig();
  if (vipStealConfig && broadcasterTokens) {
    console.log(`VIP steal enabled: reward="${vipStealConfig.rewardName}", max=${vipStealConfig.maxVips}, strategy=${vipStealConfig.stealStrategy}`);
  } else if (vipStealConfig && !broadcasterTokens) {
    console.log('vip-steal.json found but no broadcaster tokens — VIP steal disabled. Run with broadcaster auth to enable.');
  }

  const accessToken = await getValidToken();
  await validateToken(accessToken);

  const primaryChannelId = (await lookupUserId(config.chatChannel, accessToken)).id;
  const debugChannelId = config.debugChannel
    ? (await lookupUserId(config.debugChannel, accessToken)).id
    : null;
  const channelIds: ChannelIds = { primary: primaryChannelId, debug: debugChannelId };

  const live = await isStreamLive(primaryChannelId, accessToken);
  if (live) {
    console.log(`[periodic] Stream already live on startup, starting scheduler for ${primaryChannelId}.`);
    periodicScheduler.start(async (text) => {
      const t = await getValidToken();
      await sendChatMessage(t, text, tokens.user_id, primaryChannelId);
    });
  }

  startWebSocketClient(getValidToken, getValidBroadcasterToken, tokens.user_id, channelIds, !!broadcasterTokens, vipStealConfig);
}

// --- WebSocket ---

interface ChannelIds {
  primary: string;
  debug: string | null;
}

function startWebSocketClient(
  getValidToken: () => Promise<string>,
  getValidBroadcasterToken: () => Promise<string>,
  botUserId: string,
  channelIds: ChannelIds,
  hasBroadcasterTokens: boolean,
  vipStealConfig: VipStealConfig | null,
  url: string = EVENTSUB_WEBSOCKET_URL,
  skipSubscriptions: boolean = false,
): WebSocket {
  let reconnecting = false;
  const client = new WebSocket(url);

  client.on('error', console.error);

  client.on('open', () => {
    console.log('WebSocket connection opened to ' + url);
  });

  client.on('close', (code, reason) => {
    if (reconnecting) return;
    console.log(`WebSocket closed (${code}: ${reason ?? 'unknown'}). Reconnecting in 5s...`);
    setTimeout(() => startWebSocketClient(getValidToken, getValidBroadcasterToken, botUserId, channelIds, hasBroadcasterTokens, vipStealConfig), 5_000);
  });

  client.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as EventSubMessage;
    if (msg.metadata.message_type === 'session_reconnect') {
      const reconnectUrl = (msg as SessionReconnectMessage).payload.session.reconnect_url;
      console.log(`Received session_reconnect, moving to ${reconnectUrl}`);
      reconnecting = true;
      startWebSocketClient(getValidToken, getValidBroadcasterToken, botUserId, channelIds, hasBroadcasterTokens, vipStealConfig, reconnectUrl, true);
      client.close();
      return;
    }
    handleWebSocketMessage(msg, getValidToken, getValidBroadcasterToken, botUserId, channelIds, hasBroadcasterTokens, vipStealConfig, skipSubscriptions);
  });

  return client;
}

function handleWebSocketMessage(
  data: EventSubMessage,
  getValidToken: () => Promise<string>,
  getValidBroadcasterToken: () => Promise<string>,
  botUserId: string,
  channelIds: ChannelIds,
  hasBroadcasterTokens: boolean,
  vipStealConfig: VipStealConfig | null,
  skipSubscriptions: boolean,
): void {
  const allChannelIds = [channelIds.primary, ...(channelIds.debug ? [channelIds.debug] : [])];

  switch (data.metadata.message_type) {
    case 'session_welcome': {
      const msg = data as SessionWelcomeMessage;
      const sessionId = msg.payload.session.id;
      if (skipSubscriptions) {
        console.log(`Reconnected with session ${sessionId}`);
      } else {
        getValidToken().then((token) =>
          Promise.all(allChannelIds.map((cid) => registerEventSubListeners(token, sessionId, botUserId, cid))),
        );
        if (hasBroadcasterTokens && vipStealConfig) {
          getValidBroadcasterToken().then((bToken) =>
            registerRedemptionListener(bToken, sessionId, channelIds.primary),
          );
        }
      }
      break;
    }
    case 'notification': {
      const msg = data as NotificationMessage;
      if (msg.metadata.subscription_type === 'stream.online') {
        const { broadcaster_user_id, broadcaster_user_name } = (msg as unknown as StreamOnlineMessage).payload.event;
        if (broadcaster_user_id !== channelIds.primary) break;
        console.log(`STREAM ONLINE #${broadcaster_user_name}`);
        if (hasBroadcasterTokens && vipStealConfig) {
          expireVipHolders(broadcaster_user_id, getValidBroadcasterToken, vipStealConfig)
            .catch((err) => console.error('VIP expiry error:', err));
        }
        getValidToken().then(async (token) => {
          await sendChatMessage(token, 'shiroi84Foxbop shiroi84Foxbop shiroi84Foxbop', botUserId, broadcaster_user_id);
          periodicScheduler.start(async (text) => {
            const t = await getValidToken();
            await sendChatMessage(t, text, botUserId, broadcaster_user_id);
          });
        });
      } else if (msg.metadata.subscription_type === 'stream.offline') {
        const { broadcaster_user_id: offlineBroadcasterId } = (msg as unknown as StreamOfflineMessage).payload.event;
        if (offlineBroadcasterId !== channelIds.primary) break;
        console.log(`STREAM OFFLINE #${offlineBroadcasterId}`);
        periodicScheduler.stop();
      } else if (msg.metadata.subscription_type === 'channel.chat.message') {
        const { broadcaster_user_id, broadcaster_user_name, chatter_user_name, message, badges } = msg.payload.event;
        const isModerator = badges.some((b) => b.set_id === 'moderator' || b.set_id === 'lead_moderator' || b.set_id === 'broadcaster');
        const isDebug = broadcaster_user_id === channelIds.debug;

        const [commandWord, ...args] = message.text.trim().split(/\s+/);
        if (commandWord.startsWith('!')) {
          const name = commandWord.slice(1);
          handleCommand(name, {
            sender: chatter_user_name,
            args,
            isModerator,
            isDebug,
            say: async (text) => {
              const token = await getValidToken();
              return sendChatMessage(token, text, botUserId, broadcaster_user_id);
            },
            getToken: getValidToken,
          });
        }
      } else if (msg.metadata.subscription_type === 'channel.channel_points_custom_reward_redemption.add' && vipStealConfig) {
        const redemption = (msg as unknown as RedemptionNotificationMessage).payload.event;
        console.log(`Channel point redemption: "${redemption.reward.title}" by ${redemption.user_login}`);
        handleVipStealRedemption(
          redemption.user_id,
          redemption.user_login,
          redemption.reward.title,
          redemption.broadcaster_user_id,
          getValidBroadcasterToken,
          async (text) => {
            const token = await getValidToken();
            return sendChatMessage(token, text, botUserId, redemption.broadcaster_user_id);
          },
          vipStealConfig,
        ).catch((err) => console.error('VIP steal handler error:', err));
      }
      break;
    }
  }
}
