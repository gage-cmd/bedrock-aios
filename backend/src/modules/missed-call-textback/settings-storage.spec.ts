/**
 * Covers this module's settings storage: the per-tenant config JSONB on
 * module_manifest (the same row the dashboard settings form writes) and how
 * the service consumes it. Proves the stored settings actually flow into the
 * outgoing text-back, that all four fields round-trip with their JSON types,
 * and that sensible defaults kick in when a field is absent.
 *
 * destinationNumber and ringTimeoutSeconds have no runtime consumer yet --
 * they're read by the Twilio voice webhooks (Step 3) -- so here they're only
 * asserted to persist and deserialize correctly.
 */
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { MissedCallTextbackService } from './missed-call-textback.service';
import type { MissedCallRow } from './missed-call-textback.service';
import { MessagingService } from '../../shared/messaging/messaging.service';
import { StubSmsClient } from '../../shared/messaging/stub-sms-client';

interface StoredConfig {
  businessName?: string;
  destinationNumber?: string;
  ringTimeoutSeconds?: number;
  textBackTemplate?: string;
}

describe('missed-call-textback settings storage', () => {
  let service: MissedCallTextbackService;
  let messaging: MessagingService;
  let setupClient: Client;

  // Each tenant isolates one storage scenario.
  const fullConfigTenantId = randomUUID();
  const defaultsTenantId = randomUUID();
  const noConfigTenantId = randomUUID();
  const callerPhone = '+15557770000';

  const customConfig: StoredConfig = {
    businessName: 'Custom Co',
    destinationNumber: '+15559990000',
    ringTimeoutSeconds: 35,
    textBackTemplate: "Custom: {business_name} will ring you right back.",
  };

  async function provisionNumber(tenantId: string, sid: string) {
    await setupClient.query(
      `insert into shared_messaging.tenant_phone_numbers (tenant_id, phone_number, twilio_sid, is_default) values ($1, $2, $3, true)`,
      [tenantId, '+1555000' + sid.slice(-4), 'PN_' + sid],
    );
  }

  beforeAll(async () => {
    setupClient = new Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
    await setupClient.connect();

    await setupClient.query(
      `insert into tenants (id, name, status) values ($1, 'MCT Full Config', 'active'), ($2, 'MCT Defaults', 'active'), ($3, 'MCT No Config', 'active')`,
      [fullConfigTenantId, defaultsTenantId, noConfigTenantId],
    );

    // fullConfigTenant: every field set. defaultsTenant: a config row exists
    // but omits textBackTemplate, so the built-in default must be used.
    // noConfigTenant: no module_manifest row at all.
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'missed-call-textback', true, $2)`,
      [fullConfigTenantId, JSON.stringify(customConfig)],
    );
    await setupClient.query(
      `insert into module_manifest (tenant_id, module_key, enabled, config) values ($1, 'missed-call-textback', true, $2)`,
      [defaultsTenantId, JSON.stringify({ businessName: 'Defaults Co' })],
    );

    await provisionNumber(fullConfigTenantId, 'mct_full_1111');
    await provisionNumber(defaultsTenantId, 'mct_def_2222');
    await provisionNumber(noConfigTenantId, 'mct_none_3333');

    messaging = new MessagingService(new StubSmsClient());
    service = new MissedCallTextbackService(messaging);
  });

  afterAll(async () => {
    const tenantIds = [fullConfigTenantId, defaultsTenantId, noConfigTenantId];
    await setupClient.query(`delete from activity_log where tenant_id = any($1)`, [
      tenantIds,
    ]);
    await setupClient.query(
      `delete from missed_call_textback.missed_calls where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(
      `delete from shared_messaging.tenant_phone_numbers where tenant_id = any($1)`,
      [tenantIds],
    );
    await setupClient.query(`delete from module_manifest where tenant_id = any($1)`, [
      tenantIds,
    ]);
    await setupClient.query(`delete from tenants where id = any($1)`, [tenantIds]);
    await setupClient.end();
    await service.onModuleDestroy();
    await messaging.onModuleDestroy();
  });

  it('stores and reads back all four settings fields with their JSON types', async () => {
    const { rows } = await setupClient.query<{ config: StoredConfig }>(
      `select config from module_manifest where tenant_id = $1 and module_key = 'missed-call-textback'`,
      [fullConfigTenantId],
    );

    expect(rows[0].config).toEqual(customConfig);
    // ringTimeoutSeconds must survive the JSONB round-trip as a number, not a
    // string -- the Step 3 webhook will do arithmetic with it.
    expect(typeof rows[0].config.ringTimeoutSeconds).toBe('number');
    expect(rows[0].config.ringTimeoutSeconds).toBe(35);
  });

  it('applies the stored textBackTemplate, substituting {business_name}', async () => {
    const result = (await service.handleRequest(
      fullConfigTenantId,
      'log-missed-call',
      { phone: callerPhone },
    )) as MissedCallRow;

    expect(result.textback_sent).toBe(true);
    expect(result.textback_body).toBe('Custom: Custom Co will ring you right back.');
  });

  it('falls back to the default template when the config omits textBackTemplate', async () => {
    const result = (await service.handleRequest(
      defaultsTenantId,
      'log-missed-call',
      { phone: callerPhone },
    )) as MissedCallRow;

    expect(result.textback_sent).toBe(true);
    // Default template wording, with the stored businessName substituted in.
    expect(result.textback_body).toContain('Defaults Co');
    expect(result.textback_body).toContain("we couldn't pick up");
  });

  it('uses the default template and a neutral business name when no config row exists', async () => {
    const result = (await service.handleRequest(
      noConfigTenantId,
      'log-missed-call',
      { phone: callerPhone },
    )) as MissedCallRow;

    expect(result.textback_sent).toBe(true);
    // No businessName on file -> the "us" fallback lands in the copy.
    expect(result.textback_body).toBe(
      "Hi! You just called us and we couldn't pick up. Reply here and we'll get right back to you.",
    );
  });
});
