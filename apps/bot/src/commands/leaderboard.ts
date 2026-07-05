import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getLeaderboard, getTier, type TimeRange } from '../focus/stats.js';

export const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('See the study time leaderboard')
  .addStringOption(opt =>
    opt
      .setName('range')
      .setDescription('Time range')
      .setRequired(false)
      .addChoices(
        { name: 'All time',   value: 'all-time'   },
        { name: 'This week',  value: 'this-week'  },
        { name: 'This month', value: 'this-month' },
      ),
  );

export async function handleLeaderboardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const range = (interaction.options.getString('range') ?? 'this-month') as TimeRange;
  await interaction.deferReply();
  const rows = await getLeaderboard(range);

  const rangeLabel: Record<TimeRange, string> = {
    'all-time':   'All Time',
    'this-week':  'This Week',
    'this-month': 'This Month',
  };

  const description = rows.length === 0
    ? 'No study time recorded yet.'
    : rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        const hours = r.totalSecs / 3600;
        const tier  = getTier(hours);
        const timeStr = formatTime(r.totalSecs);
        return `${medal} <@${r.userId}> — **${timeStr}** ${tier.emoji}`;
      }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`📊 Study Leaderboard — ${rangeLabel[range]}`)
    .setDescription(description)
    .setColor(0xa8ff3e);

  await interaction.editReply({ embeds: [embed] });
}

export function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
