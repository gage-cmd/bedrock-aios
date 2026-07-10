import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  ModuleContract,
  ModuleStatus,
  SnapshotResult,
} from '../../core/module-registry/module-contract';
import { MessagingService } from '../../shared/messaging/messaging.service';

export interface MissedCallRow {
  id: string;
  tenant_id: string;
  contact_phone: string;
  missed_at: string;
  textback_sent: boolean;
  textback_body: string | null;
  created_at: string;
}

const DEFAULT_TEXTBACK_TEMPLATE =
  "Hi! You just called {business_name} and we couldn't pick up. Reply here and we'll get right back to you.";

export const DEFAULT_RING_TIMEOUT_SECONDS = 20;

export interface DialSettings {
  destinationNumber: string | null;
  ringTimeoutSeconds: number;
}

function renderTemplate(template: string, businessName: string): string {
  return template.replace(/{business_name}/g, businessName);
}

@Injectable()
export class MissedCallTextbackService
  implements ModuleContract, OnModuleDestroy
{
  private readonly pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  constructor(private readonly messaging: MessagingService) {}

  async handleRequest(
    tenantId: string,
    intent: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    switch (intent) {
      case 'log-missed-call':
        return this.logMissedCall(tenantId, payload as { phone: string });
      case 'get-recent-missed-calls':
        return this.getRecentMissedCalls(tenantId, payload);
      default:
        throw new Error(`Unknown missed-call-textback intent: ${intent}`);
    }
  }

  private async logMissedCall(
    tenantId: string,
    { phone }: { phone: string },
  ): Promise<MissedCallRow> {
    if (!phone) {
      throw new Error('Caller phone number is required');
    }

    const config = await this.getConfig(tenantId);
    const template =
      typeof config.textBackTemplate === 'string'
        ? config.textBackTemplate
        : DEFAULT_TEXTBACK_TEMPLATE;
    const businessName =
      typeof config.businessName === 'string' ? config.businessName : 'us';

    // Insert first with textback_sent defaulting to false. Unlike
    // review_requests (whose status column claims the send already
    // happened, so a failed send deletes the row), a missed call genuinely
    // occurred whether or not the text-back goes out -- on send failure the
    // row is kept, accurately recording an unrecovered missed call.
    const inserted = await this.pool.query<MissedCallRow>(
      `insert into missed_call_textback.missed_calls (tenant_id, contact_phone) values ($1, $2) returning *`,
      [tenantId, phone],
    );
    const missedCall = inserted.rows[0];

    const body = renderTemplate(template, businessName);
    await this.messaging.sendSms(tenantId, phone, body, {
      moduleKey: 'missed-call-textback',
    });

    const updated = await this.pool.query<MissedCallRow>(
      `update missed_call_textback.missed_calls set textback_sent = true, textback_body = $1 where id = $2 returning *`,
      [body, missedCall.id],
    );

    await this.pool.query(
      `insert into activity_log (tenant_id, module_key, event_type, value) values ($1, 'missed-call-textback', 'missed_call_textback_sent', $2)`,
      [
        tenantId,
        JSON.stringify({ missedCallId: missedCall.id, contactPhone: phone }),
      ],
    );

    return updated.rows[0];
  }

  private async getRecentMissedCalls(
    tenantId: string,
    { limit = 20 }: { limit?: number } = {},
  ): Promise<MissedCallRow[]> {
    const result = await this.pool.query<MissedCallRow>(
      'select * from missed_call_textback.missed_calls where tenant_id = $1 order by missed_at desc limit $2',
      [tenantId, limit],
    );
    return result.rows;
  }

  async getSnapshot(tenantId: string): Promise<SnapshotResult> {
    const result = await this.pool.query<{ count: number }>(
      `select count(*)::int as count from missed_call_textback.missed_calls
       where tenant_id = $1 and textback_sent and missed_at >= now() - interval '7 days'`,
      [tenantId],
    );

    const count = result.rows[0].count;
    return {
      metric: 'Missed calls recovered this week',
      value: `${count} text-back${count === 1 ? '' : 's'} sent`,
    };
  }

  async getStatus(tenantId: string): Promise<ModuleStatus> {
    const result = await this.pool.query(
      `select 1 from shared_messaging.tenant_phone_numbers where tenant_id = $1 and status = 'active' limit 1`,
      [tenantId],
    );

    if (result.rows.length > 0) {
      return { status: 'connected' };
    }
    return { status: 'needs attention', reason: 'no SMS number provisioned' };
  }

  getCapabilities(): string[] {
    return [
      'How many missed calls did we recover this week',
      'Show me recent missed-call text-backs',
    ];
  }

  // Read-only intents the orchestrator may route to. log-missed-call is
  // deliberately absent -- the orchestrator answers questions, it must never
  // send a text-back on its own.
  getQueryableIntents(): { intent: string; description: string }[] {
    return [
      {
        intent: 'get-recent-missed-calls',
        description:
          'List recent missed calls for this business, including whether an automatic text-back was sent and what it said.',
      },
    ];
  }

  // Dial settings the Twilio voice webhook needs to forward an incoming call:
  // where to ring (destinationNumber) and for how long before it counts as
  // missed (ringTimeoutSeconds, defaulting to 20). destinationNumber is null
  // when the tenant hasn't configured one yet, so the webhook can decline to
  // dial rather than forward to nowhere.
  async getDialSettings(tenantId: string): Promise<DialSettings> {
    const config = await this.getConfig(tenantId);
    const destinationNumber =
      typeof config.destinationNumber === 'string' &&
      config.destinationNumber.length > 0
        ? config.destinationNumber
        : null;
    const ringTimeoutSeconds =
      typeof config.ringTimeoutSeconds === 'number' &&
      config.ringTimeoutSeconds > 0
        ? config.ringTimeoutSeconds
        : DEFAULT_RING_TIMEOUT_SECONDS;
    return { destinationNumber, ringTimeoutSeconds };
  }

  private async getConfig(tenantId: string): Promise<Record<string, unknown>> {
    const result = await this.pool.query<{ config: Record<string, unknown> }>(
      `select config from module_manifest where tenant_id = $1 and module_key = 'missed-call-textback'`,
      [tenantId],
    );
    return result.rows[0]?.config ?? {};
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
