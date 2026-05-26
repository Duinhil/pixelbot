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

export async function getAppAccessToken(): Promise<{ access_token: string; expires_in: number }> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'client_credentials',
  });

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`App access token fetch failed: ${JSON.stringify(err)}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  console.log('Fetched app access token.');
  return data;
}

export interface EventSubSubscription {
  id: string;
  type: string;
  status: string;
  transport: { method: string; callback?: string };
}

export async function listEventSubSubscriptions(
  appToken: string,
  cursor?: string,
): Promise<{ data: EventSubSubscription[]; pagination: { cursor?: string } }> {
  const url = new URL('https://api.twitch.tv/helix/eventsub/subscriptions');
  if (cursor) url.searchParams.set('after', cursor);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Client-Id': config.clientId,
    },
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`listEventSubSubscriptions failed: ${JSON.stringify(err)}`);
  }

  return response.json() as Promise<{ data: EventSubSubscription[]; pagination: { cursor?: string } }>;
}

export async function deleteEventSubSubscription(appToken: string, id: string): Promise<void> {
  const response = await fetch(
    `https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${appToken}`,
        'Client-Id': config.clientId,
      },
    },
  );

  if (response.status !== 204) {
    console.error(`Failed to delete subscription ${id}: HTTP ${response.status}`);
  }
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

export async function sendChatMessage(accessToken: string, chatMessage: string, botUserId: string, channelUserId: string, isRetry = false): Promise<boolean> {
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

  if (response.status === 200) {
    console.log('Sent chat message:', chatMessage);
    return true;
  }

  if (response.status === 429 && !isRetry) {
    const resetAt = parseInt(response.headers.get('Ratelimit-Reset') ?? '0', 10);
    const waitMs = resetAt * 1000 - Date.now();
    console.warn(`Rate limited sending chat message — reset in ${Math.ceil(waitMs / 1000)}s: ${chatMessage}`);
    if (waitMs > 0 && waitMs <= 5000) {
      await new Promise((r) => setTimeout(r, waitMs));
      return sendChatMessage(accessToken, chatMessage, botUserId, channelUserId, true);
    }
    console.error(`Rate limit reset too far away (${Math.ceil(waitMs / 1000)}s), dropping: ${chatMessage}`);
    return false;
  }

  const data = await response.json();
  if (isRetry && response.status === 429) {
    const resetAt = parseInt(response.headers.get('Ratelimit-Reset') ?? '0', 10);
    const waitMs = resetAt * 1000 - Date.now();
    console.error(`Rate limited on retry (reset in ${Math.ceil(waitMs / 1000)}s), dropping: ${chatMessage}`);
    return false;
  }
  console.error('Failed to send chat message:', data);
  return false;
}

export async function isStreamLive(broadcasterId: string, accessToken: string): Promise<boolean> {
  const response = await fetch(
    `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(broadcasterId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': config.clientId,
      },
    },
  );

  if (!response.ok) return false;

  const data = await response.json() as { data: Array<unknown> };
  return data.data.length > 0;
}

export async function addVip(broadcasterId: string, userId: string, accessToken: string): Promise<void> {
  const response = await fetch(
    `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${encodeURIComponent(broadcasterId)}&user_id=${encodeURIComponent(userId)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': config.clientId,
      },
    },
  );
  if (response.status !== 204) {
    const data = await response.json();
    console.error(`Failed to add VIP for user ${userId}:`, data);
  }
}

export async function removeVip(broadcasterId: string, userId: string, accessToken: string): Promise<void> {
  const response = await fetch(
    `https://api.twitch.tv/helix/channels/vips?broadcaster_id=${encodeURIComponent(broadcasterId)}&user_id=${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': config.clientId,
      },
    },
  );
  if (response.status !== 204) {
    const data = await response.json();
    console.error(`Failed to remove VIP for user ${userId}:`, data);
  }
}

export async function registerWebhookEventSubListeners(
  appToken: string,
  botUserId: string,
  channelUserId: string,
  callbackUrl: string,
  secret: string,
): Promise<void> {
  const transport = { method: 'webhook', callback: callbackUrl, secret };

  const subscriptions = [
    { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: channelUserId, user_id: botUserId } },
    { type: 'stream.online', version: '1', condition: { broadcaster_user_id: channelUserId } },
    { type: 'stream.offline', version: '1', condition: { broadcaster_user_id: channelUserId } },
  ];

  for (const sub of subscriptions) {
    const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appToken}`,
        'Client-Id': config.clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...sub, transport }),
    });

    if (response.status !== 202) {
      const data = await response.json();
      console.error(`Failed to subscribe to ${sub.type}. Status:`, response.status);
      console.error(data);
      process.exit(1);
    } else {
      const data = await response.json() as { data: Array<{ id: string }> };
      console.log(`Subscribed to ${sub.type} [${data.data[0].id}]`);
    }
  }
}

export async function registerWebhookRedemptionListener(
  appToken: string,
  broadcasterId: string,
  callbackUrl: string,
  secret: string,
): Promise<void> {
  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Client-Id': config.clientId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: 'webhook', callback: callbackUrl, secret },
    }),
  });

  if (response.status !== 202) {
    const data = await response.json();
    console.error('Failed to subscribe to channel.channel_points_custom_reward_redemption.add. Status:', response.status);
    console.error(data);
  } else {
    const data = await response.json() as { data: Array<{ id: string }> };
    console.log(`Subscribed to channel.channel_points_custom_reward_redemption.add [${data.data[0].id}]`);
  }
}
