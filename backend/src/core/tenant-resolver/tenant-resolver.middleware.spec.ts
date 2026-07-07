import type { Request, Response } from 'express';
import { jwtVerify } from 'jose';
import {
  TenantContext,
  TenantResolverMiddleware,
} from './tenant-resolver.middleware';

// Mocked at the verification boundary: this is a unit test of the
// middleware's own logic (extract token -> verify -> attach context),
// not of jose's signature verification or Supabase's JWKS endpoint.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({})),
  jwtVerify: jest.fn(),
}));

const mockedJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

interface MockRequest {
  headers: Record<string, string>;
  tenantContext?: TenantContext;
}

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function mockResponse(): MockResponse {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('TenantResolverMiddleware', () => {
  let middleware: TenantResolverMiddleware;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new TenantResolverMiddleware();
    next = jest.fn();
    mockedJwtVerify.mockReset();
  });

  it('populates req.tenantContext with tenantId/role from a valid JWT and calls next()', async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { tenant_id: 'tenant-a-id', app_role: 'owner' },
    } as Awaited<ReturnType<typeof jwtVerify>>);
    const res = mockResponse();
    const req: MockRequest = {
      headers: { authorization: 'Bearer valid-token' },
    };

    await middleware.use(
      req as unknown as Request,
      res as unknown as Response,
      next,
    );

    expect(req.tenantContext).toEqual({
      tenantId: 'tenant-a-id',
      role: 'owner',
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a missing or invalid token before next() is ever called', async () => {
    // no Authorization header at all
    const resMissing = mockResponse();
    const reqMissing: MockRequest = { headers: {} };

    await middleware.use(
      reqMissing as unknown as Request,
      resMissing as unknown as Response,
      next,
    );

    expect(resMissing.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(reqMissing.tenantContext).toBeUndefined();

    // present token, but verification fails (bad signature/expired/etc.)
    mockedJwtVerify.mockRejectedValue(
      new Error('signature verification failed'),
    );
    const resInvalid = mockResponse();
    const reqInvalid: MockRequest = {
      headers: { authorization: 'Bearer garbage' },
    };

    await middleware.use(
      reqInvalid as unknown as Request,
      resInvalid as unknown as Response,
      next,
    );

    expect(resInvalid.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(reqInvalid.tenantContext).toBeUndefined();
  });
});
