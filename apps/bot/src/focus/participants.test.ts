import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@yap/db';
import { createSession, startSession } from './session.js';
import { joinSession, leaveSession, closeAllParticipants } from './participants.js';

const GUILD_ID = 'test-guild-p';
const CHANNEL_ID = 'test-channel-p';
const OWNER_ID = 'test-owner-p';
const USER_ID = 'test-user-p';

beforeEach(async () => {
  await prisma.focusParticipant.deleteMany({ where: { session: { guildId: GUILD_ID } } });
  await prisma.focusSession.deleteMany({ where: { guildId: GUILD_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, USER_ID] } } });
  await prisma.guild.deleteMany({ where: { id: GUILD_ID } });

  await prisma.guild.create({ data: { id: GUILD_ID, name: 'Test Guild' } });
  await prisma.user.create({ data: { id: OWNER_ID, username: 'owner' } });
  await prisma.user.create({ data: { id: USER_ID,  username: 'joiner' } });
});

describe('joinSession', () => {
  it('creates a participant row for the user', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);

    const p = await prisma.focusParticipant.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: USER_ID } },
    });
    expect(p).not.toBeNull();
    expect(p?.leftAt).toBeNull();
  });

  it('is idempotent — joining twice does not throw', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    await expect(joinSession(session.id, USER_ID)).resolves.not.toThrow();
  });
});

describe('leaveSession', () => {
  it('sets leftAt and computes minutesFocused for an active session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    await startSession(session.id);

    // Simulate 10 minutes having passed by back-dating startedAt
    await prisma.focusSession.update({
      where: { id: session.id },
      data: { startedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const p = await leaveSession(session.id, USER_ID);
    expect(p.leftAt).not.toBeNull();
    expect(p.minutesFocused).toBeGreaterThanOrEqual(10);
  });

  it('sets minutesFocused to 0 if session has not started', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    const p = await leaveSession(session.id, USER_ID);
    expect(p.minutesFocused).toBe(0);
  });
});

describe('closeAllParticipants', () => {
  it('sets leftAt on all participants still in session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await joinSession(session.id, USER_ID);
    await startSession(session.id);
    await prisma.focusSession.update({
      where: { id: session.id },
      data: { startedAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    await closeAllParticipants(session.id);

    const participants = await prisma.focusParticipant.findMany({
      where: { sessionId: session.id },
    });
    participants.forEach(p => {
      expect(p.leftAt).not.toBeNull();
      expect(p.minutesFocused).toBeGreaterThanOrEqual(0);
    });
  });
});
