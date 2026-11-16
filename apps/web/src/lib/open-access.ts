/**
 * Sign-in off (OPEN_ACCESS): visitors share one guest account that joins the owner's workspace as
 * an editor. They can make and edit things there, but the owner's account, keys, team, publishing
 * and ad accounts stay out of reach, and the guest stops working the moment OPEN_ACCESS is off.
 *
 * Read straight from process.env so the request proxy can use it as well as the API routes.
 */

const ON = new Set(['1', 'true', 'yes', 'on']);

/** The owner accounts (APP_OWNER_EMAILS), lowercased. */
export function ownerEmailList(): string[] {
  return (process.env.APP_OWNER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True while sign-in is off: OPEN_ACCESS is set and there is an owner whose workspace visitors join. */
export function openAccessEnabled(): boolean {
  return ON.has((process.env.OPEN_ACCESS ?? '').trim().toLowerCase()) && ownerEmailList().length > 0;
}

/** The shared visitor account. `.invalid` is a reserved domain, so no mail is ever delivered to it. */
export function openAccessGuestEmail(): string {
  return (process.env.OPEN_ACCESS_GUEST_EMAIL || 'open-access-guest@adforge.invalid').trim().toLowerCase();
}

export function isOpenAccessGuest(email: unknown): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === openAccessGuestEmail();
}

/** The name the guest account goes by, in the app and in activity entries. */
export const GUEST_NAME = 'Guest';
