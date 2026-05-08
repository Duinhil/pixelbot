import fs from 'fs';
import path from 'path';
import { db } from './db';
import { addVip, removeVip } from './twitchApi';

export interface VipStealConfig {
  enabled: boolean;
  rewardName: string;
  maxVips: number;
  stealStrategy: 'random' | 'fifo';
  vipDurationDays: number;
}

interface VipHolder {
  user_id: string;
  user_login: string;
  added_at: number;
}

export function loadVipStealConfig(): VipStealConfig | null {
  const configPath = path.join(__dirname, '..', 'vip-steal.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as VipStealConfig;
  } catch {
    console.error('Failed to parse vip-steal.json — VIP steal disabled.');
    return null;
  }
}

export async function simulateVipStealRedemption(
  userLogin: string,
  config: VipStealConfig,
): Promise<string> {
  const already = db
    .prepare('SELECT user_login FROM vip_steal_holders WHERE user_login = ? COLLATE NOCASE')
    .get(userLogin);
  if (already) return `@${userLogin} already holds a real VIP slot.`;

  const { count } = db.prepare('SELECT COUNT(*) as count FROM vip_steal_holders').get() as { count: number };
  if (count < config.maxVips) {
    return `Would grant VIP to @${userLogin} (${count + 1}/${config.maxVips} slots used).`;
  }

  const query =
    config.stealStrategy === 'fifo'
      ? 'SELECT user_login, added_at FROM vip_steal_holders ORDER BY added_at ASC LIMIT 1'
      : 'SELECT user_login, added_at FROM vip_steal_holders ORDER BY RANDOM() LIMIT 1';
  const victim = db.prepare(query).get() as { user_login: string; added_at: number };
  const note =
    config.stealStrategy === 'fifo'
      ? `(oldest, since ${new Date(victim.added_at).toLocaleDateString()})`
      : '(randomly selected)';
  return `Would steal VIP from @${victim.user_login} ${note} and give to @${userLogin}.`;
}

export async function expireVipHolders(
  broadcasterId: string,
  getBroadcasterToken: () => Promise<string>,
  config: VipStealConfig,
): Promise<void> {
  const cutoff = Date.now() - config.vipDurationDays * 24 * 60 * 60 * 1000;
  const expired = db
    .prepare('SELECT user_id, user_login FROM vip_steal_holders WHERE added_at < ?')
    .all(cutoff) as Array<{ user_id: string; user_login: string }>;

  if (expired.length === 0) return;

  const token = await getBroadcasterToken();
  for (const holder of expired) {
    await removeVip(broadcasterId, holder.user_id, token);
    db.prepare('DELETE FROM vip_steal_holders WHERE user_id = ?').run(holder.user_id);
    console.log(`[vip-steal] Expired VIP removed: ${holder.user_login}`);
  }
}

export async function handleVipStealRedemption(
  redeemerUserId: string,
  redeemerUserLogin: string,
  rewardTitle: string,
  broadcasterId: string,
  getBroadcasterToken: () => Promise<string>,
  say: (text: string) => Promise<unknown>,
  config: VipStealConfig,
): Promise<void> {
  if (rewardTitle !== config.rewardName) return;

  const already = db.prepare('SELECT user_id FROM vip_steal_holders WHERE user_id = ?').get(redeemerUserId);
  if (already) {
    await say(`@${redeemerUserLogin} you already hold a VIP slot from this redeem!`);
    return;
  }

  const { count } = db.prepare('SELECT COUNT(*) as count FROM vip_steal_holders').get() as { count: number };
  const token = await getBroadcasterToken();

  if (count < config.maxVips) {
    await addVip(broadcasterId, redeemerUserId, token);
    db.prepare('INSERT INTO vip_steal_holders (user_id, user_login, added_at) VALUES (?, ?, ?)').run(
      redeemerUserId, redeemerUserLogin, Date.now(),
    );
    await say(`@${redeemerUserLogin} has been awarded VIP! shiroi84Foxbop`);
  } else {
    const query = config.stealStrategy === 'fifo'
      ? 'SELECT user_id, user_login, added_at FROM vip_steal_holders ORDER BY added_at ASC LIMIT 1'
      : 'SELECT user_id, user_login, added_at FROM vip_steal_holders ORDER BY RANDOM() LIMIT 1';
    const victim = db.prepare(query).get() as VipHolder;

    await removeVip(broadcasterId, victim.user_id, token);
    db.prepare('DELETE FROM vip_steal_holders WHERE user_id = ?').run(victim.user_id);
    await addVip(broadcasterId, redeemerUserId, token);
    db.prepare('INSERT INTO vip_steal_holders (user_id, user_login, added_at) VALUES (?, ?, ?)').run(
      redeemerUserId, redeemerUserLogin, Date.now(),
    );
    await say(`@${redeemerUserLogin} has stolen VIP from @${victim.user_login}! shiroi84Foxwut`);
  }
}
