import express from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { exchangeCode, validateToken } from '../twitchApi';
import { StoredTokens, saveTokens, saveBroadcasterTokens, saveDebugBroadcasterTokens } from './tokenStore';

type AuthType = 'bot' | 'broadcaster' | 'debug_broadcaster';

interface StatePayload {
  nonce: string;
  type: AuthType;
}

function startAuthServerForType(type: AuthType, scope: string): Promise<StoredTokens> {
  return new Promise((resolve, reject) => {
    const app = express();
    let statePayload: StatePayload | undefined;

    const authRoute = type === 'bot' ? '/authorize' : type === 'broadcaster' ? '/authorize-broadcaster' : '/authorize-debug-broadcaster';

    app.get(authRoute, (_req, res) => {
      statePayload = { nonce: crypto.randomBytes(16).toString('hex'), type };
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope,
        state: JSON.stringify(statePayload),
      });
      res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
    });

    app.get('/callback', async (req, res) => {
      const { code, state, error } = req.query as Record<string, string>;

      if (error) {
        res.status(400).send(`OAuth error: ${error}`);
        reject(new Error(`OAuth denied: ${error}`));
        return;
      }

      let parsed: StatePayload;
      try {
        parsed = JSON.parse(state) as StatePayload;
      } catch {
        res.status(400).send('Invalid state parameter.');
        reject(new Error('State parse failed'));
        return;
      }

      if (!statePayload || parsed.nonce !== statePayload.nonce || parsed.type !== type) {
        res.status(400).send('Invalid state parameter.');
        reject(new Error('State mismatch — possible CSRF attempt'));
        return;
      }

      try {
        const tokenResponse = await exchangeCode(code);
        const expires_at = Date.now() + tokenResponse.expires_in * 1000;
        const validateData = await validateToken(tokenResponse.access_token);

        const stored: StoredTokens = {
          user_id: validateData.user_id,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          expires_at,
        };

        if (type === 'bot') {
          saveTokens(stored);
        } else if (type === 'broadcaster') {
          saveBroadcasterTokens(stored);
        } else {
          saveDebugBroadcasterTokens(stored);
        }

        res.send('Authorization successful — you can close this tab.');
        server.close();
        resolve(stored);
      } catch (err) {
        res.status(500).send('Token exchange failed. Check the console for details.');
        reject(err);
      }
    });

    const server = app.listen(config.port, () => {
      console.log(`Auth server listening on http://localhost:${config.port}`);
      console.log(`Open http://localhost:${config.port}${authRoute} to authorize.`);
    });

    server.on('error', reject);
  });
}

export function startAuthServer(): Promise<StoredTokens> {
  return startAuthServerForType('bot', 'user:bot user:read:chat user:write:chat');
}

export function startBroadcasterAuthServer(): Promise<StoredTokens> {
  return startAuthServerForType('broadcaster', 'channel:bot channel:read:redemptions channel:manage:vips moderator:read:followers');
}

export function startDebugBroadcasterAuthServer(): Promise<StoredTokens> {
  return startAuthServerForType('debug_broadcaster', 'channel:bot');
}
