import type { Guild, VoiceState } from 'discord.js';
import { prisma } from '@yap/db';
import { updateMemberTierRole } from '../focus/roles.js';

export const STUDY_CHANNELS = new Set([
  '1506430267735277598',
  '1506364304486830163',
  '1507012629246378087',
  '1510718409804087579',
]);

const CAM_REQUIRED_CHANNELS = new Set([
  '1506364304486830163',
  '1506430267735277598',
]);

export const WARNING_CHANNEL_ID = '1519444487259164926';
export const AFK_CHANNEL_ID     = '1506932478265397329';
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
  member: { id: string; user?: { username: string } } | null;
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
