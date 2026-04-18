import { config } from './config';

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
}

export interface ValidateResponse {
  user_id: string;
  login: string;
  scopes: string[];
  expires_in: number;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
}

export async function lookupUserId(login: string, accessToken: string): Promise<TwitchUser> {
  const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.clientId,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to look up user "${login}": HTTP ${response.status}`);
  }

  const data = await response.json() as { data: Array<{ id: string; login: string; display_name: string }> };
  if (data.data.length === 0) {
    throw new Error(`Twitch user "${login}" not found. Check CHAT_CHANNELS in your .env.`);
  }

  const user = data.data[0];
  console.log(`Resolved channel "${login}" → user ID ${user.id}`);
  return { id: user.id, login: user.login, displayName: user.display_name };
}

export interface ChannelInfo {
  game_name: string;
  title: string;
}

export async function getChannelInfo(broadcasterId: string, accessToken: string): Promise<ChannelInfo | null> {
  const response = await fetch(
    `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': config.clientId,
      },
    },
  );

  if (!response.ok) return null;

  const data = await response.json() as { data: ChannelInfo[] };
  return data.data[0] ?? null;
}

export async function validateToken(accessToken: string): Promise<ValidateResponse> {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `OAuth ${accessToken}` },
  });

  if (response.status !== 200) {
    const data = await response.json();
    console.error('Token validation failed:', data);
    process.exit(1);
  }

  console.log('Validated token.');
  return response.json() as Promise<ValidateResponse>;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Token exchange failed: ${JSON.stringify(err)}`);
  }

  return response.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Token refresh failed: ${JSON.stringify(err)}`);
  }

  return response.json() as Promise<TokenResponse>;
}

export async function sendChatMessage(accessToken: string, chatMessage: string, botUserId: string, channelUserId: string): Promise<void> {
  const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      broadcaster_id: channelUserId,
      sender_id: botUserId,
      message: chatMessage,
    }),
  });

  if (response.status !== 200) {
    const data = await response.json();
    console.error('Failed to send chat message:', data);
  } else {
    console.log('Sent chat message:', chatMessage);
  }
}

export async function registerEventSubListeners(accessToken: string, sessionId: string, botUserId: string, channelUserId: string): Promise<void> {
  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'channel.chat.message',
      version: '1',
      condition: {
        broadcaster_user_id: channelUserId,
        user_id: botUserId,
      },
      transport: {
        method: 'websocket',
        session_id: sessionId,
      },
    }),
  });

  if (response.status !== 202) {
    const data = await response.json();
    console.error('Failed to subscribe to channel.chat.message. Status:', response.status);
    console.error(data);
    process.exit(1);
  } else {
    const data = await response.json() as { data: Array<{ id: string }> };
    console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
  }

  const onlineResponse = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'stream.online',
      version: '1',
      condition: {
        broadcaster_user_id: channelUserId,
      },
      transport: {
        method: 'websocket',
        session_id: sessionId,
      },
    }),
  });

  if (onlineResponse.status !== 202) {
    const data = await onlineResponse.json();
    console.error('Failed to subscribe to stream.online. Status:', onlineResponse.status);
    console.error(data);
    process.exit(1);
  } else {
    const data = await onlineResponse.json() as { data: Array<{ id: string }> };
    console.log(`Subscribed to stream.online [${data.data[0].id}]`);
  }

  const offlineResponse = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': config.clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'stream.offline',
      version: '1',
      condition: {
        broadcaster_user_id: channelUserId,
      },
      transport: {
        method: 'websocket',
        session_id: sessionId,
      },
    }),
  });

  if (offlineResponse.status !== 202) {
    const data = await offlineResponse.json();
    console.error('Failed to subscribe to stream.offline. Status:', offlineResponse.status);
    console.error(data);
    process.exit(1);
  } else {
    const data = await offlineResponse.json() as { data: Array<{ id: string }> };
    console.log(`Subscribed to stream.offline [${data.data[0].id}]`);
  }
}
