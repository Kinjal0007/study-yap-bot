import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@yap/db';
import { getLeaderboard, getMyStats, TimeRange } from './stats.js';

const GUILD_ID = 'test-guild-s';
const USER_A = 'user-a';
const USER_B = 'user-b';

beforeEach(async () => {
  await prisma.focusParticipant.deleteMany({ where: { session: { guildId: GUILD_ID } } });
  await prisma.focusSession.deleteMany({ where: { guildId: GUILD_ID } });
  await prisma.user.deleteMany({ where: { id: { startsWith: 'extra-user-s-' } } });
  await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
  await prisma.guild.deleteMany({ where: { id: GUILD_ID } });

  await prisma.guild.create({ data: { id: GUILD_ID, name: 'Test Guild' } });
  await prisma.user.create({ data: { id: USER_A, username: 'alice' } });
  await prisma.user.create({ data: { id: USER_B, username: 'bob' } });

  // Seed: alice has 120 total minutes across 2 sessions, bob has 45
  const s1 = await prisma.focusSession.create({
    data: {
      guildId: GUILD_ID, channelId: 'ch1', ownerId: USER_A,
      durationMins: 60, status: 'DONE',
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      endedAt:   new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      messageId: 'msg1',
    },
  });
  const s2 = await prisma.focusSession.create({
    data: {
      guildId: GUILD_ID, channelId: 'ch1', ownerId: USER_A,
      durationMins: 60, status: 'DONE',
      startedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      endedAt:   new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
      messageId: 'msg2',
    },
  });
  const s3 = await prisma.focusSession.create({
    data: {
      guildId: GUILD_ID, channelId: 'ch1', ownerId: USER_B,
      durationMins: 45, status: 'DONE',
      startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      endedAt:   new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
      messageId: 'msg3',
    },
  });

  await prisma.focusParticipant.createMany({
    data: [
      { sessionId: s1.id, userId: USER_A, minutesFocused: 60, leftAt: s1.endedAt },
      { sessionId: s2.id, userId: USER_A, minutesFocused: 60, leftAt: s2.endedAt },
      { sessionId: s3.id, userId: USER_B, minutesFocused: 45, leftAt: s3.endedAt },
    ],
  });
});

describe('getLeaderboard', () => {
  it('ranks users by total minutesFocused descending', async () => {
    const lb = await getLeaderboard(GUILD_ID, 'all-time');
    expect(lb[0].userId).toBe(USER_A);
    expect(lb[0].totalMinutes).toBe(120);
    expect(lb[1].userId).toBe(USER_B);
    expect(lb[1].totalMinutes).toBe(45);
  });

  it('limits results to top 10', async () => {
    // Seed 9 extra users (on top of USER_A and USER_B = 11 total) each with 1 minute
    const extraUserIds = Array.from({ length: 9 }, (_, i) => `extra-user-s-${i}`);
    await prisma.user.createMany({
      data: extraUserIds.map(id => ({ id, username: id })),
    });
    const extraSessions = await Promise.all(
      extraUserIds.map(userId =>
        prisma.focusSession.create({
          data: {
            guildId: GUILD_ID, channelId: 'ch-extra', ownerId: userId,
            durationMins: 30, status: 'DONE',
            startedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
            endedAt:   new Date(Date.now() - 4 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
            messageId: 'msg-extra',
          },
        }),
      ),
    );
    await prisma.focusParticipant.createMany({
      data: extraSessions.map((s, i) => ({
        sessionId: s.id,
        userId: extraUserIds[i],
        minutesFocused: 1,
        leftAt: s.endedAt,
      })),
    });

    const lb = await getLeaderboard(GUILD_ID, 'all-time');
    expect(lb.length).toBe(10);
  });

  it('filters by this-week correctly', async () => {
    // USER_B session was 3 days ago, still within a week
    const lb = await getLeaderboard(GUILD_ID, 'this-week');
    const userB = lb.find(r => r.userId === USER_B);
    expect(userB?.totalMinutes).toBe(45);
  });

  it('excludes sessions older than 7 days from this-week', async () => {
    // USER_A sessions are 1 and 2 days old (within week), USER_B is 3 days old (within week)
    // Add a session 8 days ago — should be excluded
    const oldSession = await prisma.focusSession.create({
      data: {
        guildId: GUILD_ID, channelId: 'ch1', ownerId: USER_A,
        durationMins: 60, status: 'DONE',
        startedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        endedAt:   new Date(Date.now() - 8 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
        messageId: 'msg-old',
      },
    });
    await prisma.focusParticipant.create({
      data: {
        sessionId: oldSession.id, userId: USER_A,
        minutesFocused: 60, leftAt: oldSession.endedAt,
      },
    });

    const lb = await getLeaderboard(GUILD_ID, 'this-week');
    const userA = lb.find(r => r.userId === USER_A);
    // USER_A has 120 min within the week; the 60-min old session should NOT be included
    expect(userA?.totalMinutes).toBe(120);
  });
});

describe('getMyStats', () => {
  it('returns correct total minutes and session count for a user', async () => {
    const stats = await getMyStats(GUILD_ID, USER_A);
    expect(stats.totalMinutes).toBe(120);
    expect(stats.sessionCount).toBe(2);
  });

  it('returns zeros for a user with no sessions', async () => {
    const stats = await getMyStats(GUILD_ID, 'no-such-user');
    expect(stats.totalMinutes).toBe(0);
    expect(stats.sessionCount).toBe(0);
  });
});
