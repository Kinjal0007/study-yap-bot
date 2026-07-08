import type { Client, Message } from 'discord.js';
import { buildAFKNickname, restoreNickname } from './focus/nickname.js';

interface AfkEntry {
  reason: string;
  originalNickname: string | null;
}

const afkMap = new Map<string, AfkEntry>();

export function isAfk(userId: string): boolean {
  return afkMap.has(userId);
}

export async function setAfk(message: Message, reason: string): Promise<void> {
  const member = message.member;
  if (!member) return;

  const originalNickname = member.nickname;
  const baseName = originalNickname ?? member.user.username;

  afkMap.set(message.author.id, { reason, originalNickname: originalNickname ?? '' });

  await member.setNickname(buildAFKNickname(baseName)).catch(() => {});
  await message.reply(`You're now AFK: *${reason}*`);
}

export async function clearAfk(message: Message): Promise<void> {
  const entry = afkMap.get(message.author.id);
  if (!entry) return;

  afkMap.delete(message.author.id);

  if (message.member) {
    await restoreNickname(message.member, entry.originalNickname ?? null);
  }
  await message.reply(`Welcome back! Your AFK has been cleared.`).catch(() => {});
}

export async function handleAfkMentions(message: Message): Promise<void> {
  const mentioned = message.mentions.users;
  if (mentioned.size === 0) return;

  const replies: string[] = [];
  for (const [userId, user] of mentioned) {
    const entry = afkMap.get(userId);
    if (entry) {
      replies.push(`**${user.username}** is AFK: *${entry.reason}*`);
    }
  }

  if (replies.length > 0) {
    await message.reply(replies.join('\n'));
  }
}

export function registerAfkHandler(client: Client): void {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guildId) return;

    // If the message author is AFK, clear it (unless it's the -afk command itself)
    if (isAfk(message.author.id) && !message.content.startsWith('-afk')) {
      await clearAfk(message);
    }

    // Check if any mentioned users are AFK
    await handleAfkMentions(message);
  });
}
