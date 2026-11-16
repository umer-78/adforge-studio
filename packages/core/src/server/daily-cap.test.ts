import { describe, expect, it } from 'vitest';
import { dailyAiCapUsd } from './env';
import { checkDailyCap } from './usage';

describe('dailyAiCapUsd', () => {
  it('defaults to $2 while sign-in is off and to no cap otherwise', () => {
    expect(dailyAiCapUsd({ OPEN_ACCESS: true, AI_DAILY_CAP_USD: undefined })).toBe(2);
    expect(dailyAiCapUsd({ OPEN_ACCESS: false, AI_DAILY_CAP_USD: undefined })).toBeNull();
  });

  it('uses AI_DAILY_CAP_USD when set, and 0 turns the cap off', () => {
    expect(dailyAiCapUsd({ OPEN_ACCESS: true, AI_DAILY_CAP_USD: '5.5' })).toBe(5.5);
    expect(dailyAiCapUsd({ OPEN_ACCESS: true, AI_DAILY_CAP_USD: '0' })).toBeNull();
    expect(dailyAiCapUsd({ OPEN_ACCESS: false, AI_DAILY_CAP_USD: 'lots' })).toBeNull();
  });
});

describe('checkDailyCap', () => {
  it('allows spend up to the cap', () => {
    expect(() => checkDailyCap(1.5, 0.5, 2)).not.toThrow();
    expect(() => checkDailyCap(10, 0, 2)).not.toThrow();
    expect(() => checkDailyCap(10, 5, null)).not.toThrow();
  });

  it('stops an action that would pass the cap', () => {
    expect(() => checkDailyCap(1.9, 0.2, 2)).toThrow(/spending cap/);
  });
});
