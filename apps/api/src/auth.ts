import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@mnemonics/shared';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export type AuthenticatedRequest = Request & {
  userId?: string;
  user?: User;
  userRole?: UserRole;
};

function unauthorized(request: Request, response: Response) {
  response.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ', requestId: request.id }
  });
}

function roleFromUser(user: User): UserRole {
  const metadata = user.app_metadata as Record<string, unknown> | undefined;
  return metadata?.role === 'admin' ? 'admin' : 'user';
}

export function requireSupabaseAuth(supabase: SupabaseClient) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      unauthorized(request, response);
      return;
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      unauthorized(request, response);
      return;
    }

    request.userId = data.user.id;
    request.user = data.user;
    request.userRole = roleFromUser(data.user);
    next();
  };
}

export function requireAdmin(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  if (request.userRole !== 'admin') {
    response.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Bạn không có quyền quản trị', requestId: request.id }
    });
    return;
  }
  next();
}

export function requireDevelopmentAuth(expectedToken: string, developmentUserId = '00000000-0000-4000-8000-000000000001') {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token || token !== expectedToken) {
      response.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ', requestId: request.id }
      });
      return;
    }
    request.userId = developmentUserId;
    next();
  };
}