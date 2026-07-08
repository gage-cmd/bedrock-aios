import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { jwtVerify } from 'jose';
import { Client } from 'pg';
import request from 'supertest';
import { AdminGuard } from './admin.guard';
import { AuthModule } from './auth.module';

// Integration test: the guard's decision logic is real, the PlatformAdmin
// repository talks to the real Postgres platform_admins table, and the guard
// is mounted on an actual route group via @UseGuards(AdminGuard) and driven
// over HTTP with supertest. Only jose's signature verification is stubbed
// (the same boundary the unit tests and tenant middleware tests stub) -- the
// authorization decision itself, and the database membership check behind it,
// are exercised for real.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({})),
  jwtVerify: jest.fn(),
}));

const mockedJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

// A stand-in for the future onboarding-console routes: a route group protected
// ONLY by AdminGuard. Note there is no TenantResolverMiddleware anywhere in
// this test app -- proving the guard gates a route group independently of the
// tenant-scoped request path. A tenant token with no tenant_id would be
// rejected by that middleware; here, authorization rests entirely on
// platform_admins membership.
@Controller('admin/console')
@UseGuards(AdminGuard)
class AdminConsoleTestController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

describe('AdminGuard on a route group (integration, real DB)', () => {
  let app: INestApplication;
  let client: Client;

  const adminUserId = randomUUID();
  const ownerUserId = randomUUID();
  const strangerUserId = randomUUID();
  const tenantId = randomUUID();

  beforeAll(async () => {
    client = new Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    // A real tenant with a real 'owner' user, and a real platform admin who
    // belongs to no tenant. Only the admin gets a platform_admins row.
    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Admin Guard IT Tenant', 'active')`,
      [tenantId],
    );
    await client.query(
      `insert into users (id, tenant_id, email, role) values ($1, $2, 'owner@example.com', 'owner')`,
      [ownerUserId, tenantId],
    );
    await client.query(`insert into platform_admins (user_id) values ($1)`, [
      adminUserId,
    ]);

    // jose is stubbed: map each opaque test token to the claims a verified
    // Supabase JWT would carry. The owner token carries a full tenant identity
    // (tenant_id + app_role owner) to prove none of that grants admin access.
    mockedJwtVerify.mockImplementation((token: unknown) => {
      if (token === 'admin-token') {
        return Promise.resolve({
          payload: { sub: adminUserId },
        } as Awaited<ReturnType<typeof jwtVerify>>);
      }
      if (token === 'owner-token') {
        return Promise.resolve({
          payload: { sub: ownerUserId, tenant_id: tenantId, app_role: 'owner' },
        } as Awaited<ReturnType<typeof jwtVerify>>);
      }
      if (token === 'stranger-token') {
        return Promise.resolve({
          payload: { sub: strangerUserId },
        } as Awaited<ReturnType<typeof jwtVerify>>);
      }
      return Promise.reject(new Error('invalid token'));
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AdminConsoleTestController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await client.query(`delete from platform_admins where user_id = $1`, [
      adminUserId,
    ]);
    await client.query(`delete from users where tenant_id = $1`, [tenantId]);
    await client.query(`delete from tenants where id = $1`, [tenantId]);
    await client.end();
    await app.close();
  });

  it('accepts a user listed in platform_admins (200)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/console/ping')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("rejects a tenant 'owner' who is not a platform admin (403)", async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/console/ping')
      .set('Authorization', 'Bearer owner-token');

    expect(res.status).toBe(403);
  });

  it('rejects an authenticated non-admin user with no admin row (403)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/console/ping')
      .set('Authorization', 'Bearer stranger-token');

    expect(res.status).toBe(403);
  });

  it('rejects a request with no token (401)', async () => {
    const res = await request(app.getHttpServer()).get('/admin/console/ping');
    expect(res.status).toBe(401);
  });
});
