import { Injectable, Optional, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { SendMessageResult } from './sms-client.interface';
import type { SmsClient } from './sms-client.interface';
import { StubSmsClient } from './stub-sms-client';
import { TwilioSmsClient } from './twilio-sms-client';

export interface TenantPhoneNumberRow {
  id: string;
  tenant_id: string;
  phone_number: string;
  twilio_sid: string;
  is_default: boolean;
  label: string | null;
  status: 'active' | 'released';
  created_at: string;
}

export interface ProvisionNumberOptions {
  makeDefault?: boolean;
  label?: string;
}

export interface SendSmsOptions {
  moduleKey: string;
  numberId?: string;
}

function createSmsClient(): SmsClient {
  return process.env.SMS_PROVIDER === 'twilio'
    ? new TwilioSmsClient()
    : new StubSmsClient();
}

// Shared by every module that needs to send SMS -- owns phone number
// provisioning and the active SmsClient (stub or real Twilio, picked via
// SMS_PROVIDER). Modules call provisionNumberForTenant/sendSms and never
// touch an SmsClient directly.
@Injectable()
export class MessagingService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  private readonly client: SmsClient;

  // @Optional() is required here, not just the `?` -- without it Nest still
  // tries to resolve a provider for this param (there isn't one; it's an
  // interface, only ever passed explicitly in tests) and crashes at startup
  // instead of falling through to createSmsClient() below.
  constructor(@Optional() smsClient?: SmsClient) {
    this.client = smsClient ?? createSmsClient();
  }

  async provisionNumberForTenant(
    tenantId: string,
    options?: ProvisionNumberOptions,
  ): Promise<TenantPhoneNumberRow> {
    const existing = await this.pool.query<TenantPhoneNumberRow>(
      `select * from shared_messaging.tenant_phone_numbers where tenant_id = $1 and status = 'active' order by created_at`,
      [tenantId],
    );

    // Already has a number and the caller isn't explicitly asking for a new
    // default -- return what's there instead of purchasing another one.
    if (existing.rows.length > 0 && options?.makeDefault !== true) {
      return existing.rows.find((row) => row.is_default) ?? existing.rows[0];
    }

    const purchased = await this.client.purchaseNumber();
    await this.client.addNumberToMessagingService(purchased.twilioSid);

    const makeDefault =
      options?.makeDefault === true || existing.rows.length === 0;

    if (makeDefault) {
      await this.pool.query(
        `update shared_messaging.tenant_phone_numbers set is_default = false where tenant_id = $1 and is_default = true`,
        [tenantId],
      );
    }

    const inserted = await this.pool.query<TenantPhoneNumberRow>(
      `insert into shared_messaging.tenant_phone_numbers (tenant_id, phone_number, twilio_sid, is_default, label)
       values ($1, $2, $3, $4, $5) returning *`,
      [
        tenantId,
        purchased.phoneNumber,
        purchased.twilioSid,
        makeDefault,
        options?.label ?? null,
      ],
    );

    return inserted.rows[0];
  }

  // Resolves the tenant that owns an inbound Twilio number (the "To" of an
  // incoming call). Returns null for an unrecognized number so callers can
  // handle it safely rather than throwing. Scoped to active numbers only.
  async findTenantByPhoneNumber(
    phoneNumber: string,
  ): Promise<{ tenantId: string } | null> {
    const { rows } = await this.pool.query<{ tenant_id: string }>(
      `select tenant_id from shared_messaging.tenant_phone_numbers where phone_number = $1 and status = 'active' limit 1`,
      [phoneNumber],
    );
    return rows[0] ? { tenantId: rows[0].tenant_id } : null;
  }

  async sendSms(
    tenantId: string,
    to: string,
    body: string,
    options: SendSmsOptions,
  ): Promise<SendMessageResult> {
    const numberRow = options.numberId
      ? (
          await this.pool.query<TenantPhoneNumberRow>(
            `select * from shared_messaging.tenant_phone_numbers where id = $1 and tenant_id = $2 and status = 'active'`,
            [options.numberId, tenantId],
          )
        ).rows[0]
      : (
          await this.pool.query<TenantPhoneNumberRow>(
            `select * from shared_messaging.tenant_phone_numbers where tenant_id = $1 and is_default = true and status = 'active'`,
            [tenantId],
          )
        ).rows[0];

    if (!numberRow) {
      throw new Error(
        `Tenant ${tenantId} has no active phone number to send from`,
      );
    }

    console.log(
      `[messaging] sending SMS for tenant ${tenantId} via module "${options.moduleKey}" from ${numberRow.phone_number} to ${to}`,
    );

    return this.client.sendMessage({ from: numberRow.phone_number, to, body });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
