import { ChannelType, type Guild, type VoiceState } from 'discord.js';
import { prisma } from '@yap/db';
import { updateMemberTierRole } from '../focus/roles.js';

// Resolved by NAME at startup rather than hardcoded, so moving the bot to another
// server doesn't silently stop time tracking and cam enforcement. Empty until
// loadVoiceChannels() runs on ClientReady.
export const STUDY_CHANNELS = new Set<string>();
export const CAM_REQUIRED_CHANNELS = new Set<string>();

export let WARNING_CHANNEL_ID = '';
export let AFK_CHANNEL_ID     = '';

const STUDY_NAME = /^cohort-\d+$/i;
const CAM_NAME   = /^cam-only-\d+$/i;

export async function loadVoiceChannels(guild: Guild): Promise<void> {
  const channels = await guild.channels.fetch();
  STUDY_CHANNELS.clear();
  CAM_REQUIRED_CHANNELS.clear();
  WARNING_CHANNEL_ID = '';
  AFK_CHANNEL_ID = '';

  for (const [, ch] of channels) {
    if (!ch) continue;
    const name = ch.name.toLowerCase();

    if (ch.type === ChannelType.GuildVoice) {
      // Cam-only rooms count as study time AND require a camera.
      if (CAM_NAME.test(name)) { STUDY_CHANNELS.add(ch.id); CAM_REQUIRED_CHANNELS.add(ch.id); }
      else if (STUDY_NAME.test(name)) STUDY_CHANNELS.add(ch.id);
      else if (name === 'afk') AFK_CHANNEL_ID = ch.id;
    } else if (ch.type === ChannelType.GuildText && name === 'cam-on-warnings') {
      WARNING_CHANNEL_ID = ch.id;
    }
  }

  console.log(
    `Loaded ${STUDY_CHANNELS.size} study channel(s), ${CAM_REQUIRED_CHANNELS.size} cam-required, ` +
    `warnings=${WARNING_CHANNEL_ID || 'MISSING'}, afk=${AFK_CHANNEL_ID || 'MISSING'}`,
  );
  if (!STUDY_CHANNELS.size) console.warn('WARNING: no study channels matched — no VC time will be tracked.');
  if (!WARNING_CHANNEL_ID) console.warn('WARNING: #cam-on-warnings not found — cam warnings cannot be sent.');
  if (!AFK_CHANNEL_ID) console.warn('WARNING: no AFK voice channel found — cam offenders cannot be moved.');
}
export const GRACE_PERIOD_MS    = 8 * 60 * 1000;
export const MOVE_DELAY_MS      = 4 * 60 * 1000;

const pendingWarnings = new Map<string, NodeJS.Timeout>();
const pendingMoves    = new Map<string, NodeJS.Timeout>();

export type WarnFn = (userId: string, channelId: string) => void | Promise<void>;
export type MoveFn = (userId: string) => void | Promise<void>;

export function hasPendingCamWarning(userId: string): boolean {
  return pendingWarnings.has(userId);
}

export function cancelCamWarning(userId: string): void {
  const t = pendingWarnings.get(userId);
  if (t) { clearTimeout(t); pendingWarnings.delete(userId); }
  const m = pendingMoves.get(userId);
  if (m) { clearTimeout(m); pendingMoves.delete(userId); }
}

function scheduleCamWarning(userId: string, channelId: string, warn: WarnFn, move: MoveFn): void {
  cancelCamWarning(userId);
  const t = setTimeout(() => {
    pendingWarnings.delete(userId);
    warn(userId, channelId);
    const m = setTimeout(() => {
      pendingMoves.delete(userId);
      move(userId);
    }, MOVE_DELAY_MS);
    pendingMoves.set(userId, m);
  }, GRACE_PERIOD_MS);
  pendingWarnings.set(userId, t);
}

type StateShape = Pick<VoiceState, 'channelId' | 'selfVideo' | 'streaming'> & {
  member: { id: string; user?: { username?: string; bot?: boolean } } | null;
};

export async function handleVoiceStateUpdate(
  oldState: StateShape,
  newState: StateShape,
  warn: WarnFn,
  move: MoveFn,
  guild?: Guild,
): Promise<void> {
  const userId   = newState.member?.id ?? oldState.member?.id;
  const username = newState.member?.user?.username ?? oldState.member?.user?.username;
  if (!userId) return;

  // Bots are exempt from everything here. A music bot parked in a voice channel
  // would otherwise be warned for having no camera and moved to AFK (killing
  // playback), and would quietly accrue study hours toward tier roles.
  const isBot = newState.member?.user?.bot ?? oldState.member?.user?.bot ?? false;
  if (isBot) return;

  const inMonitored = newState.channelId !== null && CAM_REQUIRED_CHANNELS.has(newState.channelId);
  const exempt      = newState.selfVideo || newState.streaming;

  if (inMonitored && !exempt) {
    scheduleCamWarning(userId, newState.channelId!, warn, move);
  } else {
    cancelCamWarning(userId);
  }

  await trackVcTime(userId, oldState.channelId, newState.channelId, guild, username);
}

async function trackVcTime(
  userId: string,
  oldChannelId: string | null,
  newChannelId: string | null,
  guild?: Guild,
  username?: string,
): Promise<void> {
  const leftStudy      = oldChannelId !== null && STUDY_CHANNELS.has(oldChannelId);
  const joinedStudy    = newChannelId !== null && STUDY_CHANNELS.has(newChannelId);
  const changedChannel = oldChannelId !== newChannelId;

  if (leftStudy && changedChannel) {
    const open = await prisma.vcSession.findFirst({
      where: { userId, channelId: oldChannelId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });
    if (open) {
      const now = new Date();
      const durationSecs = Math.floor((now.getTime() - open.joinedAt.getTime()) / 1000);
      await prisma.vcSession.update({
        where: { id: open.id },
        data: { leftAt: now, durationSecs },
      });

      if (guild) {
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const { _sum } = await prisma.vcSession.aggregate({
          where: { userId, leftAt: { not: null }, joinedAt: { gte: monthStart } },
          _sum: { durationSecs: true },
        });
        const monthlyHours = (_sum.durationSecs ?? 0) / 3600;
        await updateMemberTierRole(guild, userId, monthlyHours);
      }
    }
  }

  if (joinedStudy && changedChannel) {
    const name = username ?? userId;
    await prisma.user.upsert({
      where:  { id: userId },
      update: username ? { username } : {},
      create: { id: userId, username: name },
    });
    await prisma.vcSession.create({
      data: { userId, channelId: newChannelId! },
    });
  }
}
