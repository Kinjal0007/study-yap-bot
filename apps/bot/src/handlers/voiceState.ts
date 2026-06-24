import type { VoiceState } from 'discord.js';

const CAM_REQUIRED_CHANNELS = new Set([
  '1506364304486830163',
  '1506430267735277598',
]);

export const WARNING_CHANNEL_ID = '1519444487259164926';
export const GRACE_PERIOD_MS    = 8 * 60 * 1000;

const pendingWarnings = new Map<string, NodeJS.Timeout>();

export type WarnFn = (userId: string, channelId: string) => void | Promise<void>;

export function hasPendingCamWarning(userId: string): boolean {
  return pendingWarnings.has(userId);
}

export function cancelCamWarning(userId: string): void {
  const t = pendingWarnings.get(userId);
  if (t) {
    clearTimeout(t);
    pendingWarnings.delete(userId);
  }
}

function scheduleCamWarning(userId: string, channelId: string, warn: WarnFn): void {
  cancelCamWarning(userId);
  const t = setTimeout(() => {
    pendingWarnings.delete(userId);
    warn(userId, channelId);
  }, GRACE_PERIOD_MS);
  pendingWarnings.set(userId, t);
}

type StateShape = Pick<VoiceState, 'channelId' | 'selfVideo' | 'streaming'> & {
  member: { id: string } | null;
};

export async function handleVoiceStateUpdate(
  oldState: StateShape,
  newState: StateShape,
  warn: WarnFn,
): Promise<void> {
  const userId = newState.member?.id ?? oldState.member?.id;
  if (!userId) return;

  const inMonitored = newState.channelId !== null && CAM_REQUIRED_CHANNELS.has(newState.channelId);
  const exempt      = newState.selfVideo || newState.streaming;

  if (inMonitored && !exempt) {
    scheduleCamWarning(userId, newState.channelId!, warn);
  } else {
    cancelCamWarning(userId);
  }
}
