import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  handleVoiceStateUpdate,
  cancelCamWarning,
  hasPendingCamWarning,
} from './voiceState.js';

function makeState(opts: {
  userId: string;
  channelId: string | null;
  selfVideo: boolean;
  streaming: boolean;
}): any {
  return {
    member: { id: opts.userId },
    channelId: opts.channelId,
    selfVideo: opts.selfVideo,
    streaming: opts.streaming,
  };
}

const CAM_CHANNEL = '1506364304486830163';
const OTHER_CHANNEL = '9999999999999999999';
const USER = 'user-123';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cancelCamWarning(USER);
  vi.useRealTimers();
});

describe('handleVoiceStateUpdate', () => {
  it('schedules a warning when user joins cam-required channel without camera', async () => {
    const warn = vi.fn();
    const old = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(old, next, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(true);
  });

  it('does NOT schedule when user is streaming', async () => {
    const warn = vi.fn();
    const old = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: true });

    await handleVoiceStateUpdate(old, next, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('does NOT schedule when user has camera on', async () => {
    const warn = vi.fn();
    const old = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: true,  streaming: false });

    await handleVoiceStateUpdate(old, next, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('cancels pending warning when user turns camera on', async () => {
    const warn = vi.fn();
    const join  = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const camOn = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: true,  streaming: false });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(true);

    await handleVoiceStateUpdate(join, camOn, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('cancels pending warning when user starts streaming', async () => {
    const warn = vi.fn();
    const join      = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const streaming = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: true });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn, vi.fn());
    await handleVoiceStateUpdate(join, streaming, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('cancels pending warning when user leaves the channel', async () => {
    const warn = vi.fn();
    const join  = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const leave = makeState({ userId: USER, channelId: null,         selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn, vi.fn());
    await handleVoiceStateUpdate(join, leave, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(false);
  });

  it('fires the warn callback after 8 minutes', async () => {
    const warn = vi.fn();
    const old  = makeState({ userId: USER, channelId: null,        selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(old, next, warn, vi.fn());
    expect(warn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(8 * 60 * 1000);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(USER, CAM_CHANNEL);
  });

  it('does NOT fire warn callback if camera turned on before 8 minutes', async () => {
    const warn  = vi.fn();
    const join  = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: false, streaming: false });
    const camOn = makeState({ userId: USER, channelId: CAM_CHANNEL, selfVideo: true,  streaming: false });

    await handleVoiceStateUpdate(makeState({ userId: USER, channelId: null, selfVideo: false, streaming: false }), join, warn, vi.fn());
    vi.advanceTimersByTime(5 * 60 * 1000);
    await handleVoiceStateUpdate(join, camOn, warn, vi.fn());
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT schedule for a non-cam-required channel', async () => {
    const warn = vi.fn();
    const old  = makeState({ userId: USER, channelId: null,          selfVideo: false, streaming: false });
    const next = makeState({ userId: USER, channelId: OTHER_CHANNEL, selfVideo: false, streaming: false });

    await handleVoiceStateUpdate(old, next, warn, vi.fn());
    expect(hasPendingCamWarning(USER)).toBe(false);
  });
});
