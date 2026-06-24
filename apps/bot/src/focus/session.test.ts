import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@yap/db';
import {
  createSession,
  getActiveSessionForChannel,
  startSession,
  endSession,
  cancelSession,
  setSessionMessageId,
} from './session.js';

const GUILD_ID = 'test-guild-1';
const CHANNEL_ID = 'test-channel-1';
const OWNER_ID = 'test-owner-1';

beforeEach(async () => {
  await prisma.focusParticipant.deleteMany({ where: { session: { guildId: GUILD_ID } } });
  await prisma.focusSession.deleteMany({ where: { guildId: GUILD_ID } });
  await prisma.user.deleteMany({ where: { id: OWNER_ID } });
  await prisma.guild.deleteMany({ where: { id: GUILD_ID } });

  await prisma.guild.create({ data: { id: GUILD_ID, name: 'Test Guild' } });
  await prisma.user.create({ data: { id: OWNER_ID, username: 'testowner' } });
});

describe('createSession', () => {
  it('creates a session with LOBBY status', async () => {
    const session = await createSession({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      ownerId: OWNER_ID,
      durationMins: 60,
    });

    expect(session.status).toBe('LOBBY');
    expect(session.durationMins).toBe(60);
    expect(session.startedAt).toBeNull();
  });

  it('also joins the owner as a participant', async () => {
    const session = await createSession({
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      ownerId: OWNER_ID,
      durationMins: 60,
    });

    const participant = await prisma.focusParticipant.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: OWNER_ID } },
    });
    expect(participant).not.toBeNull();
  });
});

describe('getActiveSessionForChannel', () => {
  it('returns null when no session exists', async () => {
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result).toBeNull();
  });

  it('returns a LOBBY session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result?.id).toBe(session.id);
  });

  it('returns an ACTIVE session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await startSession(session.id);
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result?.status).toBe('ACTIVE');
  });

  it('returns null for a DONE session', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await startSession(session.id);
    await endSession(session.id);
    const result = await getActiveSessionForChannel(CHANNEL_ID);
    expect(result).toBeNull();
  });
});

describe('startSession', () => {
  it('sets status to ACTIVE and records startedAt', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    const started = await startSession(session.id);
    expect(started.status).toBe('ACTIVE');
    expect(started.startedAt).not.toBeNull();
  });
});

describe('endSession', () => {
  it('sets status to DONE and records endedAt', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    await startSession(session.id);
    const ended = await endSession(session.id);
    expect(ended.status).toBe('DONE');
    expect(ended.endedAt).not.toBeNull();
  });
});

describe('cancelSession', () => {
  it('sets status to CANCELLED', async () => {
    const session = await createSession({
      guildId: GUILD_ID, channelId: CHANNEL_ID, ownerId: OWNER_ID, durationMins: 60,
    });
    const cancelled = await cancelSession(session.id);
    expect(cancelled.status).toBe('CANCELLED');
  });
});
