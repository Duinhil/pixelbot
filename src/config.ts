import 'dotenv/config';

interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
  chatChannel: string; // login name, resolved to user ID at startup
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
};
