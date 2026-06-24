import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAFKNickname } from './nickname.js';

describe('buildAFKNickname', () => {
  it('prepends [AFK] to a short name', () => {
    expect(buildAFKNickname('Kinjal')).toBe('[AFK] Kinjal');
  });

  it('truncates to exactly 32 chars when base name is long', () => {
    const result = buildAFKNickname('A'.repeat(40));
    expect(result).toBe('[AFK] ' + 'A'.repeat(26));
    expect(result.length).toBe(32);
  });

  it('does not truncate a 26-char name', () => {
    const name = 'B'.repeat(26);
    expect(buildAFKNickname(name)).toBe('[AFK] ' + name);
    expect(buildAFKNickname(name).length).toBe(32);
  });

  it('handles a 27-char name by trimming one character', () => {
    const name = 'C'.repeat(27);
    expect(buildAFKNickname(name)).toBe('[AFK] ' + 'C'.repeat(26));
  });

  it('handles an empty string base name', () => {
    expect(buildAFKNickname('')).toBe('[AFK] ');
  });
});
