import { describe, it, expect } from 'vitest';
import { getBreakSuggestion, VALID_DURATIONS } from './breaks.js';

describe('getBreakSuggestion', () => {
  it('returns 5 min break for 30 min session', () => {
    const result = getBreakSuggestion(30);
    expect(result).toContain('5');
  });

  it('returns 10 min break for 45 min session', () => {
    const result = getBreakSuggestion(45);
    expect(result).toContain('10');
  });

  it('returns 15 min break for 60 min session', () => {
    const result = getBreakSuggestion(60);
    expect(result).toContain('15');
  });

  it('returns 20 min break for 90 min session', () => {
    const result = getBreakSuggestion(90);
    expect(result).toContain('20');
  });

  it('returns 30 min break for 120 min session', () => {
    const result = getBreakSuggestion(120);
    expect(result).toContain('30');
  });

  it('returns a non-empty string for any valid duration', () => {
    VALID_DURATIONS.forEach(d => {
      expect(getBreakSuggestion(d).length).toBeGreaterThan(0);
    });
  });
});

describe('VALID_DURATIONS', () => {
  it('contains exactly 5 options', () => {
    expect(VALID_DURATIONS).toHaveLength(5);
  });

  it('contains 30, 45, 60, 90, 120', () => {
    expect(VALID_DURATIONS).toEqual(expect.arrayContaining([30, 45, 60, 90, 120]));
  });
});
