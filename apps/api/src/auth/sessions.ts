import type { Session, User } from '@supabase/supabase-js';
import type { AuthSessionDto, AuthUserDto, UserRole } from '@mnemonics/shared';

const ROLE_VALUES = ['user', 'admin'] as const satisfies readonly UserRole[];

function roleFromUser(user: User): UserRole {
  const metadata = user.app_metadata as Record<string, unknown> | undefined;
  const role = metadata?.role;
  return ROLE_VALUES.includes(role as UserRole) ? (role as UserRole) : 'user';
}

export function toAuthUserDto(user: User): AuthUserDto {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const rawName = metadata?.name;
  const name = typeof rawName === 'string' && rawName.length > 0 ? rawName.slice(0, 80) : null;
  return {
    id: user.id,
    email: user.email ?? '',
    name,
    role: roleFromUser(user),
    emailVerified: Boolean(user.email_confirmed_at)
  };
}

/** @deprecated kept for back-compat; envelope() wraps sessions directly. */
export function toAuthSessionDto(session: Session | null): AuthSessionDto | null {
  if (!session || !session.access_token || !session.refresh_token || !session.expires_at) {
    return null;
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    tokenType: 'bearer'
  };
}

export function bearerFromHeader(header?: string | undefined): string | null {
  if (!header) return null;
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}
