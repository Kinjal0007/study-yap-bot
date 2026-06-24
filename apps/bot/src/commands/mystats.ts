import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getMyStats } from '../focus/stats.js';

export const mystatsCommand = new SlashCommandBuilder()
  .setName('mystats')
  .setDescription('See your own focus stats');

export async function handleMystatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const stats = await getMyStats(interaction.guildId, interaction.user.id);

  const timeStr = stats.totalMinutes >= 60
    ? `${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`
    : `${stats.totalMinutes} minutes`;

  const embed = new EmbedBuilder()
    .setTitle('Your Focus Stats')
    .setDescription(
      stats.sessionCount === 0
        ? "You haven't completed a focus session yet. Start one with `/focus`!"
        : `You've focused for **${timeStr}** across **${stats.sessionCount} sessions**.`,
    )
    .setColor(0x7c6af7);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
