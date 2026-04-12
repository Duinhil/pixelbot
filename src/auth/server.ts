import express from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { exchangeCode, validateToken } from '../twitchApi';
import { StoredTokens, saveTokens } from './tokenStore';

export function startAuthServer(): Promise<StoredTokens> {
  return new Promise((resolve, reject) => {
    const app = express();
    let stateToken: string | undefined;

    app.get('/authorize', (_req, res) => {
      stateToken = crypto.randomBytes(16).toString('hex');
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: 'user:bot user:read:chat user:write:chat',
        state: stateToken,
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

      if (!stateToken || state !== stateToken) {
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

        saveTokens(stored);
        res.send('Authorization successful — you can close this tab. The bot is starting.');
        server.close();
        resolve(stored);
      } catch (err) {
        res.status(500).send('Token exchange failed. Check the console for details.');
        reject(err);
      }
    });

    const server = app.listen(config.port, () => {
      console.log(`Auth server listening on http://localhost:${config.port}`);
      console.log(`Open http://localhost:${config.port}/authorize to authorize the bot.`);
    });

    server.on('error', reject);
  });
}
