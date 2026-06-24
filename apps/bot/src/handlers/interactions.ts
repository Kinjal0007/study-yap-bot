import type { ButtonInteraction, Client } from 'discord.js';
import { GuildMember, TextChannel } from 'discord.js';
import { prisma } from '@yap/db';
import { startSession, endSession, cancelSession, getActiveSessionForChannel, setSessionMessageId, createSession } from '../focus/session.js';
import { joinSession, leaveSession, closeAllParticipants } from '../focus/participants.js';
import { buildSessionEmbed } from '../focus/embed.js';
import { getBreakSuggestion } from '../focus/breaks.js';
import { scheduleSessionEnd, cancelSessionTimer } from '../focus/timer.js';
import { applyAFKNickname, restoreNickname } from '../focus/nickname.js';

export async function handleButtonInteraction(interaction: ButtonInteraction, client: Client): Promise<void> {
  const { customId } = interaction;

  if (!customId.startsWith('focus_')) return;

  const parts = customId.split('_');
  const action = parts[1];
  const sessionId = parts.slice(2).join('_');
  if (!action || !sessionId) return;

  if (action === 'create') {
    const durationMins = parseInt(sessionId, 10);
    if (isNaN(durationMins) || durationMins <= 0) return;
    if (!interaction.guildId || !interaction.channelId) return;

    const existing = await getActiveSessionForChannel(interaction.channelId);
    if (existing) {
      await interaction.reply({ content: 'There is already an active session in this channel.', ephemeral: true });
      return;
    }

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

    const newSession = await createSession({
      guildId:      interaction.guildId,
      channelId:    interaction.channelId,
      ownerId:      interaction.user.id,
      durationMins,
    });

    const fullSession = await prisma.focusSession.findUniqueOrThrow({
      where: { id: newSession.id },
      include: { participants: { include: { user: true } }, owner: true },
    });

    const { embeds, components } = buildSessionEmbed(fullSession);
    const msg = await interaction.reply({ embeds, components, fetchReply: true });
    await setSessionMessageId(newSession.id, msg.id);
    return;
  }

  const session = await prisma.focusSession.findUnique({
    where: { id: sessionId },
    include: { participants: { include: { user: true } }, owner: true },
  });

  if (!session) {
    await interaction.reply({ content: 'This session no longer exists.', ephemeral: true });
    return;
  }

  if (session.status === 'DONE' || session.status === 'CANCELLED') {
    await interaction.reply({ content: 'This session has already ended.', ephemeral: true });
    return;
  }

  await prisma.user.upsert({
    where:  { id: interaction.user.id },
    update: { username: interaction.user.username, avatar: interaction.user.avatar },
    create: { id: interaction.user.id, username: interaction.user.username, avatar: interaction.user.avatar },
  });

  if (action === 'join') {
    if (session.status === 'ACTIVE') {
      await interaction.reply({ content: 'The session has already started — you cannot join now.', ephemeral: true });
      return;
    }
    await joinSession(sessionId, interaction.user.id);

  } else if (action === 'leave') {
    if (session.ownerId === interaction.user.id) {
      cancelSessionTimer(sessionId);
      if (interaction.guild) {
        for (const p of session.participants) {
          const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
          if (member) await restoreNickname(member, p.originalNickname ?? null);
        }
      }
      await closeAllParticipants(sessionId);
      await cancelSession(sessionId);
      await interaction.update({ content: `Session ended — <@${interaction.user.id}> (the owner) left.`, embeds: [], components: [] });
      return;
    }
    await leaveSession(sessionId, interaction.user.id);
    if (interaction.member instanceof GuildMember) {
      const participant = session.participants.find(p => p.userId === interaction.user.id);
      await restoreNickname(interaction.member, participant?.originalNickname ?? null);
    }

  } else if (action === 'start') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can start it.', ephemeral: true });
      return;
    }
    if (session.status !== 'LOBBY') {
      await interaction.reply({ content: 'Session is already running.', ephemeral: true });
      return;
    }
    await startSession(sessionId);
    if (interaction.guild) {
      for (const p of session.participants) {
        const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
        if (member) await applyAFKNickname(member, sessionId);
      }
    }
    scheduleSessionEnd(sessionId, session.durationMins * 60_000, async () => {
      try {
        await closeAllParticipants(sessionId);
        await endSession(sessionId);
        const ended = await prisma.focusSession.findUnique({
          where: { id: sessionId },
          include: { participants: true },
        });
        if (ended && interaction.guild) {
          for (const p of ended.participants) {
            const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
            if (member) await restoreNickname(member, p.originalNickname ?? null);
          }
        }
        const ch = await client.channels.fetch(session.channelId).catch(() => null);
        if (ch instanceof TextChannel) {
          await ch.send(getBreakSuggestion(session.durationMins));
          const msg = await ch.messages.fetch(session.messageId).catch(() => null);
          if (msg) await msg.edit({ content: '✅ Session complete!', embeds: [], components: [] });
        }
      } catch (err) {
        console.error(`Timer callback failed for session ${sessionId}:`, err);
      }
    });

  } else if (action === 'end') {
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can end it.', ephemeral: true });
      return;
    }
    cancelSessionTimer(sessionId);
    if (interaction.guild) {
      for (const p of session.participants) {
        const member = await interaction.guild.members.fetch(p.userId).catch(() => null);
        if (member) await restoreNickname(member, p.originalNickname ?? null);
      }
    }
    await closeAllParticipants(sessionId);
    await endSession(sessionId);
    await interaction.update({ content: '✅ Session ended early.', embeds: [], components: [] });
    return;

  } else {
    return;
  }

  const updated = await prisma.focusSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { participants: { include: { user: true } }, owner: true },
  });
  const { embeds, components } = buildSessionEmbed(updated);
  await interaction.update({ embeds, components });
}
