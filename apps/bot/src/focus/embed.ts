import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from 'discord.js';
import type { FocusSession, FocusParticipant, User } from '@yap/db';

type SessionWithParticipants = FocusSession & {
  participants: (FocusParticipant & { user: User })[];
  owner: User;
};

export function buildSessionEmbed(session: SessionWithParticipants): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const isLobby  = session.status === 'LOBBY';
  const isActive = session.status === 'ACTIVE';

  const participantList = session.participants
    .filter(p => p.leftAt === null)
    .map(p => `<@${p.userId}>`)
    .join(' · ') || 'No participants yet';

  const endsAt = isActive && session.startedAt
    ? new Date(session.startedAt.getTime() + session.durationMins * 60_000)
    : null;

  const fields: APIEmbedField[] = [
    { name: 'Duration',     value: formatDuration(session.durationMins), inline: true },
    { name: 'Status',       value: isLobby ? '⏳ Waiting to start' : '🔥 In progress', inline: true },
    { name: `Participants (${session.participants.filter(p => p.leftAt === null).length})`, value: participantList },
  ];

  if (endsAt) {
    fields.push({ name: 'Ends', value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true });
  }

  const embed = new EmbedBuilder()
    .setTitle('📚 Focus Session')
    .setColor(isActive ? 0xa8ff3e : 0x7c6af7)
    .addFields(fields)
    .setFooter({ text: `Session · ${session.id.slice(0, 8)}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`focus_join_${session.id}`)
      .setLabel('Join Session')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isActive),
    new ButtonBuilder()
      .setCustomId(`focus_leave_${session.id}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`focus_start_${session.id}`)
      .setLabel('▶ Start')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isActive),
    new ButtonBuilder()
      .setCustomId(`focus_end_${session.id}`)
      .setLabel('End Session')
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h > 1 ? 's' : ''}`;
}
