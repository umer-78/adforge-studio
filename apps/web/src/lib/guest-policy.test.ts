import { describe, expect, it } from 'vitest';
import { closedToGuests, guestRole } from './guest-policy';

describe('guestRole', () => {
  it('caps the shared visitor account at editor', () => {
    expect(guestRole('owner')).toBe('editor');
    expect(guestRole('admin')).toBe('editor');
    expect(guestRole('editor')).toBe('editor');
    expect(guestRole('viewer')).toBe('viewer');
  });
});

describe('closedToGuests', () => {
  it('lets the guest read ad campaigns but not change them', () => {
    expect(closedToGuests({ scope: 'ads' }, 'editor', 'viewer', true)).toBe(false);
    expect(closedToGuests({ scope: 'ads' }, 'editor', 'editor', false)).toBe(true);
  });

  it('leaves making and editing open', () => {
    expect(closedToGuests({}, 'editor', 'editor')).toBe(false);
    expect(closedToGuests({ scope: 'generate' }, 'editor', 'editor')).toBe(false);
    expect(closedToGuests({}, 'editor', 'viewer')).toBe(false);
  });

  it('closes account, keys, team and public pages, publishing, ads and admin routes', () => {
    expect(closedToGuests({ noGuests: true }, 'editor', 'viewer')).toBe(true);
    expect(closedToGuests({ scope: 'publish' }, 'editor', 'editor')).toBe(true);
    expect(closedToGuests({ scope: 'ads' }, 'editor', 'editor')).toBe(true);
    expect(closedToGuests({}, 'editor', 'admin')).toBe(true);
    expect(closedToGuests({}, 'editor', 'owner')).toBe(true);
  });
});
