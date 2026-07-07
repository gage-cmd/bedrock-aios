import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface TenantContext {
  tenantId: string;
  role: string;
}

declare module 'express' {
  interface Request {
    tenantContext?: TenantContext;
  }
}

// Supabase Auth's JWKS endpoint -- verifies tokens against the project's
// current signing keys without the backend needing to hold a shared secret.
const jwks = createRemoteJWKSet(
  new URL('/auth/v1/.well-known/jwks.json', process.env.SUPABASE_URL),
);

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

    if (!token) {
      res.status(401).json({ message: 'Missing bearer token' });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, jwks);
      const tenantId = payload['tenant_id'];
      // Not `payload['role']` -- that's the reserved PostgREST/Postgres role
      // claim (always "authenticated"), not the app-level owner/staff/
      // read_only role. The custom claims hook stashes that under `app_role`.
      const role = payload['app_role'];

      if (typeof tenantId !== 'string' || typeof role !== 'string') {
        res
          .status(401)
          .json({ message: 'Token is missing tenant_id or app_role claim' });
        return;
      }

      req.tenantContext = { tenantId, role };
      next();
    } catch {
      res.status(401).json({ message: 'Invalid or expired token' });
    }
  }
}
