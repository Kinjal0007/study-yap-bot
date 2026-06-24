import { prisma } from '@yap/db';

export async function joinSession(sessionId: string, userId: string) {
  return prisma.focusParticipant.upsert({
    where:  { sessionId_userId: { sessionId, userId } },
    update: {},
    create: { sessionId, userId },
  });
}

export async function leaveSession(sessionId: string, userId: string) {
  const existing = await prisma.focusParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
  });
  if (!existing || existing.leftAt !== null) return null;

  const session = await prisma.focusSession.findUnique({
    where: { id: sessionId },
    select: { startedAt: true },
  });

  const now = new Date();
  const minutesFocused =
    session?.startedAt
      ? Math.floor((now.getTime() - session.startedAt.getTime()) / 60_000)
      : 0;

  return prisma.focusParticipant.update({
    where: { sessionId_userId: { sessionId, userId } },
    data:  { leftAt: now, minutesFocused },
  });
}

export async function closeAllParticipants(sessionId: string) {
  const session = await prisma.focusSession.findUnique({
    where: { id: sessionId },
    select: { startedAt: true },
  });

  const now = new Date();
  const minutesFocused =
    session?.startedAt
      ? Math.floor((now.getTime() - session.startedAt.getTime()) / 60_000)
      : 0;

  await prisma.focusParticipant.updateMany({
    where: { sessionId, leftAt: null },
    data:  { leftAt: now, minutesFocused },
  });
}
