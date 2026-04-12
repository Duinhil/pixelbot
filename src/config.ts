import 'dotenv/config';

interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
  chatChannels: string[]; // login names, resolved to user IDs at startup
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
  chatChannels: requireEnv('CHAT_CHANNELS').split(',').map((c) => c.trim()).filter(Boolean),
};
