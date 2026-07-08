import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify } from 'jose';
import { AdminGuard } from './admin.guard';
import { PlatformAdminRepository } from './platform-admin.repository';

// Mocked at the verification boundary only -- exactly as
// tenant-resolver.middleware.spec does. This is a unit test of the guard's own
// decision logic (extract token -> verify -> read sub -> check membership),
// not of jose's cryptography or the database. The membership check is stubbed
// so each outcome can be driven directly.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({})),
  jwtVerify: jest.fn(),
}));

const mockedJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

// A stand-in for the real repository. The guard depends only on the
// isPlatformAdmin(userId) boolean, so we control that directly here.
function fakeRepo() {
  return { isPlatformAdmin: jest.fn<Promise<boolean>, [string]>() };
}

function contextWithAuth(authorization?: string): ExecutionContext {
  const req = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function payload(claims: Record<string, unknown>) {
  return { payload: claims } as Awaited<ReturnType<typeof jwtVerify>>;
}

describe('AdminGuard', () => {
  let repo: ReturnType<typeof fakeRepo>;
  let guard: AdminGuard;

  beforeEach(() => {
    repo = fakeRepo();
    guard = new AdminGuard(repo as unknown as PlatformAdminRepository);
    mockedJwtVerify.mockReset();
  });

  it('rejects a tenant user -- even one whose app_role is owner -- because the token carries a tenant_id', async () => {
    // A fully valid tenant JWT: real user id, a tenant, and the highest tenant
    // role. It is rejected at the tenant_id gate, before any admin lookup --
    // a tenant-scoped token is categorically not a platform-admin credential.
    mockedJwtVerify.mockResolvedValue(
      payload({
        sub: 'owner-user-id',
        tenant_id: 'tenant-a',
        app_role: 'owner',
      }),
    );

    await expect(
      guard.canActivate(contextWithAuth('Bearer owner-token')),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The membership table is never even consulted for a tenant token.
    expect(repo.isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('rejects a token carrying a tenant_id EVEN IF its sub is a platform admin (defense in depth)', async () => {
    // The dangerous case the DB constraint also guards: an auth user who is
    // somehow both an admin AND carries a tenant identity. isPlatformAdmin
    // would return true, but the guard must reject before it matters -- a
    // tenant-scoped token can never be escalated to admin access.
    mockedJwtVerify.mockResolvedValue(
      payload({ sub: 'admin-user-id', tenant_id: 'tenant-a' }),
    );
    repo.isPlatformAdmin.mockResolvedValue(true);

    await expect(
      guard.canActivate(contextWithAuth('Bearer dual-role-token')),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Rejected at the tenant_id gate -- membership is not consulted at all,
    // so even a true admin result cannot rescue a tenant-scoped token.
    expect(repo.isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('rejects a bare (no tenant_id) token whose sub is NOT in platform_admins', async () => {
    // Proves the membership check is real and keyed on the sub: a clean,
    // tenant-less token still gets 403 when the user is not an admin.
    mockedJwtVerify.mockResolvedValue(payload({ sub: 'stranger-user-id' }));
    repo.isPlatformAdmin.mockResolvedValue(false);

    await expect(
      guard.canActivate(contextWithAuth('Bearer stranger-token')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.isPlatformAdmin).toHaveBeenCalledWith('stranger-user-id');
  });

  it('accepts a user who is listed in platform_admins', async () => {
    mockedJwtVerify.mockResolvedValue(payload({ sub: 'admin-user-id' }));
    repo.isPlatformAdmin.mockResolvedValue(true);

    await expect(
      guard.canActivate(contextWithAuth('Bearer admin-token')),
    ).resolves.toBe(true);
    expect(repo.isPlatformAdmin).toHaveBeenCalledWith('admin-user-id');
  });

  it('never consults tenant_id/app_role -- admin status is keyed purely on the auth user id', async () => {
    // Same admin user id, but this token carries NO tenant_id and NO app_role
    // at all. It is still accepted, proving the decision does not depend on
    // tenant claims.
    mockedJwtVerify.mockResolvedValue(payload({ sub: 'admin-user-id' }));
    repo.isPlatformAdmin.mockResolvedValue(true);

    await expect(
      guard.canActivate(contextWithAuth('Bearer tenantless-admin-token')),
    ).resolves.toBe(true);
  });

  it('rejects a missing token with 401 and never touches the database', async () => {
    await expect(guard.canActivate(contextWithAuth())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('rejects an invalid/expired token with 401 and never touches the database', async () => {
    mockedJwtVerify.mockRejectedValue(
      new Error('signature verification failed'),
    );

    await expect(
      guard.canActivate(contextWithAuth('Bearer garbage')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('rejects a verified token that has no sub claim with 401', async () => {
    mockedJwtVerify.mockResolvedValue(payload({ tenant_id: 'tenant-a' }));

    await expect(
      guard.canActivate(contextWithAuth('Bearer no-sub-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repo.isPlatformAdmin).not.toHaveBeenCalled();
  });
});
