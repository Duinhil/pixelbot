import WebSocket from 'ws';
import { config } from './config';
import { StoredTokens, saveTokens } from './auth/tokenStore';
import {
  validateToken,
  refreshAccessToken,
  sendChatMessage,
  registerEventSubListeners,
  lookupUserId,
} from './twitchApi';
import { handleCommand } from './commands';

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
      chatter_user_login: string;
      message: { text: string };
    };
  };
}

interface GenericMessage {
  metadata: { message_type: string };
  payload: Record<string, unknown>;
}

type EventSubMessage = SessionWelcomeMessage | NotificationMessage | GenericMessage;

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
    config.chatChannels.map((channel) => lookupUserId(channel, accessToken)),
  );

  startWebSocketClient(getValidToken, tokens.user_id, channelUserIds);
}

// --- WebSocket ---

function startWebSocketClient(
  getValidToken: () => Promise<string>,
  botUserId: string,
  channelUserIds: string[],
): WebSocket {
  const client = new WebSocket(EVENTSUB_WEBSOCKET_URL);

  client.on('error', console.error);

  client.on('open', () => {
    console.log('WebSocket connection opened to ' + EVENTSUB_WEBSOCKET_URL);
  });

  client.on('message', (data) => {
    handleWebSocketMessage(
      JSON.parse(data.toString()) as EventSubMessage,
      getValidToken,
      botUserId,
      channelUserIds,
    );
  });

  return client;
}

function handleWebSocketMessage(
  data: EventSubMessage,
  getValidToken: () => Promise<string>,
  botUserId: string,
  channelUserIds: string[],
): void {
  switch (data.metadata.message_type) {
    case 'session_welcome': {
      const msg = data as SessionWelcomeMessage;
      const sessionId = msg.payload.session.id;
      getValidToken().then((token) =>
        Promise.all(channelUserIds.map((cid) => registerEventSubListeners(token, sessionId, botUserId, cid))),
      );
      break;
    }
    case 'notification': {
      const msg = data as NotificationMessage;
      if (msg.metadata.subscription_type === 'channel.chat.message') {
        const { broadcaster_user_id, broadcaster_user_login, chatter_user_login, message } = msg.payload.event;
        console.log(`MSG #${broadcaster_user_login} <${chatter_user_login}> ${message.text}`);

        const [commandWord, ...args] = message.text.trim().split(/\s+/);
        if (commandWord.startsWith('!')) {
          const name = commandWord.slice(1);
          handleCommand(name, {
            sender: chatter_user_login,
            args,
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
