import { prisma } from '@yap/db';

export type TimeRange = 'all-time' | 'this-week' | 'this-month';

export type Tier = {
  name: string;
  emoji: string;
  minHours: number;
  maxHours: number | null;
};

export const TIERS: Tier[] = [
  { name: 'Legend',        emoji: '🔴', minHours: 200, maxHours: null },
  { name: 'Voyager',       emoji: '🔴', minHours: 175, maxHours: 200  },
  { name: 'Expedition',    emoji: '🔴', minHours: 140, maxHours: 175  },
  { name: 'Pioneer',       emoji: '🔴', minHours: 100, maxHours: 140  },
  { name: 'Cartographer',  emoji: '🟠', minHours: 75,  maxHours: 100  },
  { name: 'Navigator',     emoji: '🟡', minHours: 50,  maxHours: 75   },
  { name: 'Trailblazer',   emoji: '🟢', minHours: 30,  maxHours: 50   },
  { name: 'Wayfarer',      emoji: '🟢', minHours: 16,  maxHours: 30   },
  { name: 'Pathfinder',    emoji: '🔵', minHours: 8,   maxHours: 16   },
  { name: 'Scout',         emoji: '🔵', minHours: 3,   maxHours: 8    },
  { name: 'Wanderer',      emoji: '⚪', minHours: 0.5, maxHours: 3    },
];

export function getTier(hours: number): Tier {
  return TIERS.find(t => hours >= t.minHours) ?? TIERS[TIERS.length - 1];
}

export function getNextTier(hours: number): Tier | null {
  const idx = TIERS.findIndex(t => hours >= t.minHours);
  return idx > 0 ? TIERS[idx - 1] : null;
}

function getStartDate(range: TimeRange): Date | undefined {
  if (range === 'all-time') return undefined;
  const now = new Date();
  if (range === 'this-week') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getLeaderboard(range: TimeRange) {
  const since = getStartDate(range);
  const now = new Date();

  const [closed, open] = await Promise.all([
    prisma.vcSession.groupBy({
      by: ['userId'],
      where: {
        leftAt: { not: null },
        ...(since ? { joinedAt: { gte: since } } : {}),
      },
      _sum: { durationSecs: true },
    }),
    prisma.vcSession.findMany({
      where: {
        leftAt: null,
        ...(since ? { joinedAt: { gte: since } } : {}),
      },
      select: { userId: true, joinedAt: true },
    }),
  ]);

  // Map closed secs per user
  const secsMap = new Map<string, number>();
  for (const r of closed) secsMap.set(r.userId, r._sum.durationSecs ?? 0);

  // Add live elapsed time for open sessions, capped at 12h to ignore stale/unclosed sessions
  const MAX_LIVE_SECS = 12 * 3600;
  for (const r of open) {
    const elapsed = Math.min(Math.floor((now.getTime() - r.joinedAt.getTime()) / 1000), MAX_LIVE_SECS);
    secsMap.set(r.userId, (secsMap.get(r.userId) ?? 0) + elapsed);
  }

  // Sort and take top 10
  const sorted = [...secsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const userIds = sorted.map(([id]) => id);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } } });
  const userMap = new Map(users.map(u => [u.id, u]));

  return sorted.map(([userId, totalSecs]) => ({
    userId,
    username:  userMap.get(userId)?.username ?? 'Unknown',
    totalSecs,
  }));
}

export async function getMyStats(userId: string) {
  const now = new Date();
  const weekStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [allTime, monthly, weekly, openSessions] = await Promise.all([
    prisma.vcSession.aggregate({ where: { userId, leftAt: { not: null } }, _sum: { durationSecs: true } }),
    prisma.vcSession.aggregate({ where: { userId, leftAt: { not: null }, joinedAt: { gte: monthStart } }, _sum: { durationSecs: true } }),
    prisma.vcSession.aggregate({ where: { userId, leftAt: { not: null }, joinedAt: { gte: weekStart  } }, _sum: { durationSecs: true } }),
    prisma.vcSession.findMany({ where: { userId, leftAt: null }, select: { joinedAt: true } }),
  ]);

  const MAX_LIVE_SECS = 12 * 3600;
  const liveElapsed = openSessions.reduce((sum, s) =>
    sum + Math.min(Math.floor((now.getTime() - s.joinedAt.getTime()) / 1000), MAX_LIVE_SECS), 0);

  const monthlySecs = (monthly._sum.durationSecs ?? 0) + liveElapsed;
  const weeklySecs  = (weekly._sum.durationSecs  ?? 0) + liveElapsed;
  const allTimeSecs = (allTime._sum.durationSecs  ?? 0) + liveElapsed;

  const [monthlyRank, weeklyRank, allTimeRank] = await Promise.all([
    prisma.vcSession.groupBy({
      by: ['userId'],
      where: { leftAt: { not: null }, joinedAt: { gte: monthStart } },
      _sum: { durationSecs: true },
      having: { durationSecs: { _sum: { gt: monthlySecs } } },
    }),
    prisma.vcSession.groupBy({
      by: ['userId'],
      where: { leftAt: { not: null }, joinedAt: { gte: weekStart } },
      _sum: { durationSecs: true },
      having: { durationSecs: { _sum: { gt: weeklySecs } } },
    }),
    prisma.vcSession.groupBy({
      by: ['userId'],
      where: { leftAt: { not: null } },
      _sum: { durationSecs: true },
      having: { durationSecs: { _sum: { gt: allTimeSecs } } },
    }),
  ]);

  return {
    allTimeSecs,
    monthlySecs,
    weeklySecs,
    monthlyRank:  monthlyRank.length + 1,
    weeklyRank:   weeklyRank.length  + 1,
    allTimeRank:  allTimeRank.length + 1,
  };
}
