import { ROLES, type Role } from '@adforge/core';

/** What the shared visitor account (sign-in off) may not do, in one place so it can be tested. */

type GuestScope = 'read' | 'write' | 'generate' | 'publish' | 'ads';

/** A guest is at most an editor, whatever its membership row says. */
export function guestRole(role: Role): Role {
  return ROLES.indexOf(role) < ROLES.indexOf('editor') ? 'editor' : role;
}

/**
 * Whether a route is closed to the guest: routes marked noGuests (account, keys, team, public
 * pages), anything that publishes or changes ad accounts and campaigns (reading them is fine), and
 * anything above the guest's role.
 */
export function closedToGuests(opts: { noGuests?: boolean; scope?: GuestScope }, role: Role, minRole: Role, read = false): boolean {
  return !!opts.noGuests || ((opts.scope === 'publish' || opts.scope === 'ads') && !read) || ROLES.indexOf(role) > ROLES.indexOf(minRole);
}
