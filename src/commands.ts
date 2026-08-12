import { incrementCount } from './counters';
import { lookupUserId, getChannelInfo, getFollowInfo } from './twitchApi';
import { loadVipStealConfig, simulateVipStealRedemption, getVipHolders } from './vipSteal';
import { fakeVipSimulator } from './vipStealSimulator';
import { db } from './db';
import { config } from './config';

export interface CommandContext {
  sender: string;                                        // chatter's display name
  senderId: string;                                      // chatter's user ID
  args: string[];                                        // words after the command
  isModerator: boolean;                                  // true for mods and the broadcaster
  isDebug: boolean;                                      // true when the message is from the debug channel
  say: (text: string) => Promise<boolean>;               // send a message to the channel
  getToken: () => Promise<string>;                       // resolve a valid bot access token
  getBroadcasterToken?: () => Promise<string>;           // resolve a valid broadcaster access token
  primaryBroadcasterId?: string;                         // user ID of the primary channel
}

type CommandHandler = (ctx: CommandContext) => Promise<boolean | void> | void;

interface CommandDefinition {
  handler: CommandHandler;
  cooldownSeconds?: number;  // 0 or undefined = no limit
  moderatorOnly?: boolean;
  debugOnly?: boolean;       // silently ignored on the primary channel
}

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

const commands: Record<string, CommandDefinition> = {
  youtube: {
    handler: ({ say }) =>
      say('Check out our VODs on https://www.youtube.com/@ShiroiiAmeVODs'),
  },

  discord: {
    handler: ({ say }) =>
      say('Join us at https://discord.gg/YZHkFpQZYV'),
  },

  dice: {
    handler: ({ say }) =>
      say('shiroi84Crimbo Hey I heard you have some dice in your pockets shiroi84Crimbo'),
  },

  beacon: {
    handler: ({ say }) =>
      say('shiroi84Crimbo a new hand touches the beacon shiroi84Crimbo'),
  },

  raid1: {
    handler: ({ say }) =>
      say('shiroi84Foxbop Can\'t dodge this tail swipe! shiroi84Foxbop Can\'t dodge this tail swipe! shiroi84Foxbop Can\'t dodge this tail swipe! shiroi84Foxbop'),
  },

  raid2: {
    handler: ({ say }) =>
      say('twitchRaid Can\'t dodge this raid! twitchRaid twitchRaid Can\'t dodge this raid! twitchRaid twitchRaid Can\'t dodge this raid! twitchRaid'),
  },

  farkle: {
    handler: ({ sender, say }) => {
      const dice = Array.from({ length: 6 }, () => roll(1, 6));
      const score = scoreFarkle(dice);
      const diceStr = dice.join(', ');
      if (score === 0) {
        return say(`${sender} rolled ${diceStr} - FARKLE! 0 points!`);
      }
      return say(`${sender} rolled ${diceStr} and scored ${score.toLocaleString()} points!`);
    },
  },

  brain: {
    handler: ({ sender, say }) =>
      say(`${sender} is operating at ${roll(1, 100)}% brain power!`),
  },

  cookie: {
    handler: async ({ sender, say }) => {
      const pick = await cookieList.random();
      return say(`${sender} has been given ${pick}! shiroi84Foxhappy`);
    },
    cooldownSeconds: 300,
  },

  crimbo: {
    handler: ({ sender, say }) =>
      say(`${sender} is going to prague`),
  },

  owlbear: {
    handler: ({ sender, say }) =>
      say(`${sender} votes to adopt Sir Naughten McFluffle Bottom the Third Mr. Floofy Goober Dude CocoMittenPaw BearOwl!`),
  },

  cheesecake: {
    handler: ({ sender, say }) =>
      say(`${sender} gives Shiroi cheesecake, but she hates cheesecake and throws it back in your face! Make sure you chew shiroi84Foxangry`),
  },

  icecream: {
    handler: ({ sender, say }) => {
      const flavours = [
        'Vanilla Bean',
        'Chocolate Fudge',
        'Strawberry Swirl',
        'Mint Choc Chip',
        'Cookies & Cream',
        'Salted Caramel',
        'Cookie Dough',
        'Rocky Road',
        'Pistachio',
        'Bubblegum',
        'Mango Sorbet',
        'Lemon Sherbet',
        'Honeycomb Crunch',
        'Black Sesame',
        'Matcha Green Tea',
        'Peanut Butter Cup',
        'Banana Split',
        'Cherry Garcia',
        'Blueberry Cheesecake',
        'Lavender Honey',
        'Toasted Coconut',
        'Raspberry Ripple',
        'Brownie Batter',
        'Cotton Candy',
        'Rum Raisin',
        'Peach Cobbler',
        'Cinnamon Roll',
        'Birthday Cake',
      ];
      const pick = flavours[Math.floor(Math.random() * flavours.length)];
      return say(`${sender} gets a scoop of ${pick} ice cream! Enjoy! shiroi84Foxhappy`);
    },
    cooldownSeconds: 300,
  },

  lurk: {
    handler: ({ sender, say }) =>
      say(`${sender}! How dare you attempt to hide in the shadows! I demand your full attention! Get baaaaaack here! shiroi84Foxangry`),
  },

  crime: { handler: ({ say }) => say(`Shiroi has committed ${incrementCount('crime')} crimes`), },
  pet: { handler: ({ say }) => say(`Pixel has been pet ${incrementCount('pet')} times`), cooldownSeconds: 3600 },
  feed: { handler: ({ say }) => say(`Pixel has been fed ${incrementCount('feed')} times`), cooldownSeconds: 3600 },
  scammed: { handler: ({ say }) => say(`Shiroi has been scammed ${incrementCount('scammed')} times`), },
  lost: { handler: ({ say }) => say(`Shiroi has gotten lost ${incrementCount('lost')} times`), },
  fine: { handler: ({ say }) => say(`Shiroi was fine ${incrementCount('fine')} times`), },
  accuse: { handler: ({ say }) => say(`Clevvur has accused Shiroi of ${incrementCount('accuse')} things`), },
  box: { handler: ({ say }) => say(`Streamer has said she loves Yellow Boxes ${incrementCount('box')} times`), },

  followerage: {
    handler: async ({ sender, senderId, args, say, getToken, getBroadcasterToken, primaryBroadcasterId }) => {
      const token = await getToken();
      const target = args[0]?.replace(/^@/, '') || null;

      let userId: string;
      let displayName: string;

      if (target) {
        const user = await lookupUserId(target.toLowerCase(), token).catch(() => null);
        if (!user) return say(`Couldn't find user "${target}".`);
        userId = user.id;
        displayName = user.displayName;
      } else {
        userId = senderId;
        displayName = sender;
      }

      if (!getBroadcasterToken) return say('Broadcaster token not available.');
      const broadcasterToken = await getBroadcasterToken();
      const follow = await getFollowInfo(primaryBroadcasterId!, userId, broadcasterToken);
      if (!follow) return say(`${displayName} is not following the channel.`);

      const followDate = new Date(follow.followed_at);
      const now = new Date();

      let years = now.getFullYear() - followDate.getFullYear();
      let months = now.getMonth() - followDate.getMonth();
      let days = now.getDate() - followDate.getDate();
      if (days < 0) { months--; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
      if (months < 0) { years--; months += 12; }

      const parts: string[] = [];
      if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
      if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
      if (days > 0 || parts.length === 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

      const d = String(followDate.getDate()).padStart(2, '0');
      const m = String(followDate.getMonth() + 1).padStart(2, '0');
      const y = followDate.getFullYear();

      return say(`${displayName} has been following for ${parts.join(', ')} (since ${d}/${m}/${y})!`);
    },
  },

  addquote: {
    handler: async ({ args, say, getToken, primaryBroadcasterId }) => {
      const text = args.join(' ').trim();
      if (!text) return say('Usage: !addquote <quote text>');

      const token = await getToken();
      const info = await getChannelInfo(primaryBroadcasterId!, token);
      const game = info?.game_name || 'Unknown Game';

      const result = db.prepare('INSERT INTO quotes (text, game, added_at) VALUES (?, ?, ?)').run(text, game, Date.now());
      return say(`Quote #${result.lastInsertRowid} added!`);
    },
  },

  quote: {
    handler: async ({ say, getToken }) => {
      const row = db.prepare('SELECT id, text, game, added_at FROM quotes ORDER BY RANDOM() LIMIT 1').get() as
        | { id: number; text: string; game: string; added_at: number }
        | undefined;
      if (!row) return say('No quotes saved yet!');

      const token = await getToken();
      const streamer = await lookupUserId(config.chatChannel, token);

      const d = new Date(row.added_at);
      const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      return say(`${streamer.displayName} said "${row.text}" on ${dateStr} whilst playing ${row.game}`);
    },
  },

  lookupquote: {
    moderatorOnly: true,
    handler: async ({ args, say, getToken }) => {
      const id = args[0] ? parseInt(args[0], 10) : null;
      const row = id
        ? db.prepare('SELECT id, text, game, added_at FROM quotes WHERE id = ?').get(id) as { id: number; text: string; game: string; added_at: number } | undefined
        : db.prepare('SELECT id, text, game, added_at FROM quotes ORDER BY RANDOM() LIMIT 1').get() as { id: number; text: string; game: string; added_at: number } | undefined;

      if (!row) return say(id ? `No quote found with ID #${id}.` : 'No quotes saved yet!');

      const token = await getToken();
      const streamer = await lookupUserId(config.chatChannel, token);
      const d = new Date(row.added_at);
      const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      return say(`[#${row.id}] ${streamer.displayName} said "${row.text}" on ${dateStr} whilst playing ${row.game}`);
    },
  },

  delquote: {
    moderatorOnly: true,
    handler: ({ args, say }) => {
      const id = parseInt(args[0], 10);
      if (!id) return say('Usage: !delquote <id>');
      const result = db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
      if (result.changes === 0) return say(`No quote found with ID #${id}.`);
      return say(`Quote #${id} deleted.`);
    },
  },

  weakness: {
    handler: async ({ sender, args, say, getToken }) => {
      const text = args.join(' ').trim();
      if (!text) return say('Usage: !weakness <weakness>');

      const token = await getToken();
      const streamer = await lookupUserId(config.chatChannel, token);

      db.prepare('INSERT INTO weaknesses (text, added_at) VALUES (?, ?)').run(text, Date.now());
      return say(`${sender} has a theory that ${streamer.displayName} is weak to ${text}`);
    },
  },

  saveme: {
    handler: async ({ say, getToken }) => {
      const row = db.prepare('SELECT text FROM weaknesses ORDER BY RANDOM() LIMIT 1').get() as
        | { text: string }
        | undefined;
      if (!row) return say('No weaknesses saved yet!');

      const token = await getToken();
      const streamer = await lookupUserId(config.chatChannel, token);

      return say(`Protect yourself! Remember that ${streamer.displayName} is weak to ${row.text}! Spam it now!`);
    },
  },

  lookupweakness: {
    moderatorOnly: true,
    handler: ({ args, say }) => {
      const id = args[0] ? parseInt(args[0], 10) : null;
      const row = id
        ? db.prepare('SELECT id, text FROM weaknesses WHERE id = ?').get(id) as { id: number; text: string } | undefined
        : db.prepare('SELECT id, text FROM weaknesses ORDER BY RANDOM() LIMIT 1').get() as { id: number; text: string } | undefined;

      if (!row) return say(id ? `No weakness found with ID #${id}.` : 'No weaknesses saved yet!');
      return say(`[#${row.id}] ${row.text}`);
    },
  },

  delweakness: {
    moderatorOnly: true,
    handler: ({ args, say }) => {
      const id = parseInt(args[0], 10);
      if (!id) return say('Usage: !delweakness <id>');
      const result = db.prepare('DELETE FROM weaknesses WHERE id = ?').run(id);
      if (result.changes === 0) return say(`No weakness found with ID #${id}.`);
      return say(`Weakness #${id} deleted.`);
    },
  },

  so: {
    moderatorOnly: true,
    handler: async ({ args, say, getToken }) => {
      const target = args[0]?.replace(/^@/, '').toLowerCase();
      if (!target) return say('Usage: !so <channel>');

      const token = await getToken();
      const user = await lookupUserId(target, token).catch(() => null);
      if (!user) return say(`Couldn't find Twitch user "${target}".`);

      const info = await getChannelInfo(user.id, token);
      const game = info?.game_name || 'something awesome';
      return say(`Check out ${user.displayName}, they are playing ${game} at https://twitch.tv/${user.login}`);
    },
  },
  "8ball": {
    handler: ({ say }) => {
      const pixelResponses = [
        "Yep!",
        "Totally!",
        "Uh-huh!",
        "Big yes vibes!",
        "Do it!",
        "Sounds like a yes to me!",
        "Super duper yes!",
        "Ask again, I'm busy playing!",
        "Hmm... try again later!",
        "My crystal ball is sleepy!",
        "I forgot, ask again!",
        "Maybe maybe maybe!",
        "I'll think about it... later!",
        "Can you repeat that?",
        "Nope nope nope!",
        "Not today, sorry!",
        "I don't think so!",
        "That's a silly idea!",
        "My answer is a tiny no!",
        "Chances look good!",
        "You might get lucky!",
        "Something fun is coming!",
        "Surprise ahead!",
        "Follow your gut feeling!",
        "Oops, not the right time!",
        "Careful, it's a bit tricky!",
        "Try a different way!",
        "Go for it, little hero!",
        "Patience, please!",
        "NO!!!!!!",
        "Don't do it...",
        "No no no no no",
        "I think that's a bad idea...",
        "I'm chasing my tails right now",
        "I demand headpats, not questions!",
        "Did you bring snacks?",
        "Fox nap time zzz...",
        "Head empty, just floof!",
        "Shh... I'm sneaking!",
      ];
      const letMeAskResponses = [
        'Let me ask yellow box for you',
      ];
      const yellowBoxResponses = [
        'Yellow box says: Yes!',
        'Yellow box says: No!',
        'Yellow box says: Maybe!',
      ];
      const mergedResponses = pixelResponses.concat(letMeAskResponses);
      const response = mergedResponses[Math.floor(Math.random() * mergedResponses.length)];
      if (letMeAskResponses.includes(response)) {
        return say(response).then(() => {
          setTimeout(() => {
            const yellowBoxResponse = yellowBoxResponses[Math.floor(Math.random() * yellowBoxResponses.length)];
            say(yellowBoxResponse);
          }, 2000);
        });
      }
      return say(response);
    }
  },

  testvip: {
    debugOnly: true,
    handler: async ({ sender, args, say }) => {
      const target = args[0]?.replace(/^@/, '') || sender;
      const vipConfig = loadVipStealConfig();
      if (!vipConfig) return say('VIP steal is not configured.');
      const result = await simulateVipStealRedemption(target, vipConfig);
      return say(result);
    },
  },

  viplist: {
    debugOnly: true,
    handler: ({ say }) => {
      const vipConfig = loadVipStealConfig();
      const holders = getVipHolders();
      if (holders.length === 0) return say(`No VIP steal holders (0/${vipConfig?.maxVips ?? '?'}).`);
      const list = holders.map((h) => {
        const date = new Date(h.added_at);
        const d = String(date.getDate()).padStart(2, '0');
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const y = String(date.getFullYear()).slice(2);
        return `${h.user_login} (${d}/${m}/${y})`;
      }).join(', ');
      return say(`VIP steal holders (${holders.length}/${vipConfig?.maxVips ?? '?'}): ${list}`);
    },
  },

  fakevip: {
    debugOnly: true,
    handler: async ({ sender, args, say }) => {
      const vipConfig = loadVipStealConfig();
      if (!vipConfig) return say('VIP steal is not configured.');
      const sub = args[0]?.toLowerCase();
      if (sub === 'list') {
        const holders = fakeVipSimulator.getHolders();
        if (holders.length === 0) return say(`No fake VIP holders (0/${vipConfig.maxVips}).`);
        return say(`Fake VIPs (${holders.length}/${vipConfig.maxVips}): ${holders.map((h) => h.userLogin).join(', ')}`);
      }
      if (sub === 'reset') {
        fakeVipSimulator.reset();
        return say('Fake VIP store cleared.');
      }
      const target = args[0]?.replace(/^@/, '') || sender;
      return say(fakeVipSimulator.simulate(target, vipConfig));
    },
  },
};

const commandLastUsed = new Map<string, number>();

export async function handleCommand(name: string, ctx: CommandContext): Promise<void> {
  const lname = name.toLowerCase();
  let def = commands[lname];

  if (!def) {
    const diceMatch = lname.match(/^d(\d+)$/);
    if (diceMatch) {
      const sides = parseInt(diceMatch[1], 10);
      def = {
        handler: ({ sender, say }) => say(`${sender} rolled ${roll(1, sides)}!`),
      };
    } else {
      return;
    }
  }

  if (def.debugOnly && !ctx.isDebug) return;
  if (def.moderatorOnly && !ctx.isModerator && !ctx.isDebug) return;

  const cooldown = def.cooldownSeconds ?? 0;
  if (cooldown > 0) {
    const key = `${lname}:${ctx.sender.toLowerCase()}`;
    const lastUsed = commandLastUsed.get(key);
    if (lastUsed && Date.now() - lastUsed < cooldown * 1000) {
      const remaining = Math.ceil((cooldown * 1000 - (Date.now() - lastUsed)) / 1000);
      console.log(`Command !${lname} used by ${ctx.sender} is on cooldown for ${remaining} more seconds.`);
      return;
    }

    let sayAttempted = false;
    let saySucceeded = false;
    const wrappedCtx: CommandContext = {
      ...ctx,
      say: async (text) => {
        sayAttempted = true;
        const ok = await ctx.say(text);
        if (ok) saySucceeded = true;
        return ok;
      },
    };

    try {
      await def.handler(wrappedCtx);
    } catch (err) {
      console.error(`Error handling !${name}:`, err);
    }

    if (!sayAttempted || saySucceeded) {
      commandLastUsed.set(key, Date.now());
    }
    return;
  }

  try {
    await def.handler(ctx);
  } catch (err) {
    console.error(`Error handling !${name}:`, err);
  }
}
