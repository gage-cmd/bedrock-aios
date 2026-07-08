import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PlatformAdminRepository } from './platform-admin.repository';

// Supabase Auth's JWKS endpoint -- the same verification boundary
// TenantResolverMiddleware uses, but deliberately re-established here rather
// than shared through it. AdminGuard must stand on its own: an admin request
// is authenticated by its OWN verification of the token, not by anything the
// tenant middleware did or the tenant context it produces.
const jwks = createRemoteJWKSet(
  new URL('/auth/v1/.well-known/jwks.json', process.env.SUPABASE_URL),
);

/**
 * Gates the platform-admin surface (the future onboarding console routes).
 *
 * This is a structurally separate authorization path from
 * TenantResolverMiddleware, by design:
 *
 *  - The tenant middleware requires a `tenant_id` claim and attaches a
 *    TenantContext; an admin token carries NO tenant_id, so it would be
 *    rejected there. Admin routes are therefore NOT run through that
 *    middleware -- they are guarded here instead.
 *  - AdminGuard reads ONLY the JWT `sub` (the Supabase Auth user id) and asks
 *    platform_admins whether that user is an admin. It never reads tenant_id,
 *    app_role, or req.tenantContext. Admin status is a property of the person,
 *    independent of any tenant.
 *
 * Crucially, passing this guard grants access only to the routes it is applied
 * to. It sets no ambient "is admin" flag and bypasses no Row-Level Security:
 * the tenant-scoped RLS policies key on tenant_id via auth.jwt(), which an
 * admin token does not carry, so an admin session reading a tenant table sees
 * nothing. Admin power lives entirely in which route groups mount this guard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly platformAdmins: PlatformAdminRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let userId: unknown;
    let tenantIdClaim: unknown;
    try {
      const { payload } = await jwtVerify(token, jwks);
      // `sub` is the Supabase Auth user id. Admin authorization keys off this
      // alone; tenant_id is captured only to REJECT tenant-scoped tokens
      // below, never to authorize.
      userId = payload.sub;
      tenantIdClaim = payload.tenant_id;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (typeof userId !== 'string') {
      throw new UnauthorizedException('Token is missing sub claim');
    }

    // Defense in depth on top of the DB-level mutual-exclusion constraint
    // (migration 0016). A token that carries a tenant_id claim is a
    // tenant-scoped session, never a pure platform-admin credential -- the
    // custom_access_token_hook only sets tenant_id for users with a tenant
    // membership. Reject such a token outright, BEFORE and regardless of any
    // platform_admins lookup: even if this sub were somehow listed as an
    // admin, a tenant-identity token must not be usable to reach admin routes.
    if (tenantIdClaim !== undefined && tenantIdClaim !== null) {
      throw new ForbiddenException(
        'Tenant-scoped token cannot be used for platform-admin access',
      );
    }

    if (!(await this.platformAdmins.isPlatformAdmin(userId))) {
      throw new ForbiddenException('Platform admin privilege required');
    }

    return true;
  }
}
