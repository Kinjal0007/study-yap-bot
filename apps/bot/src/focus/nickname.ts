import type { GuildMember } from 'discord.js';
import { prisma } from '@yap/db';

const PREFIX   = '[AFK] ';
const MAX_LEN  = 32;
const MAX_BASE = MAX_LEN - PREFIX.length; // 26

export function buildAFKNickname(baseName: string): string {
  return PREFIX + baseName.slice(0, MAX_BASE);
}

export async function applyAFKNickname(
  member: GuildMember,
  sessionId: string,
): Promise<void> {
  if (member.id === member.guild.ownerId) return;

  const original = member.nickname;
  const baseName = original ?? member.user.username;

  await prisma.focusParticipant.update({
    where: { sessionId_userId: { sessionId, userId: member.id } },
    data:  { originalNickname: original ?? '' },
  });

  await member.setNickname(buildAFKNickname(baseName)).catch(() => {});
}

export async function restoreNickname(
  member: GuildMember,
  originalNickname: string | null,
): Promise<void> {
  if (member.id === member.guild.ownerId) return;
  if (originalNickname === null) return;

  const restoreTo = originalNickname === '' ? null : originalNickname;
  await member.setNickname(restoreTo).catch(() => {});
}
