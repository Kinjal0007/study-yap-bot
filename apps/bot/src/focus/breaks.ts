export const VALID_DURATIONS = [30, 45, 60, 90, 120] as const;
export type ValidDuration = (typeof VALID_DURATIONS)[number];

const BREAK_MAP: Record<ValidDuration, { breakMins: number; message: string }> = {
  30:  { breakMins: 5,  message: "30 minutes locked in — solid sprint. Take a 5-minute breather and come back." },
  45:  { breakMins: 10, message: "45 minutes focused. Rest your eyes for 10 minutes before the next one." },
  60:  { breakMins: 15, message: "A full hour of focus. Take a proper 15-minute break — touch some grass." },
  90:  { breakMins: 20, message: "90 minutes of deep work. That earns a 20-minute break, no guilt." },
  120: { breakMins: 30, message: "Two full hours. Take 30 minutes off — you've genuinely earned it." },
};

export function getBreakSuggestion(durationMins: number): string {
  const entry = BREAK_MAP[durationMins as ValidDuration];
  if (!entry) return 'Great session! Take a break before the next one.';
  return `${entry.message} (suggested break: ${entry.breakMins} min)`;
}
