import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';

/**
 * activity_log event vocabulary for the review-generation module
 * (activity_log.event_type). This is the fixed, complete list -- don't
 * introduce a new event_type without updating this comment.
 *
 * - "review_request_sent" -- a review request SMS was sent to a contact.
 *   Written by review-generation.service.ts. value: { contactId, requestId, channel }.
 * - "review_completed" -- a customer submitted a rating via the public
 *   funnel (this file). Written for every completed submission, regardless
 *   of rating. value: { rating, routedToGoogle, requestId }.
 * - "negative_feedback_captured" -- written IN ADDITION TO "review_completed"
 *   (same transaction, same value shape) whenever rating is 1-3, so the
 *   negative-feedback subset can be queried by event_type alone without
 *   filtering on value->>'rating'.
 */
export interface ReviewStateResult {
  valid: boolean;
}

export interface SubmitReviewResult {
  ok: boolean;
  routedToGoogle?: boolean;
  googleReviewUrl?: string;
}

interface MatchedRequestRow {
  id: string;
  tenant_id: string;
  contact_id: string;
}

/**
 * Backs the public, unauthenticated review funnel (/review/[token]).
 *
 * Deliberately token-scoped ONLY. No method here accepts a tenantId -- the
 * tenant is always derived from the single review_requests row whose token
 * matches the caller-supplied token. There is structurally no way for a
 * caller to name, reach, or affect another tenant's data: the unguessable
 * token IS the authorization. This is the entire security model of the public
 * funnel, so keep it that way -- never add a tenantId parameter to this
 * service, and never trust a tenant id from the request body.
 *
 * Connects as the pooler's default role (postgres), which bypasses RLS. That
 * is required here precisely because there is no JWT: the RLS tenant_isolation
 * policies key off `auth.jwt() ->> 'tenant_id'`, which is null for an
 * anonymous caller and would fail-closed to zero rows. Access is instead
 * gated by the `where token = $1` predicate on every query.
 */
@Injectable()
export class PublicReviewService implements OnModuleDestroy {
  private readonly pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT),
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: process.env.SUPABASE_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  // A single generic, information-free "not valid" response. Returned
  // identically whether the token never existed, was already completed, or
  // expired -- so the page reveals nothing about whether a guessed token is
  // "real but used" vs. "never issued", nor anything about a tenant.
  async getReviewState(token: string): Promise<ReviewStateResult> {
    const result = await this.pool.query<{ status: string }>(
      `select status from review_generation.review_requests where token = $1`,
      [token],
    );

    const row = result.rows[0];
    if (!row || row.status === 'completed' || row.status === 'expired') {
      return { valid: false };
    }
    return { valid: true };
  }

  async submitReview(
    token: string,
    rating: number,
    feedback?: string,
  ): Promise<SubmitReviewResult> {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('rating must be an integer from 1 to 5');
    }

    const client = await this.pool.connect();
    try {
      await client.query('begin');

      // Atomically claim the request: only a still-open row matching THIS
      // token is affected, and only once -- a second submit (or a race) finds
      // no open row and gets the generic invalid response. tenant_id and
      // contact_id come straight off the matched row, never from the caller,
      // so every write below is bound to the token's own tenant.
      const claimed = await client.query<MatchedRequestRow>(
        `update review_generation.review_requests
            set status = 'completed'
          where token = $1 and status not in ('completed', 'expired')
          returning id, tenant_id, contact_id`,
        [token],
      );

      const request = claimed.rows[0];
      if (!request) {
        await client.query('rollback');
        return { ok: false };
      }

      const routedToGoogle = rating >= 4;
      // Feedback text is only retained for low ratings (the private path);
      // high ratings go to Google and never carry free text.
      const feedbackText = rating <= 3 ? (feedback ?? null) : null;

      await client.query(
        `insert into review_generation.review_responses
            (tenant_id, request_id, rating, feedback_text, routed_to_google)
          values ($1, $2, $3, $4, $5)`,
        [request.tenant_id, request.id, rating, feedbackText, routedToGoogle],
      );

      if (rating <= 3) {
        await client.query(
          `insert into notifications (tenant_id, title, body) values ($1, $2, $3)`,
          [
            request.tenant_id,
            `New private feedback (${rating}★)`,
            feedbackText ??
              'A customer left a low rating without written feedback.',
          ],
        );
      }

      const activityValue = JSON.stringify({
        rating,
        routedToGoogle,
        requestId: request.id,
      });
      await client.query(
        `insert into activity_log (tenant_id, module_key, event_type, value)
          values ($1, 'review-generation', 'review_completed', $2)`,
        [request.tenant_id, activityValue],
      );
      if (rating <= 3) {
        await client.query(
          `insert into activity_log (tenant_id, module_key, event_type, value)
            values ($1, 'review-generation', 'negative_feedback_captured', $2)`,
          [request.tenant_id, activityValue],
        );
      }

      let googleReviewUrl: string | undefined;
      if (routedToGoogle) {
        const cfg = await client.query<{
          config: { googleReviewUrl?: string };
        }>(
          `select config from module_manifest where tenant_id = $1 and module_key = 'review-generation'`,
          [request.tenant_id],
        );
        const url = cfg.rows[0]?.config?.googleReviewUrl;
        if (typeof url === 'string' && url.length > 0) {
          googleReviewUrl = url;
        }
      }

      await client.query('commit');

      return { ok: true, routedToGoogle, googleReviewUrl };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
