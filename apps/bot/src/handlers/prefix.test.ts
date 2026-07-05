import { describe, it, expect } from 'vitest';
import { parsePrefix } from './prefix.js';

describe('parsePrefix', () => {
  it('returns null for non-prefixed messages', () => {
    expect(parsePrefix('hello world', '-')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parsePrefix('', '-')).toBeNull();
  });

  it('parses a bare command', () => {
    expect(parsePrefix('-focus', '-')).toEqual({ command: 'focus', args: [] });
  });

  it('parses a command with one arg', () => {
    expect(parsePrefix('.leaderboard week', '-')).toEqual({ command: 'leaderboard', args: ['week'] });
  });

  it('parses a command with multiple args', () => {
    expect(parsePrefix('.leaderboard this month', '-')).toEqual({ command: 'leaderboard', args: ['this', 'month'] });
  });

  it('is case-insensitive on the command', () => {
    expect(parsePrefix('.FOCUS', '-')).toEqual({ command: 'focus', args: [] });
  });

  it('trims extra whitespace', () => {
    expect(parsePrefix('.focus   ', '-')).toEqual({ command: 'focus', args: [] });
  });
});
