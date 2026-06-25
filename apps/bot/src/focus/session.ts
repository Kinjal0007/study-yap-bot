import { prisma } from '@yap/db';

interface CreateSessionInput {
  guildId: string;
  channelId: string;
  ownerId: string;
  durationMins: number;
}

export async function createSession(input: CreateSessionInput) {
  return prisma.focusSession.create({
    data: {
      guildId:      input.guildId,
      channelId:    input.channelId,
      ownerId:      input.ownerId,
      durationMins: input.durationMins,
      participants: {
        create: { userId: input.ownerId },
      },
    },
    include: { participants: true },
  });
}

export async function setSessionMessageId(sessionId: string, messageId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { messageId },
  });
}

export async function getActiveSessionForChannel(channelId: string) {
  return prisma.focusSession.findFirst({
    where: {
      channelId,
      status: { in: ['LOBBY' as const, 'ACTIVE' as const] },
    },
    orderBy: { id: 'asc' },
    include: { participants: { include: { user: true } }, owner: true },
  });
}

export async function startSession(sessionId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { status: 'ACTIVE' as const, startedAt: new Date() },
  });
}

export async function endSession(sessionId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { status: 'DONE' as const, endedAt: new Date() },
  });
}

export async function cancelSession(sessionId: string) {
  return prisma.focusSession.update({
    where: { id: sessionId },
    data:  { status: 'CANCELLED' as const, endedAt: new Date() },
  });
}
