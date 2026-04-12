import { incrementCount } from './counters';
import { lookupUserId, getChannelInfo } from './twitchApi';

export interface CommandContext {
  sender: string;                          // chatter's display name
  args: string[];                          // words after the command
  say: (text: string) => Promise<void>;   // send a message to the channel
  getToken: () => Promise<string>;         // resolve a valid access token
}

type CommandHandler = (ctx: CommandContext) => Promise<void> | void;

function roll(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scoreFarkle(dice: number[]): number {
  const freq = new Array(7).fill(0) as number[];
  for (const d of dice) freq[d]++;

  // Full straight (1-2-3-4-5-6)
  if (freq.slice(1).every((f) => f === 1)) return 1500;

  let score = 0;

  // Partial straight (1-2-3-4-5)
  if ([1, 2, 3, 4, 5].every((n) => freq[n] >= 1)) {
    score += 500;
    [1, 2, 3, 4, 5].forEach((n) => freq[n]--);
  }
  // Partial straight (2-3-4-5-6)
  else if ([2, 3, 4, 5, 6].every((n) => freq[n] >= 1)) {
    score += 750;
    [2, 3, 4, 5, 6].forEach((n) => freq[n]--);
  }

  // Three or more of a kind
  for (let face = 1; face <= 6; face++) {
    if (freq[face] >= 3) {
      const base = face === 1 ? 1000 : face * 100;
      score += base * Math.pow(2, freq[face] - 3);
      freq[face] = 0;
    }
  }

  // Remaining single 1s and 5s
  score += freq[1] * 100;
  score += freq[5] * 50;

  return score;
}

const COOKIE_URL = 'https://pastebin.com/raw/jrBRihKe';
const COOKIE_TTL_MS = 60 * 60 * 1000; // 1 hour

const cookieList = {
  items: [] as string[],
  fetchedAt: 0,

  async random(): Promise<string> {
    if (this.items.length === 0 || Date.now() - this.fetchedAt > COOKIE_TTL_MS) {
      const text = await fetch(COOKIE_URL).then((r) => r.text());
      this.items = text.split('\n').map((l) => l.trim()).filter(Boolean);
      this.fetchedAt = Date.now();
    }
    return this.items[Math.floor(Math.random() * this.items.length)];
  },
};

const commands: Record<string, CommandHandler> = {
  youtube: ({ say }) =>
    say('Check out our VODs on https://www.youtube.com/@ShiroiiAmeVODs'),

  discord: ({ say }) =>
    say('Join us at https://discord.gg/YZHkFpQZYV'),

  dice: ({ say }) =>
    say('shiroi84Crimbo Hey I heard you have some dice in your pockets shiroi84Crimbo'),

  beacon: ({ say }) =>
    say('shiroi84Crimbo a new hand touches the beacon shiroi84Crimbo'),

  raid1: ({ say }) =>
    say('shiroi84Foxbop Can\'t dodge this tail swipe! shiroi84Foxbop Can\'t dodge this tail swipe! shiroi84Foxbop Can\'t dodge this tail swipe! shiroi84Foxbop'),

  raid2: ({ say }) =>
    say('twitchRaid Can\'t dodge this raid! twitchRaid twitchRaid Can\'t dodge this raid! twitchRaid twitchRaid Can\'t dodge this raid! twitchRaid'),

  farkle: ({ sender, say }) => {
    const dice = Array.from({ length: 6 }, () => roll(1, 6));
    const score = scoreFarkle(dice);
    const diceStr = dice.join(', ');
    if (score === 0) {
      return say(`${sender} rolled ${diceStr} - FARKLE! 0 points!`);
    }
    return say(`${sender} rolled ${diceStr} and scored ${score.toLocaleString()} points!`);
  },

  brain: ({ sender, say }) =>
    say(`${sender} is operating at ${roll(1, 100)}% brain power!`),

  cookie: async ({ sender, say }) => {
    const pick = await cookieList.random();
    return say(`${sender} has been given ${pick}! shiroi84Foxhappy`);
  },

  crimbo: ({ sender, say }) =>
    say(`${sender} is going to prague`),

  owlbear: ({ sender, say }) =>
    say(`${sender} votes to adopt Sir Naughten McFluffle Bottom the Third Mr. Floofy Goober Dude CocoMittenPaw BearOwl!`),

  cheesecake: ({ sender, say }) =>
    say(`${sender} gives Shiroi cheesecake, but she hates cheesecake and throws it back in your face! Make sure you chew shiroi84Foxangry`),

  lurk: ({ sender, say }) =>
    say(`${sender}! How dare you attempt to hide in the shadows! I demand your full attention! Get baaaaaack here! shiroi84Foxangry`),

  crime:   ({ say }) => say(`Shiroi has committed ${incrementCount('crime')} crimes`),
  pet:     ({ say }) => say(`Pixel has been pet ${incrementCount('pet')} times`),
  feed:    ({ say }) => say(`Pixel has been fed ${incrementCount('feed')} times`),
  scammed: ({ say }) => say(`Shiroi has been scammed ${incrementCount('scammed')} times`),
  fine:    ({ say }) => say(`Shiroi was fine ${incrementCount('fine')} times`),
  accuse:  ({ say }) => say(`Clevvur has accused Shiroi of ${incrementCount('accuse')} things`),
  box:     ({ say }) => say(`Streamer has said she loves Yellow Boxes ${incrementCount('box')} times`),

  so: async ({ args, say, getToken }) => {
    const target = args[0]?.replace(/^@/, '').toLowerCase();
    if (!target) return say('Usage: !so <channel>');

    const token = await getToken();
    const userId = await lookupUserId(target, token).catch(() => null);
    if (!userId) return say(`Couldn't find Twitch user "${target}".`);

    const info = await getChannelInfo(userId, token);
    const game = info?.game_name || 'something awesome';
    return say(`Check out ${target}, they are playing ${game} at https://twitch.tv/${target}`);
  },
};

export async function handleCommand(name: string, ctx: CommandContext): Promise<void> {
  const lname = name.toLowerCase();
  let handler = commands[lname];

  if (!handler) {
    const diceMatch = lname.match(/^d(\d+)$/);
    if (diceMatch) {
      const sides = parseInt(diceMatch[1], 10);
      handler = ({ sender, say }) => say(`${sender} rolled ${roll(1, sides)}!`);
    } else {
      return;
    }
  }

  try {
    await handler(ctx);
  } catch (err) {
    console.error(`Error handling !${name}:`, err);
  }
}
