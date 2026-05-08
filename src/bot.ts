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
import { emitOverlayEvent } from './overlayEvents';
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
  if (vipStealConfig?.enabled && broadcasterTokens) {
    console.log(`VIP steal enabled: reward="${vipStealConfig.rewardName}", max=${vipStealConfig.maxVips}, strategy=${vipStealConfig.stealStrategy}`);
  } else if (vipStealConfig?.enabled && !broadcasterTokens) {
    console.log('vip-steal.json found but no broadcaster tokens — VIP steal disabled. Run with broadcaster auth to enable.');
  } else if (vipStealConfig && !vipStealConfig.enabled) {
    console.log('VIP steal redemption is disabled in vip-steal.json (test/fake commands still available).');
  }

  const accessToken = await getValidToken();
  await validateToken(accessToken);

  const primaryChannelId = (await lookupUserId(config.chatChannel, accessToken)).id;
  const debugChannelId = config.debugChannel
    ? (await lookupUserId(config.debugChannel, accessToken)).id
    : null;
  const allChannelIds = [primaryChannelId, ...(debugChannelId ? [debugChannelId] : [])];

  const live = await isStreamLive(primaryChannelId, accessToken);
  if (live) {
    console.log(`[periodic] Stream already live on startup, starting scheduler for ${primaryChannelId}.`);
    periodicScheduler.start(async (text) => {
      const t = await getValidToken();
      await sendChatMessage(t, text, tokens.user_id, primaryChannelId);
    });
  }

  // Bot WebSocket: chat messages + stream events
  startWebSocketClient(
    'bot',
    (sessionId) => {
      getValidToken().then((token) =>
        Promise.all(allChannelIds.map((cid) => registerEventSubListeners(token, sessionId, tokens.user_id, cid))),
      );
    },
    (msg) => {
      const sub = (msg as NotificationMessage).metadata.subscription_type;
      if (sub === 'stream.online') {
        const { broadcaster_user_id, broadcaster_user_name } = (msg as unknown as StreamOnlineMessage).payload.event;
        if (broadcaster_user_id !== primaryChannelId) return;
        console.log(`STREAM ONLINE #${broadcaster_user_name}`);
        emitOverlayEvent({ type: 'stream.online', ts: Date.now(), broadcasterName: broadcaster_user_name });
        if (broadcasterTokens && vipStealConfig) {
          expireVipHolders(broadcaster_user_id, getValidBroadcasterToken, vipStealConfig)
            .catch((err) => console.error('VIP expiry error:', err));
        }
        getValidToken().then(async (token) => {
          await sendChatMessage(token, 'shiroi84Foxbop shiroi84Foxbop shiroi84Foxbop', tokens.user_id, broadcaster_user_id);
          periodicScheduler.start(async (text) => {
            const t = await getValidToken();
            await sendChatMessage(t, text, tokens.user_id, broadcaster_user_id);
          });
        });
      } else if (sub === 'stream.offline') {
        const { broadcaster_user_id, broadcaster_user_name: offlineBroadcasterName } = (msg as unknown as StreamOfflineMessage).payload.event;
        if (broadcaster_user_id !== primaryChannelId) return;
        console.log(`STREAM OFFLINE #${broadcaster_user_id}`);
        emitOverlayEvent({ type: 'stream.offline', ts: Date.now(), broadcasterName: offlineBroadcasterName });
        periodicScheduler.stop();
      } else if (sub === 'channel.chat.message') {
        const { broadcaster_user_id, chatter_user_name, message, badges } = (msg as NotificationMessage).payload.event;
        const isModerator = badges.some((b) => b.set_id === 'moderator' || b.set_id === 'lead_moderator' || b.set_id === 'broadcaster');
        const isDebug = broadcaster_user_id === debugChannelId;

        emitOverlayEvent({ type: 'chat.message', ts: Date.now(), sender: chatter_user_name, text: message.text, emotes: [] });

        const [commandWord, ...args] = message.text.trim().split(/\s+/);
        if (commandWord.startsWith('!')) {
          handleCommand(commandWord.slice(1), {
            sender: chatter_user_name,
            args,
            isModerator,
            isDebug,
            say: async (text) => {
              const token = await getValidToken();
              return sendChatMessage(token, text, tokens.user_id, broadcaster_user_id);
            },
            getToken: getValidToken,
          });
        }
      }
    },
  );

  // Broadcaster WebSocket: channel point redemptions (separate session required by Twitch)
  if (broadcasterTokens && vipStealConfig) {
    startWebSocketClient(
      'broadcaster',
      (sessionId) => {
        getValidBroadcasterToken().then((bToken) =>
          registerRedemptionListener(bToken, sessionId, primaryChannelId),
        );
      },
      (msg) => {
        if ((msg as NotificationMessage).metadata.subscription_type !== 'channel.channel_points_custom_reward_redemption.add') return;
        const redemption = (msg as unknown as RedemptionNotificationMessage).payload.event;
        console.log(`Channel point redemption: "${redemption.reward.title}" by ${redemption.user_login}`);
        emitOverlayEvent({ type: 'redemption', ts: Date.now(), rewardId: redemption.reward.id, rewardTitle: redemption.reward.title, userId: redemption.user_id, userLogin: redemption.user_login, userInput: '' });
        if (!vipStealConfig.enabled) return;
        handleVipStealRedemption(
          redemption.user_id,
          redemption.user_login,
          redemption.reward.title,
          redemption.broadcaster_user_id,
          getValidBroadcasterToken,
          async (text) => {
            const token = await getValidToken();
            return sendChatMessage(token, text, tokens.user_id, redemption.broadcaster_user_id);
          },
          vipStealConfig,
        ).catch((err) => console.error('VIP steal handler error:', err));
      },
    );
  }
}

// --- WebSocket ---

function startWebSocketClient(
  label: string,
  onReady: (sessionId: string) => void,
  onNotification: (msg: EventSubMessage) => void,
  url: string = EVENTSUB_WEBSOCKET_URL,
  skipReady: boolean = false,
): WebSocket {
  let reconnecting = false;
  const client = new WebSocket(url);

  client.on('error', console.error);

  client.on('open', () => {
    console.log(`[${label}] WebSocket connection opened to ${url}`);
  });

  client.on('close', (code, reason) => {
    if (reconnecting) return;
    console.log(`[${label}] WebSocket closed (${code}: ${reason ?? 'unknown'}). Reconnecting in 5s...`);
    setTimeout(() => startWebSocketClient(label, onReady, onNotification), 5_000);
  });

  client.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as EventSubMessage;
    if (msg.metadata.message_type === 'session_reconnect') {
      const reconnectUrl = (msg as SessionReconnectMessage).payload.session.reconnect_url;
      console.log(`[${label}] Received session_reconnect, moving to ${reconnectUrl}`);
      reconnecting = true;
      startWebSocketClient(label, onReady, onNotification, reconnectUrl, true);
      client.close();
      return;
    }
    if (msg.metadata.message_type === 'session_welcome') {
      const sessionId = (msg as SessionWelcomeMessage).payload.session.id;
      if (skipReady) {
        console.log(`[${label}] Reconnected with session ${sessionId}`);
      } else {
        onReady(sessionId);
      }
      return;
    }
    if (msg.metadata.message_type === 'notification') {
      onNotification(msg);
    }
  });

  return client;
}
