import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getLeaderboard, type TimeRange } from '../focus/stats.js';

export const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('See the focus time leaderboard')
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
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const range = (interaction.options.getString('range') ?? 'all-time') as TimeRange;
  const rows  = await getLeaderboard(interaction.guildId, range);

  const rangeLabel: Record<TimeRange, string> = {
    'all-time':   'All Time',
    'this-week':  'This Week',
    'this-month': 'This Month',
  };

  const description = rows.length === 0
    ? 'No focus sessions recorded yet. Start one with `/focus`!'
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

  await interaction.reply({ embeds: [embed] });
}
