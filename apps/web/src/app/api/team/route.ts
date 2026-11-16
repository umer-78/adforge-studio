import { hasRole, route } from '@/lib/server/api';
import { openInvites, teamMembers } from '@/lib/server/team';

/** The workspace's members, and for admins the invites still waiting. */
export const GET = route({}, async ({ sb, caller }) => {
  const admin = hasRole(caller, 'admin');
  const [members, invites] = await Promise.all([teamMembers(sb, caller.workspaceId, caller.userId), admin ? openInvites(sb, caller.workspaceId) : Promise.resolve([])]);
  // Visitors (sign-in off) see who is on the team, not their email addresses.
  return { members: caller.guest ? members.map((m) => ({ ...m, email: null })) : members, invites, canManage: admin };
});
