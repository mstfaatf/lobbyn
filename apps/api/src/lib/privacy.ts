export type ViewerRole = 'resident' | 'manager' | 'org_admin';

export function formatUser(
  user: {
    id: string;
    email: string;
    fullName: string;
    displayName: string | null;
    avatarUrl: string | null;
    unitNumber?: string | null;
  },
  viewerRole: ViewerRole,
): {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  fullName?: string;
  email?: string;
  unitNumber?: string | null;
} {
  const displayName = user.displayName ?? user.fullName;

  if (viewerRole === 'resident') {
    return { id: user.id, displayName, avatarUrl: user.avatarUrl };
  }

  return {
    id: user.id,
    displayName,
    avatarUrl: user.avatarUrl,
    fullName: user.fullName,
    email: user.email,
    unitNumber: user.unitNumber ?? null,
  };
}
