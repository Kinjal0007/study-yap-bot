import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { getActiveSessionForChannel, createSession, setSessionMessageId } from '../focus/session.js';
import { buildSessionEmbed } from '../focus/embed.js';
import { prisma } from '@yap/db';

export const focusCommand = new SlashCommandBuilder()
  .setName('focus')
  .setDescription('Start a group focus session')
  .addIntegerOption(opt =>
    opt
      .setName('duration')
      .setDescription('How long to focus (minutes)')
      .setRequired(true)
      .addChoices(
        { name: '30 minutes',  value: 30  },
        { name: '45 minutes',  value: 45  },
        { name: '60 minutes',  value: 60  },
        { name: '90 minutes',  value: 90  },
        { name: '2 hours',     value: 120 },
      ),
  );

export async function handleFocusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const existing = await getActiveSessionForChannel(interaction.channelId);
  if (existing) {
    await interaction.reply({
      content: 'There is already an active session in this channel. End it before starting a new one.',
      ephemeral: true,
    });
    return;
  }

  const durationMins = interaction.options.getInteger('duration', true);

  await prisma.guild.upsert({
    where:  { id: interaction.guildId },
    update: { name: interaction.guild?.name ?? 'Unknown' },
    create: { id: interaction.guildId, name: interaction.guild?.name ?? 'Unknown' },
  });

  await prisma.user.upsert({
    where:  { id: interaction.user.id },
    update: { username: interaction.user.username, avatar: interaction.user.avatar },
    create: { id: interaction.user.id, username: interaction.user.username, avatar: interaction.user.avatar },
  });

  const session = await createSession({
    guildId:      interaction.guildId,
    channelId:    interaction.channelId,
    ownerId:      interaction.user.id,
    durationMins,
  });

  const fullSession = await prisma.focusSession.findUniqueOrThrow({
    where: { id: session.id },
    include: { participants: { include: { user: true } }, owner: true },
  });

  const { embeds, components } = buildSessionEmbed(fullSession);
  const message = await interaction.reply({ embeds, components, fetchReply: true });
  await setSessionMessageId(session.id, message.id);
}
