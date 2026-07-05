import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@yap/db';
import { getLeaderboard, getMyStats } from './stats.js';

const USER_A = 'user-stats-a';
const USER_B = 'user-stats-b';
const CHANNEL = '1506364304486830163';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

beforeEach(async () => {
  await prisma.vcSession.deleteMany({ where: { userId: { in: [USER_A, USER_B] } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  await prisma.user.createMany({ data: [{ id: USER_A, username: 'alice' }, { id: USER_B, username: 'bob' }] });

  // Alice: 2h total (2 sessions of 1h each, 1 and 2 days ago)
  // Bob: 45min total (1 session, 3 days ago)
  await prisma.vcSession.createMany({
    data: [
      { userId: USER_A, channelId: CHANNEL, joinedAt: daysAgo(2), leftAt: daysAgo(2), durationSecs: 3600 },
      { userId: USER_A, channelId: CHANNEL, joinedAt: daysAgo(1), leftAt: daysAgo(1), durationSecs: 3600 },
      { userId: USER_B, channelId: CHANNEL, joinedAt: daysAgo(3), leftAt: daysAgo(3), durationSecs: 2700 },
    ],
  });
});

describe('getLeaderboard', () => {
  it('ranks users by total secs descending', async () => {
    const lb = await getLeaderboard('all-time');
    const a = lb.find(r => r.userId === USER_A);
    const b = lb.find(r => r.userId === USER_B);
    expect(a?.totalSecs).toBe(7200);
    expect(b?.totalSecs).toBe(2700);
    expect(lb.indexOf(a!)).toBeLessThan(lb.indexOf(b!));
  });

  it('filters by this-week', async () => {
    const lb = await getLeaderboard('this-week');
    const b = lb.find(r => r.userId === USER_B);
    expect(b?.totalSecs).toBe(2700);
  });

  it('excludes sessions older than 7 days from this-week', async () => {
    await prisma.vcSession.create({
      data: { userId: USER_A, channelId: CHANNEL, joinedAt: daysAgo(8), leftAt: daysAgo(8), durationSecs: 3600 },
    });
    const lb = await getLeaderboard('this-week');
    const a = lb.find(r => r.userId === USER_A);
    expect(a?.totalSecs).toBe(7200); // old session excluded
  });
});

describe('getMyStats', () => {
  it('returns correct totals for a user', async () => {
    const stats = await getMyStats(USER_A);
    expect(stats.allTimeSecs).toBe(7200);
  });

  it('returns zeros for a user with no sessions', async () => {
    const stats = await getMyStats('no-such-user');
    expect(stats.allTimeSecs).toBe(0);
    expect(stats.weeklySecs).toBe(0);
    expect(stats.monthlySecs).toBe(0);
  });
});
