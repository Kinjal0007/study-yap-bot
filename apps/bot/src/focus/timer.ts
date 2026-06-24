const timers = new Map<string, NodeJS.Timeout>();

export function scheduleSessionEnd(
  sessionId: string,
  delayMs: number,
  onEnd: () => Promise<void>,
): void {
  const existing = timers.get(sessionId);
  if (existing) clearTimeout(existing);

  const t = setTimeout(async () => {
    timers.delete(sessionId);
    await onEnd();
  }, delayMs);

  timers.set(sessionId, t);
}

export function cancelSessionTimer(sessionId: string): void {
  const t = timers.get(sessionId);
  if (t) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

export function hasActiveTimer(sessionId: string): boolean {
  return timers.has(sessionId);
}
