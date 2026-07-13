import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { getSharedPool, closeSharedPool } from '../../shared/db/pg-pool';
import type {
  ModuleContract,
  ModuleStatus,
  SnapshotV2,
} from '../../core/module-registry/module-contract';
import { MessagingService } from '../../shared/messaging/messaging.service';
import {
  fillDailySeries,
  weekDelta,
} from '../../shared/snapshots/snapshot-helpers';

export interface ContactRow {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
}

export interface ReviewRequestRow {
  id: string;
  tenant_id: string;
  contact_id: string;
  channel: 'sms' | 'email';
  sent_at: string;
  status: 'sent' | 'clicked' | 'completed' | 'expired';
  token: string;
}

export interface ReviewResponseRow {
  id: string;
  tenant_id: string;
  request_id: string;
  rating: number;
  feedback_text: string | null;
  routed_to_google: boolean;
  submitted_at: string;
}

// Mirrors prompts/review-request-sms.txt -- kept as a plain constant (rather
// than read off disk at runtime) so the module doesn't need a build step to
// copy non-ts assets into dist for one string. The .txt file is the
// human-readable copy for anyone editing the default in prompts/.
const DEFAULT_SMS_TEMPLATE =
  "Hi {customer_name}! Thanks so much for choosing {business_name}. We'd really appreciate a quick review -- it means a lot to a small business like ours.";

function renderTemplate(
  template: string,
  customerName: string,
  businessName: string,
): string {
  return template
    .replace(/{customer_name}/g, customerName)
    .replace(/{business_name}/g, businessName);
}

@Injectable()
export class ReviewGenerationService
  implements ModuleContract, OnModuleDestroy
{
  private readonly pool = getSharedPool();

  constructor(private readonly messaging: MessagingService) {}

  async handleRequest(
    tenantId: string,
    intent: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    switch (intent) {
      case 'send-review-request':
        return this.sendReviewRequest(
          tenantId,
          payload as { contactId: string },
        );
      case 'get-recent-responses':
        return this.getRecentResponses(tenantId, payload);
      case 'get-recent-requests':
        return this.getRecentRequests(tenantId, payload);
      case 'list-contacts':
        return this.listContacts(tenantId);
      case 'create-contact':
        return this.createContact(
          tenantId,
          payload as { name: string; phone?: string; email?: string },
        );
      default:
        throw new Error(`Unknown review-generation intent: ${intent}`);
    }
  }

  private async sendReviewRequest(
    tenantId: string,
    { contactId }: { contactId: string },
  ): Promise<{ requestId: string; token: string; status: string }> {
    const contact = (
      await this.pool.query<ContactRow>(
        'select * from review_generation.contacts where id = $1 and tenant_id = $2',
        [contactId, tenantId],
      )
    ).rows[0];

    if (!contact) {
      throw new Error('Contact not found for this tenant');
    }
    if (!contact.phone) {
      throw new Error('Contact has no phone number on file');
    }

    const config = await this.getConfig(tenantId);
    const template =
      typeof config.smsTemplate === 'string'
        ? config.smsTemplate
        : DEFAULT_SMS_TEMPLATE;
    const businessName =
      typeof config.businessName === 'string' ? config.businessName : '';

    const inserted = await this.pool.query<ReviewRequestRow>(
      `insert into review_generation.review_requests (tenant_id, contact_id, channel) values ($1, $2, 'sms') returning *`,
      [tenantId, contactId],
    );
    const request = inserted.rows[0];

    const reviewLink = `${process.env.REVIEW_LINK_BASE_URL ?? 'https://getbedrockai.com/r'}/${request.token}`;
    const body = `${renderTemplate(template, contact.name, businessName)}\n\n${reviewLink}`;

    try {
      await this.messaging.sendSms(tenantId, contact.phone, body, {
        moduleKey: 'review-generation',
      });
    } catch (err) {
      // The row's status defaults to 'sent' on insert, so if the send
      // itself fails (e.g. no phone number provisioned yet), delete it --
      // otherwise it's left behind falsely claiming the message went out.
      await this.pool.query(
        'delete from review_generation.review_requests where id = $1',
        [request.id],
      );
      throw err;
    }

    // See public-review.service.ts for this module's full activity_log
    // event_type vocabulary (review_request_sent / review_completed /
    // negative_feedback_captured).
    await this.pool.query(
      `insert into activity_log (tenant_id, module_key, event_type, value) values ($1, 'review-generation', 'review_request_sent', $2)`,
      [
        tenantId,
        JSON.stringify({ contactId, requestId: request.id, channel: 'sms' }),
      ],
    );

    return {
      requestId: request.id,
      token: request.token,
      status: request.status,
    };
  }

  private async getRecentResponses(
    tenantId: string,
    { limit = 20 }: { limit?: number } = {},
  ): Promise<ReviewResponseRow[]> {
    const result = await this.pool.query<ReviewResponseRow>(
      'select * from review_generation.review_responses where tenant_id = $1 order by submitted_at desc limit $2',
      [tenantId, limit],
    );
    return result.rows;
  }

  private async getRecentRequests(
    tenantId: string,
    { limit = 20 }: { limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `select rr.id, rr.contact_id, c.name as contact_name, rr.channel, rr.sent_at, rr.status,
              resp.rating, resp.submitted_at as responded_at
       from review_generation.review_requests rr
       join review_generation.contacts c on c.id = rr.contact_id
       left join review_generation.review_responses resp on resp.request_id = rr.id
       where rr.tenant_id = $1
       order by rr.sent_at desc
       limit $2`,
      [tenantId, limit],
    );
    return result.rows;
  }

  private async listContacts(tenantId: string): Promise<ContactRow[]> {
    const result = await this.pool.query<ContactRow>(
      'select * from review_generation.contacts where tenant_id = $1 order by created_at desc',
      [tenantId],
    );
    return result.rows;
  }

  private async createContact(
    tenantId: string,
    { name, phone, email }: { name: string; phone?: string; email?: string },
  ): Promise<ContactRow> {
    if (!name) {
      throw new Error('Contact name is required');
    }

    const result = await this.pool.query<ContactRow>(
      'insert into review_generation.contacts (tenant_id, name, phone, email) values ($1, $2, $3, $4) returning *',
      [tenantId, name, phone ?? null, email ?? null],
    );
    return result.rows[0];
  }

  async getSnapshot(tenantId: string): Promise<SnapshotV2> {
    const [counts, seriesRows, lowRatings, recent] = await Promise.all([
      this.pool.query<{
        requests_week: number;
        completed_week: number;
        avg_week: number | null;
        avg_prior_week: number | null;
      }>(
        `select
           (select count(*)::int from review_generation.review_requests
            where tenant_id = $1 and sent_at >= now() - interval '7 days') as requests_week,
           (select count(*)::int from review_generation.review_responses
            where tenant_id = $1 and submitted_at >= now() - interval '7 days') as completed_week,
           (select avg(rating)::float from review_generation.review_responses
            where tenant_id = $1 and submitted_at >= now() - interval '7 days') as avg_week,
           (select avg(rating)::float from review_generation.review_responses
            where tenant_id = $1 and submitted_at >= now() - interval '14 days'
              and submitted_at < now() - interval '7 days') as avg_prior_week`,
        [tenantId],
      ),
      this.pool.query<{ date: string; value: number }>(
        `select to_char(date_trunc('day', submitted_at at time zone 'UTC'), 'YYYY-MM-DD') as date,
                count(*)::int as value
         from review_generation.review_responses
         where tenant_id = $1 and submitted_at >= now() - interval '14 days'
         group by 1`,
        [tenantId],
      ),
      this.pool.query<{ id: string; rating: number; has_feedback: boolean }>(
        `select id, rating, (feedback_text is not null) as has_feedback
         from review_generation.review_responses
         where tenant_id = $1 and rating <= 3
           and submitted_at >= now() - interval '7 days'
         order by submitted_at desc limit 5`,
        [tenantId],
      ),
      this.pool.query<{ rating: number; submitted_at: string }>(
        `select rating, submitted_at from review_generation.review_responses
         where tenant_id = $1
         order by submitted_at desc limit 5`,
        [tenantId],
      ),
    ]);

    const c = counts.rows[0];
    const avg = c.avg_week === null ? null : Number(c.avg_week);
    const avgPrior =
      c.avg_prior_week === null ? null : Number(c.avg_prior_week);

    return {
      headline: {
        label: 'Reviews completed this week',
        value:
          c.completed_week === 0
            ? '0 completed'
            : `${c.completed_week} completed, ${avg!.toFixed(1)}★ avg`,
      },
      metrics: [
        {
          key: 'requests-week',
          label: 'Requests sent this week',
          value: String(c.requests_week),
        },
        {
          key: 'completion-rate',
          label: 'Completion rate',
          value:
            c.requests_week === 0
              ? '—'
              : `${Math.round((c.completed_week / c.requests_week) * 100)}%`,
        },
        {
          key: 'avg-rating',
          label: 'Average rating',
          value: avg === null ? '—' : `${avg.toFixed(1)}★`,
          delta:
            avg !== null && avgPrior !== null
              ? weekDelta(Number(avg.toFixed(1)), Number(avgPrior.toFixed(1)), {
                  unit: '★',
                })
              : undefined,
        },
      ],
      series: {
        label: 'Reviews completed per day',
        points: fillDailySeries(seriesRows.rows, 14),
      },
      attention: lowRatings.rows.map((row) => ({
        key: row.id,
        text: row.has_feedback
          ? `A ${row.rating}★ response came with private feedback to read`
          : `A ${row.rating}★ response came in this week`,
        href: '/installed-systems/review-generation?tab=activity',
      })),
      recentEvents: recent.rows.map((row) => ({
        at: new Date(row.submitted_at).toISOString(),
        text: `New ${row.rating}★ review completed`,
      })),
    };
  }

  async getStatus(tenantId: string): Promise<ModuleStatus> {
    const [numberResult, config] = await Promise.all([
      this.pool.query(
        `select 1 from shared_messaging.tenant_phone_numbers where tenant_id = $1 and status = 'active' limit 1`,
        [tenantId],
      ),
      this.getConfig(tenantId),
    ]);

    const hasNumber = numberResult.rows.length > 0;
    const hasGoogleLink =
      typeof config.googleReviewUrl === 'string' &&
      config.googleReviewUrl.length > 0;

    if (hasNumber && hasGoogleLink) {
      return { status: 'connected' };
    }

    const reasons: string[] = [];
    if (!hasNumber) reasons.push('no SMS number provisioned');
    if (!hasGoogleLink) reasons.push('no Google review link configured');

    return { status: 'needs attention', reason: reasons.join(' and ') };
  }

  getCapabilities(): string[] {
    return [
      'How many reviews were requested this week',
      "What's our average rating",
      'Show me recent feedback',
    ];
  }

  // Read-only intents the orchestrator may route to. send-review-request and
  // create-contact are deliberately absent -- the orchestrator answers
  // questions, it must never message a customer or write CRM data on its own.
  getQueryableIntents(): { intent: string; description: string }[] {
    return [
      {
        intent: 'get-recent-requests',
        description:
          'List recent review requests sent to customers, with their status and any rating received.',
      },
      {
        intent: 'get-recent-responses',
        description:
          'List recent completed review responses, including star rating and any written feedback.',
      },
    ];
  }

  private async getConfig(tenantId: string): Promise<Record<string, unknown>> {
    const result = await this.pool.query<{ config: Record<string, unknown> }>(
      `select config from module_manifest where tenant_id = $1 and module_key = 'review-generation'`,
      [tenantId],
    );
    return result.rows[0]?.config ?? {};
  }

  async onModuleDestroy(): Promise<void> {
    await closeSharedPool();
  }
}
