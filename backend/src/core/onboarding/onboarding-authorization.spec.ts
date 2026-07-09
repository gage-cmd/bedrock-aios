import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { jwtVerify } from 'jose';
import { Client } from 'pg';
import request from 'supertest';
import { OnboardingModule } from './onboarding.module';

// Step 9 test (1), run against the REAL console route group: every
// admin/onboarding route is gated by AdminGuard, so a regular tenant user --
// including a tenant OWNER -- is rejected, and only a platform_admins-listed
// user gets through. Same test seam as the AdminGuard integration spec: jose
// is stubbed at the signature boundary, the guard's decision logic and the
// platform_admins membership check run for real against Postgres.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({})),
  jwtVerify: jest.fn(),
}));

const mockedJwtVerify = jwtVerify as jest.MockedFunction<typeof jwtVerify>;

describe('Onboarding Console authorization (integration, real DB)', () => {
  let app: INestApplication;
  let client: Client;

  const adminUserId = randomUUID();
  const ownerUserId = randomUUID();
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

    await client.query(
      `insert into tenants (id, name, status) values ($1, 'Onboarding Authz Tenant', 'active')`,
      [tenantId],
    );
    await client.query(
      `insert into users (id, tenant_id, email, role) values ($1, $2, 'authz-owner@example.com', 'owner')`,
      [ownerUserId, tenantId],
    );
    await client.query(`insert into platform_admins (user_id) values ($1)`, [
      adminUserId,
    ]);

    mockedJwtVerify.mockImplementation((token: unknown) => {
      if (token === 'admin-token') {
        return Promise.resolve({
          payload: { sub: adminUserId },
        } as Awaited<ReturnType<typeof jwtVerify>>);
      }
      if (token === 'owner-token') {
        // A full, valid tenant-owner identity -- the highest tenant role.
        return Promise.resolve({
          payload: { sub: ownerUserId, tenant_id: tenantId, app_role: 'owner' },
        } as Awaited<ReturnType<typeof jwtVerify>>);
      }
      return Promise.reject(new Error('invalid token'));
    });

    const moduleRef = await Test.createTestingModule({
      imports: [OnboardingModule],
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

  // A representative spread of the console's surface: a read, a tenant
  // create, and the activation that flips a business live.
  const probes = [
    { method: 'get' as const, path: '/admin/onboarding/modules' },
    { method: 'post' as const, path: '/admin/onboarding/tenants' },
    {
      method: 'post' as const,
      path: `/admin/onboarding/tenants/${randomUUID()}/activate`,
    },
  ];

  it("rejects a regular tenant user -- including role 'owner' -- from every console route (403)", async () => {
    for (const probe of probes) {
      const res = await request(app.getHttpServer())
        [probe.method](probe.path)
        .set('Authorization', 'Bearer owner-token');
      expect(res.status).toBe(403);
    }
  });

  it('rejects unauthenticated requests from every console route (401)', async () => {
    for (const probe of probes) {
      const res = await request(app.getHttpServer())[probe.method](probe.path);
      expect(res.status).toBe(401);
    }
  });

  it('accepts a platform admin (module list responds 200)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/onboarding/modules')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
