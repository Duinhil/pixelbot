import crypto from 'crypto';
import express, { Request, Response } from 'express';
import http from 'http';
import { config } from './config';

export interface WebhookEventPayload {
  subscription: { type: string };
  event: Record<string, unknown>;
}

interface ChallengePayload {
  subscription: { type: string };
  challenge: string;
}

type EventHandler = (payload: WebhookEventPayload) => void;

const handlers: EventHandler[] = [];

export function registerWebhookHandler(handler: EventHandler): void {
  handlers.push(handler);
}

function verifySignature(req: Request): boolean {
  const messageId = req.headers['twitch-eventsub-message-id'] as string | undefined;
  const timestamp = req.headers['twitch-eventsub-message-timestamp'] as string | undefined;
  const signature = req.headers['twitch-eventsub-message-signature'] as string | undefined;

  if (!messageId || !timestamp || !signature) return false;

  const rawBody = (req.body as Buffer).toString('utf-8');
  const expected = 'sha256=' + crypto
    .createHmac('sha256', config.webhookSecret)
    .update(messageId + timestamp + rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function startWebhookServer(): http.Server {
  const app = express();

  app.post('/eventsub', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
    if (!verifySignature(req)) {
      console.warn('[webhook] Rejected request: invalid HMAC signature');
      res.status(403).send('Forbidden');
      return;
    }

    const messageType = req.headers['twitch-eventsub-message-type'] as string;
    const body = JSON.parse((req.body as Buffer).toString('utf-8')) as WebhookEventPayload | ChallengePayload;

    if (messageType === 'webhook_callback_verification') {
      const { challenge, subscription } = body as ChallengePayload;
      console.log(`[webhook] Challenge received for ${subscription.type}`);
      res.status(200).setHeader('Content-Type', 'text/plain').send(challenge);
      return;
    }

    if (messageType === 'notification') {
      res.status(204).send();
      const payload = body as WebhookEventPayload;
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error('[webhook] Handler error:', err);
        }
      }
      return;
    }

    if (messageType === 'revocation') {
      res.status(204).send();
      console.warn(`[webhook] Subscription revoked: ${(body as WebhookEventPayload).subscription.type}`);
      return;
    }

    res.status(204).send();
  });

  const server = app.listen(config.port, () => {
    console.log(`[webhook] Server listening on port ${config.port}`);
  });

  server.on('error', (err) => {
    console.error('[webhook] Server error:', err);
    process.exit(1);
  });

  return server;
}
