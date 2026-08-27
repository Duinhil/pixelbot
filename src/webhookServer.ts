import crypto from 'crypto';
import express, { Request, Response } from 'express';
import http from 'http';
import { config } from './config';
import { db } from './db';

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

interface LeaderboardRow {
  user_login: string;
  best_score: number;
  rolls: number;
  farkles: number;
}

function queryLeaderboard(cutoff: number): LeaderboardRow[] {
  return db.prepare(
    `SELECT user_login,
            MAX(score)                                   AS best_score,
            COUNT(*)                                     AS rolls,
            SUM(CASE WHEN score = 0 THEN 1 ELSE 0 END)  AS farkles
     FROM farkle_results
     WHERE rolled_at > ?
     GROUP BY user_id
     ORDER BY best_score DESC
     LIMIT 20`
  ).all(cutoff) as LeaderboardRow[];
}

function buildLeaderboardHtml(): string {
  const periods = [
    { label: 'Today',     cutoff: Date.now() - 86_400_000 },
    { label: 'This Week', cutoff: Date.now() - 604_800_000 },
    { label: 'All Time',  cutoff: 0 },
  ];

  const tables = periods.map(({ label, cutoff }) => {
    const rows = queryLeaderboard(cutoff);
    const rowsHtml = rows.length === 0
      ? '<tr><td colspan="4" style="text-align:center;color:#888">No scores yet</td></tr>'
      : rows.map((r, i) =>
          `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(r.user_login)}</td>
            <td>${r.best_score.toLocaleString()}</td>
            <td>${r.rolls} (${r.farkles} farkles)</td>
          </tr>`
        ).join('');
    return `
      <h2>${label}</h2>
      <table>
        <thead><tr><th>#</th><th>Player</th><th>Best Score</th><th>Rolls</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Farkle Leaderboard</title>
  <style>
    body { font-family: sans-serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem; background: #0e0e10; color: #efeff1; }
    h1 { color: #9147ff; }
    h2 { margin-top: 2rem; color: #bf94ff; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #2a2a2e; }
    th { color: #9147ff; }
    tr:hover td { background: #18181b; }
  </style>
</head>
<body>
  <h1>Farkle Leaderboard</h1>
  ${tables}
  <p style="color:#555;font-size:0.8rem;margin-top:2rem">Auto-refreshes every 30s</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function startWebhookServer(): http.Server {
  const app = express();

  app.get('/leaderboard/data', (req: Request, res: Response) => {
    const period = (req.query['period'] as string) || 'alltime';
    const cutoff = period === 'daily'  ? Date.now() - 86_400_000
                 : period === 'weekly' ? Date.now() - 604_800_000
                 : 0;
    res.json({ period, rows: queryLeaderboard(cutoff) });
  });

  app.get('/leaderboard', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html').send(buildLeaderboardHtml());
  });

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
