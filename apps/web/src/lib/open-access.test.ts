import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOpenAccessGuest, openAccessEnabled, openAccessGuestEmail, ownerEmailList } from './open-access';

afterEach(() => vi.unstubAllEnvs());

describe('open access', () => {
  it('is on only with OPEN_ACCESS set and an owner to join', () => {
    vi.stubEnv('OPEN_ACCESS', 'true');
    vi.stubEnv('APP_OWNER_EMAILS', '');
    expect(openAccessEnabled()).toBe(false);
    vi.stubEnv('APP_OWNER_EMAILS', ' Owner@Example.com , second@example.com');
    expect(openAccessEnabled()).toBe(true);
    expect(ownerEmailList()).toEqual(['owner@example.com', 'second@example.com']);
    vi.stubEnv('OPEN_ACCESS', '0');
    expect(openAccessEnabled()).toBe(false);
  });

  it('knows the shared guest account by its email, which can never receive mail', () => {
    vi.stubEnv('OPEN_ACCESS_GUEST_EMAIL', '');
    expect(openAccessGuestEmail()).toBe('open-access-guest@adforge.invalid');
    expect(isOpenAccessGuest('Open-Access-Guest@adforge.invalid')).toBe(true);
    expect(isOpenAccessGuest('owner@example.com')).toBe(false);
    expect(isOpenAccessGuest(undefined)).toBe(false);
    vi.stubEnv('OPEN_ACCESS_GUEST_EMAIL', 'visitor@studio.invalid');
    expect(isOpenAccessGuest('visitor@studio.invalid')).toBe(true);
  });
});
