import { config } from './config';
import { StoredTokens, saveTokens, saveBroadcasterTokens } from './auth/tokenStore';
import {
  validateToken,
  refreshAccessToken,
  sendChatMessage,
  lookupUserId,
  isStreamLive,
} from './twitchApi';
import { handleCommand } from './commands';
import { PeriodicMessageScheduler, loadPeriodicMessagesConfig } from './periodicMessages';
import { loadVipStealConfig, handleVipStealRedemption, expireVipHolders, VipStealConfig } from './vipSteal';
import { registerWebhookHandler, WebhookEventPayload } from './webhookServer';

const periodicScheduler = new PeriodicMessageScheduler(loadPeriodicMessagesConfig());

// --- Webhook event shapes ---

interface ChatMessageEvent {
  broadcaster_user_id: string;
  chatter_user_id: string;
  chatter_user_name: string;
  message: { text: string };
  badges: Array<{ set_id: string }>;
}

interface StreamEvent {
  broadcaster_user_id: string;
  broadcaster_user_name: string;
}

interface RedemptionEvent {
  broadcaster_user_id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  reward: { id: string; title: string; cost: number; prompt: string };
  status: string;
}

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

  const live = await isStreamLive(primaryChannelId, accessToken);
  if (live) {
    console.log(`[periodic] Stream already live on startup, starting scheduler for ${primaryChannelId}.`);
    periodicScheduler.start(async (text) => {
      const t = await getValidToken();
      await sendChatMessage(t, text, tokens.user_id, primaryChannelId);
    });
  }

  registerWebhookHandler((payload: WebhookEventPayload) => {
    const sub = payload.subscription.type;

    if (sub === 'stream.online') {
      const { broadcaster_user_id, broadcaster_user_name } = payload.event as unknown as StreamEvent;
      if (broadcaster_user_id !== primaryChannelId) return;
      console.log(`STREAM ONLINE #${broadcaster_user_name}`);
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
      const { broadcaster_user_id } = payload.event as unknown as StreamEvent;
      if (broadcaster_user_id !== primaryChannelId) return;
      console.log(`STREAM OFFLINE #${broadcaster_user_id}`);
      periodicScheduler.stop();

    } else if (sub === 'channel.chat.message') {
      const { broadcaster_user_id, chatter_user_id, chatter_user_name, message, badges } = payload.event as unknown as ChatMessageEvent;
      const isModerator = badges.some((b) => b.set_id === 'moderator' || b.set_id === 'lead_moderator' || b.set_id === 'broadcaster');
      const isDebug = broadcaster_user_id === debugChannelId;

      const [commandWord, ...args] = message.text.trim().split(/\s+/);
      if (commandWord.startsWith('!')) {
        handleCommand(commandWord.slice(1), {
          sender: chatter_user_name,
          senderId: chatter_user_id,
          args,
          isModerator,
          isDebug,
          say: async (text) => {
            const token = await getValidToken();
            return sendChatMessage(token, text, tokens.user_id, broadcaster_user_id);
          },
          getToken: getValidToken,
          getBroadcasterToken: broadcasterTokens ? getValidBroadcasterToken : undefined,
          primaryBroadcasterId: primaryChannelId,
        });
      }

    } else if (sub === 'channel.channel_points_custom_reward_redemption.add') {
      if (!broadcasterTokens || !vipStealConfig) return;
      const redemption = payload.event as unknown as RedemptionEvent;
      console.log(`Channel point redemption: "${redemption.reward.title}" by ${redemption.user_login}`);
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
    }
  });
}
