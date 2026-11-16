import type { EmailOtpType } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { openAccessEmail, serviceClient, type ServiceClient } from '@adforge/core/server';
import { GUEST_NAME, openAccessGuestEmail, ownerEmailList } from '@/lib/open-access';
import { clientIp, rateLimit } from '@/lib/server/api';
import { redirectTo, safeNext } from '@/lib/server/auth';
import { sessionClient } from '@/lib/server/supabase';

const FAILED = 'The studio could not open. Try again in a moment.';
const NOT_READY = 'The studio is not set up yet. The owner needs to sign in once first.';

/** The owner's default workspace: where visitors work while sign-in is off. */
async function ownerWorkspace(sb: ServiceClient, email: string): Promise<string | null> {
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Could not look up the owner: ${error.message}`);
  const owner = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!owner) return null;
  const { data: profile } = await sb.from('profiles').select('default_workspace_id').eq('id', owner.id).maybeSingle();
  if (profile?.default_workspace_id) {
    const { data: ws } = await sb.from('workspaces').select('id').eq('id', profile.default_workspace_id).eq('owner_id', owner.id).maybeSingle();
    if (ws) return ws.id;
  }
  const { data: first } = await sb.from('workspaces').select('id').eq('owner_id', owner.id).order('created_at').limit(1).maybeSingle();
  return first?.id ?? null;
}

/** Makes the guest an editor in the owner's workspace (never more), and names it. */
async function joinAsGuest(sb: ServiceClient, workspaceId: string, guestId: string) {
  const member = await sb.from('workspace_members').upsert({ workspace_id: workspaceId, user_id: guestId, role: 'editor' }, { onConflict: 'workspace_id,user_id' });
  if (member.error) throw new Error(`Could not add the guest to the workspace: ${member.error.message}`);
  const profile = await sb.from('profiles').update({ full_name: GUEST_NAME, avatar_url: null, default_workspace_id: workspaceId }).eq('id', guestId);
  if (profile.error) throw new Error(`Could not set up the guest profile: ${profile.error.message}`);
}

/**
 * With sign-in off (OPEN_ACCESS), opens the studio without an email. Visitors share one guest
 * account that is an editor in the owner's workspace, so they can make things there but cannot
 * reach the owner's account, keys, team or publishing. The server makes a one-time sign-in token
 * for the guest and redeems it at once, so this browser gets a normal session.
 */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const ownerEmail = openAccessEmail();
  if (!ownerEmail) return redirectTo(req, '/login', { next });
  const guestEmail = openAccessGuestEmail();

  const supabase = await sessionClient();
  const { data: current } = await supabase.auth.getClaims();
  const currentEmail = (current?.claims?.email as string | undefined)?.toLowerCase();
  // Already the guest, or the owner signed in: nothing to open.
  if (currentEmail && (currentEmail === guestEmail || ownerEmailList().includes(currentEmail))) return redirectTo(req, next);

  const sb = serviceClient();
  try {
    await rateLimit(sb, `open-access:${clientIp(req)}`, 30, 3600);
  } catch {
    return redirectTo(req, '/login', { error: 'Too many tries. Wait a few minutes and open the studio again.' });
  }

  try {
    const workspaceId = await ownerWorkspace(sb, ownerEmail.toLowerCase());
    if (!workspaceId) return redirectTo(req, '/login', { error: NOT_READY, owner: '1' });

    const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: guestEmail });
    const tokenHash = data?.properties?.hashed_token;
    const guestId = data?.user?.id;
    if (error || !tokenHash || !guestId) throw new Error(`Could not make a sign-in token: ${error?.message ?? 'no token'}`);
    await joinAsGuest(sb, workspaceId, guestId);

    // A brand-new guest account comes back as a sign-up token; an existing one as a magic link.
    const type: EmailOtpType = data.properties.verification_type === 'signup' ? 'signup' : 'magiclink';
    const { error: verifyError } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (verifyError) throw new Error(`Could not redeem the sign-in token: ${verifyError.message}`);
  } catch (err) {
    console.error('[auth/open]', err instanceof Error ? err.message : err);
    return redirectTo(req, '/login', { error: FAILED });
  }
  return redirectTo(req, next);
}
