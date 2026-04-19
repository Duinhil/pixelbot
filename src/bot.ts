import WebSocket from 'ws';
import { config } from './config';
import { StoredTokens, saveTokens } from './auth/tokenStore';
import {
  validateToken,
  refreshAccessToken,
  sendChatMessage,
  registerEventSubListeners,
  lookupUserId,
  isStreamLive,
} from './twitchApi';
import { handleCommand } from './commands';
import { PeriodicMessageScheduler, loadPeriodicMessagesConfig } from './periodicMessages';

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

export async function startBot(initialTokens: StoredTokens): Promise<void> {
  let tokens = initialTokens;

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

  const accessToken = await getValidToken();
  await validateToken(accessToken);

  const channelUserIds = await Promise.all(
    config.chatChannels.map(async (channel) => (await lookupUserId(channel, accessToken)).id),
  );

  for (const broadcasterId of channelUserIds) {
    const live = await isStreamLive(broadcasterId, accessToken);
    if (live) {
      console.log(`[periodic] Stream already live on startup, starting scheduler for ${broadcasterId}.`);
      periodicScheduler.start(async (text) => {
        const t = await getValidToken();
        await sendChatMessage(t, text, tokens.user_id, broadcasterId);
      });
      break;
    }
  }

  startWebSocketClient(getValidToken, tokens.user_id, channelUserIds);
}

// --- WebSocket ---

function startWebSocketClient(
  getValidToken: () => Promise<string>,
  botUserId: string,
  channelUserIds: string[],
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
    setTimeout(() => startWebSocketClient(getValidToken, botUserId, channelUserIds), 5_000);
  });

  client.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as EventSubMessage;
    if (msg.metadata.message_type === 'session_reconnect') {
      const reconnectUrl = (msg as SessionReconnectMessage).payload.session.reconnect_url;
      console.log(`Received session_reconnect, moving to ${reconnectUrl}`);
      reconnecting = true;
      startWebSocketClient(getValidToken, botUserId, channelUserIds, reconnectUrl, true);
      client.close();
      return;
    }
    handleWebSocketMessage(msg, getValidToken, botUserId, channelUserIds, skipSubscriptions);
  });

  return client;
}

function handleWebSocketMessage(
  data: EventSubMessage,
  getValidToken: () => Promise<string>,
  botUserId: string,
  channelUserIds: string[],
  skipSubscriptions: boolean,
): void {
  switch (data.metadata.message_type) {
    case 'session_welcome': {
      const msg = data as SessionWelcomeMessage;
      const sessionId = msg.payload.session.id;
      if (skipSubscriptions) {
        console.log(`Reconnected with session ${sessionId}`);
      } else {
        getValidToken().then((token) =>
          Promise.all(channelUserIds.map((cid) => registerEventSubListeners(token, sessionId, botUserId, cid))),
        );
      }
      break;
    }
    case 'notification': {
      const msg = data as NotificationMessage;
      if (msg.metadata.subscription_type === 'stream.online') {
        const { broadcaster_user_id, broadcaster_user_name } = (msg as unknown as StreamOnlineMessage).payload.event;
        console.log(`STREAM ONLINE #${broadcaster_user_name}`);
        getValidToken().then(async (token) => {
          await sendChatMessage(token, 'shiroi84Foxbop shiroi84Foxbop shiroi84Foxbop', botUserId, broadcaster_user_id);
          periodicScheduler.start(async (text) => {
            const t = await getValidToken();
            await sendChatMessage(t, text, botUserId, broadcaster_user_id);
          });
        });
      } else if (msg.metadata.subscription_type === 'stream.offline') {
        const { broadcaster_user_name } = (msg as unknown as StreamOfflineMessage).payload.event;
        console.log(`STREAM OFFLINE #${broadcaster_user_name}`);
        periodicScheduler.stop();
      } else if (msg.metadata.subscription_type === 'channel.chat.message') {
        const { broadcaster_user_id, broadcaster_user_name, chatter_user_name, message, badges } = msg.payload.event;
        const isModerator = badges.some((b) => b.set_id === 'moderator' || b.set_id === 'lead_moderator' || b.set_id === 'broadcaster');

        const [commandWord, ...args] = message.text.trim().split(/\s+/);
        if (commandWord.startsWith('!')) {
          const name = commandWord.slice(1);
          handleCommand(name, {
            sender: chatter_user_name,
            args,
            isModerator,
            say: async (text) => {
              const token = await getValidToken();
              await sendChatMessage(token, text, botUserId, broadcaster_user_id);
            },
            getToken: getValidToken,
          });
        }
      }
      break;
    }
  }
}
