import type { Message } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getActiveSessionForChannel } from '../focus/session.js';
import { getLeaderboard, getMyStats, type TimeRange } from '../focus/stats.js';

const PREFIX = '.';

export function parsePrefix(
  content: string,
  prefix: string,
): { command: string; args: string[] } | null {
  if (!content.startsWith(prefix)) return null;
  const [rawCommand, ...args] = content.slice(prefix.length).trim().split(/\s+/);
  if (!rawCommand) return null;
  return { command: rawCommand.toLowerCase(), args: args.filter(Boolean) };
}

export async function handlePrefixCommand(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const parsed = parsePrefix(message.content, PREFIX);
  if (!parsed) return;

  const { command, args } = parsed;

  if (command === 'focus') {
    await handleFocus(message);
  } else if (command === 'leaderboard') {
    await handleLeaderboard(message, args);
  } else if (command === 'mystats') {
    await handleMystats(message);
  }
}

async function handleFocus(message: Message): Promise<void> {
  const existing = await getActiveSessionForChannel(message.channelId);
  if (existing) {
    await message.reply('There is already an active session in this channel. End it before starting a new one.');
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('focus_create_30').setLabel('30 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_45').setLabel('45 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_60').setLabel('1 hour').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_90').setLabel('90 min').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('focus_create_120').setLabel('2 hours').setStyle(ButtonStyle.Secondary),
  );

  await message.reply({ content: 'Choose a duration for your focus session:', components: [row] });
}

async function handleLeaderboard(message: Message, args: string[]): Promise<void> {
  const rangeMap: Record<string, TimeRange> = {
    week:  'this-week',
    month: 'this-month',
  };
  const range: TimeRange = rangeMap[args[0]?.toLowerCase() ?? ''] ?? 'all-time';
  const rows = await getLeaderboard(message.guildId!, range);

  const rangeLabel: Record<TimeRange, string> = {
    'all-time':   'All Time',
    'this-week':  'This Week',
    'this-month': 'This Month',
  };

  const description = rows.length === 0
    ? 'No focus sessions recorded yet. Start one with `.focus`!'
    : rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        const time  = r.totalMinutes >= 60
          ? `${Math.floor(r.totalMinutes / 60)}h ${r.totalMinutes % 60}m`
          : `${r.totalMinutes}m`;
        return `${medal} <@${r.userId}> — **${time}** (${r.sessionCount} sessions)`;
      }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`📊 Focus Leaderboard — ${rangeLabel[range]}`)
    .setDescription(description)
    .setColor(0xa8ff3e);

  await message.reply({ embeds: [embed] });
}

async function handleMystats(message: Message): Promise<void> {
  const stats = await getMyStats(message.guildId!, message.author.id);

  const timeStr = stats.totalMinutes >= 60
    ? `${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`
    : `${stats.totalMinutes} minutes`;

  const embed = new EmbedBuilder()
    .setTitle('Your Focus Stats')
    .setDescription(
      stats.sessionCount === 0
        ? "You haven't completed a focus session yet. Start one with `.focus`!"
        : `You've focused for **${timeStr}** across **${stats.sessionCount} sessions**.`,
    )
    .setColor(0x7c6af7);

  await message.reply({ embeds: [embed] });
}
