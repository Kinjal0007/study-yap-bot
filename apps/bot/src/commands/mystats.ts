import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getMyStats, getTier, getNextTier } from '../focus/stats.js';
import { formatTime } from './leaderboard.js';

export const mystatsCommand = new SlashCommandBuilder()
  .setName('mystats')
  .setDescription('See your study stats');

export async function handleMystatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const stats = await getMyStats(interaction.user.id);
  const embed = buildStatsEmbed(interaction.user.id, stats);
  await interaction.editReply({ embeds: [embed] });
}

export function buildStatsEmbed(userId: string, stats: Awaited<ReturnType<typeof getMyStats>>, username?: string): EmbedBuilder {
  const monthlyHours = stats.monthlySecs / 3600;
  const tier     = getTier(monthlyHours);
  const nextTier = getNextTier(monthlyHours);
  const hoursToNext = nextTier ? nextTier.minHours - monthlyHours : 0;

  const now = new Date();
  const monthName = now.toLocaleString('en', { month: 'long' });

  const col1 = 12;
  const col2 = 10;

  const header = `${'Timeframe'.padEnd(col1)}${'Hours'.padEnd(col2)}Place`;
  const sep    = '─'.repeat(header.length);

  const row = (label: string, secs: number, rank: number) =>
    `${label.padEnd(col1)}${fh(secs).padEnd(col2)}#${rank}`;

  const block = [
    header,
    sep,
    row('Weekly:',  stats.weeklySecs,  stats.weeklyRank),
    row('Monthly:', stats.monthlySecs, stats.monthlyRank),
    row('All-time:', stats.allTimeSecs, stats.allTimeRank),
    '',
    `${tier.emoji} ${tier.name}${nextTier ? `  →  ${nextTier.emoji} ${nextTier.name} (${fh(Math.ceil(hoursToNext * 3600))} away)` : '  👑 Top tier!'}`,
    '',
    `${monthName} rank: #${stats.monthlyRank}`,
  ].join('\n');

  return new EmbedBuilder()
    .setTitle(`📚 Study Stats — ${username ?? userId}`)
    .setDescription(`\`\`\`\n${block}\n\`\`\``)
    .setColor(0x7c6af7);
}

function fh(secs: number): string {
  const h = secs / 3600;
  return h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(secs / 60)}m`;
}
