import {
  MessagingClient,
  MessagingPlatform,
  SentMessage,
} from './messaging-client.interface';
import {
  MessagingAuthError,
  MessagingError,
  MessagingNotFoundError,
  MessagingNotSupportedError,
  MessagingRateLimitError,
  MessagingRequestError,
  MessagingServerError,
} from './messaging-errors';

// Real MessagingClient backed by Sendara's REST API (https://api.sendara.io,
// spec v1.0.1). Auth is a single API key in the x-api-key header, read from
// SENDARA_API_KEY; the sending line is whatever that key is bound to, so there
// is no `from`. Only the two fully documented, safe-to-build endpoints are
// wired up here: POST /v1/send-message and GET /v1/platform-lookup. Line
// provisioning is left unsupported (Sendara documents no agency provisioning
// endpoint) and inbound/webhook handling is absent by design (Sendara
// documents no webhook payload or signature scheme to build against).
//
// Kept SDK-free over plain fetch, matching GoTrueInviteClient -- these are two
// stable POST/GET calls, not worth a dependency.

// Sendara's documented limit is 25 requests/minute per key; over it returns
// 429 with a retryAfter (seconds). We honour retryAfter and retry rather than
// failing the caller immediately, up to this many extra attempts.
const DEFAULT_MAX_RETRIES = 2;
// Fallback wait if a 429 somehow arrives without a retryAfter body field or
// Retry-After header. Kept close to the documented 60s window.
const DEFAULT_RETRY_AFTER_SECONDS = 60;

type SleepFn = (ms: number) => Promise<void>;

export interface SendaraMessagingClientOptions {
  // Overrides SENDARA_API_KEY -- mainly for tests.
  apiKey?: string;
  // Defaults to https://api.sendara.io. Override for a test double.
  baseUrl?: string;
  // Injected for testability; defaults to the global fetch.
  fetchImpl?: typeof fetch;
  // Injected so tests need not actually wait out a retryAfter; defaults to a
  // real setTimeout-based delay.
  sleep?: SleepFn;
  // Extra attempts after a 429 before giving up. Defaults to 2.
  maxRetries?: number;
}

// Shape of Sendara's response envelope. `data` is endpoint-specific; `error`
// is present on failures. Both success and error bodies are parsed the same
// way so the error message can always be surfaced.
interface SendaraEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  // Present on 429 bodies.
  retryAfter?: number;
  limit?: number;
}

interface SendMessageData {
  id: number;
  phone: string;
  message_type: string;
  content: string;
  sent_at: string;
}

interface PlatformLookupData {
  phone: string;
  platform: MessagingPlatform;
}

export class SendaraMessagingClient implements MessagingClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: SleepFn;
  private readonly maxRetries: number;

  constructor(options: SendaraMessagingClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.SENDARA_API_KEY;
    if (!apiKey) {
      // Fail closed, same posture as TwilioSmsClient/GoTrueInviteClient: no
      // key means no way to send, not a silent stub fallback.
      throw new Error(
        'SENDARA_API_KEY is not set; cannot use SendaraMessagingClient',
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.sendara.io').replace(
      /\/+$/,
      '',
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async sendMessage(to: string, body: string): Promise<SentMessage> {
    const data = await this.request<SendMessageData>(
      'POST',
      '/v1/send-message',
      {
        phone: to,
        message_type: 'text',
        content: body,
      },
    );

    return { id: data.id, phone: data.phone, sentAt: data.sent_at };
  }

  async checkPlatform(phone: string): Promise<MessagingPlatform> {
    const query = new URLSearchParams({ phone }).toString();
    const data = await this.request<PlatformLookupData>(
      'GET',
      `/v1/platform-lookup?${query}`,
    );

    return data.platform;
  }

  provisionLine(): Promise<never> {
    // Sendara documents no agency-mode provisioning endpoint. Rather than guess
    // at an undocumented call, fail loudly until they confirm one exists.
    return Promise.reject(
      new MessagingNotSupportedError(
        'Line provisioning is not yet supported -- pending Sendara answer on agency provisioning',
      ),
    );
  }

  // Single request path shared by both endpoints. Sends the API key, retries on
  // 429 honouring Sendara's retryAfter, and maps every documented error status
  // to a typed MessagingError. Returns the envelope's `data` on success.
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    jsonBody?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          'x-api-key': this.apiKey,
          ...(jsonBody === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
        },
        body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
      });

      const envelope = (await res
        .json()
        .catch(() => null)) as SendaraEnvelope<T> | null;

      if (res.status === 429) {
        const retryAfter = this.resolveRetryAfter(res, envelope);
        if (attempt < this.maxRetries) {
          // Honour Sendara's backoff and try again rather than failing the
          // caller on a transient rate-limit.
          await this.sleep(retryAfter * 1000);
          continue;
        }
        throw new MessagingRateLimitError(
          envelope?.error ??
            'Rate limit reached. Please slow down your requests.',
          retryAfter,
        );
      }

      if (!res.ok) {
        throw this.mapError(res.status, envelope);
      }

      if (
        !envelope ||
        envelope.success !== true ||
        envelope.data === undefined
      ) {
        // 2xx but not the documented { success: true, data } envelope -- treat
        // as a server-side contract violation rather than returning garbage.
        throw new MessagingServerError(
          envelope?.error ?? 'Malformed success response from Sendara',
          res.status,
        );
      }

      return envelope.data;
    }
  }

  private resolveRetryAfter(
    res: Response,
    envelope: SendaraEnvelope<unknown> | null,
  ): number {
    // Prefer the documented body field, fall back to the standard header, then
    // to a sane default so we never divide/multiply by NaN.
    const fromBody = envelope?.retryAfter;
    const fromHeader = Number(res.headers.get('retry-after'));
    const seconds =
      fromBody ?? (Number.isFinite(fromHeader) ? fromHeader : NaN);

    return Number.isFinite(seconds) && seconds > 0
      ? seconds
      : DEFAULT_RETRY_AFTER_SECONDS;
  }

  private mapError(
    status: number,
    envelope: SendaraEnvelope<unknown> | null,
  ): MessagingError {
    const message = envelope?.error ?? `Sendara request failed (${status})`;

    switch (status) {
      case 400:
        return new MessagingRequestError(message);
      case 401:
        return new MessagingAuthError(message);
      case 404:
        return new MessagingNotFoundError(message);
      default:
        if (status >= 500) {
          return new MessagingServerError(message, status);
        }
        return new MessagingError(message, status);
    }
  }
}
