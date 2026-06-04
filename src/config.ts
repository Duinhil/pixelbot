import 'dotenv/config';

interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
  chatChannel: string;         // primary channel login, resolved to user ID at startup
  debugChannel: string | null; // optional testing channel login
  webhookSecret: string;
  webhookCallbackUrl: string;
  authHost: string;            // hostname shown in auth URLs (default: localhost)
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const config: Config = {
  clientId: requireEnv('CLIENT_ID'),
  clientSecret: requireEnv('CLIENT_SECRET'),
  redirectUri: requireEnv('REDIRECT_URI'),
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  chatChannel: requireEnv('CHAT_CHANNEL'),
  debugChannel: process.env['DEBUG_CHANNEL']?.trim() || null,
  webhookSecret: requireEnv('WEBHOOK_SECRET'),
  webhookCallbackUrl: requireEnv('WEBHOOK_CALLBACK_URL'),
  authHost: (process.env['AUTH_HOST'] ?? `http://localhost:${parseInt(process.env['PORT'] ?? '3000', 10)}`).replace(/\/$/, ''),
};
