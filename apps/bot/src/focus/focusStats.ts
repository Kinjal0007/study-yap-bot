import { prisma } from '@yap/db';
import type { TimeRange } from './stats.js';

function getStartDate(range: TimeRange): Date | undefined {
  if (range === 'all-time') return undefined;
  const now = new Date();
  if (range === 'this-week') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getLeaderboard(guildId: string, range: TimeRange) {
  const since = getStartDate(range);

  const rows = await prisma.focusParticipant.groupBy({
    by: ['userId'],
    where: {
      session: {
        guildId,
        status: 'DONE',
        completedNaturally: true,
        ...(since ? { startedAt: { gte: since } } : {}),
      },
    },
    _sum:   { minutesFocused: true },
    _count: { sessionId: true },
    orderBy: { _sum: { minutesFocused: 'desc' } },
    take: 10,
  });

  const userIds = rows.map(r => r.userId);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userMap = new Map(users.map(u => [u.id, u]));

  return rows.map(r => ({
    userId:       r.userId,
    username:     userMap.get(r.userId)?.username ?? 'Unknown',
    totalMinutes: r._sum.minutesFocused ?? 0,
    sessionCount: r._count.sessionId,
  }));
}
