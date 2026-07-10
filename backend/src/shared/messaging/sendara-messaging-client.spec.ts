import { SendaraMessagingClient } from './sendara-messaging-client';
import {
  MessagingAuthError,
  MessagingNotFoundError,
  MessagingNotSupportedError,
  MessagingRateLimitError,
  MessagingRequestError,
  MessagingServerError,
} from './messaging-errors';

// Builds a minimal Response-like object -- enough of the fetch Response
// surface (status, ok, json, headers.get) for the client under test, so no
// real network or Sendara account is involved.
function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

// A fetch double that returns each queued response in order. Records every
// call so tests can assert URL, method, and headers.
function queuedFetch(responses: Response[]): jest.Mock {
  const queue = [...responses];
  return jest.fn(() => {
    const next = queue.shift();
    if (!next) {
      throw new Error('queuedFetch: more calls than queued responses');
    }
    return Promise.resolve(next);
  });
}

const OPTS = { apiKey: 'sendara_test_key', baseUrl: 'https://api.sendara.io' };

// A no-wait sleep so retry tests do not actually pause; records the ms it was
// asked to wait so we can assert the client honoured Sendara's retryAfter.
function makeSleep() {
  const calls: number[] = [];
  const sleep = jest.fn((ms: number) => {
    calls.push(ms);
    return Promise.resolve();
  });
  return { sleep, calls };
}

describe('SendaraMessagingClient', () => {
  describe('constructor', () => {
    it('throws when no API key is available', () => {
      const original = process.env.SENDARA_API_KEY;
      delete process.env.SENDARA_API_KEY;
      try {
        expect(() => new SendaraMessagingClient()).toThrow(/SENDARA_API_KEY/);
      } finally {
        if (original !== undefined) process.env.SENDARA_API_KEY = original;
      }
    });
  });

  describe('sendMessage', () => {
    it('POSTs a text message and maps the envelope to a SentMessage', async () => {
      const fetchImpl = queuedFetch([
        fakeResponse(200, {
          success: true,
          data: {
            id: 12345,
            phone: '+15555550123',
            message_type: 'text',
            content: 'hello',
            sent_at: '2025-01-15T10:30:00Z',
          },
          message: 'Message sent successfully',
        }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl });

      const result = await client.sendMessage('+15555550123', 'hello');

      expect(result).toEqual({
        id: 12345,
        phone: '+15555550123',
        sentAt: '2025-01-15T10:30:00Z',
      });

      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.sendara.io/v1/send-message');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(
        'sendara_test_key',
      );
      expect(JSON.parse(init.body as string)).toEqual({
        phone: '+15555550123',
        message_type: 'text',
        content: 'hello',
      });
    });

    it('throws MessagingAuthError on 401', async () => {
      const fetchImpl = queuedFetch([
        fakeResponse(401, { success: false, error: 'Invalid API key' }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl });

      await expect(client.sendMessage('+1555', 'x')).rejects.toBeInstanceOf(
        MessagingAuthError,
      );
    });

    it('throws MessagingRequestError on 400', async () => {
      const fetchImpl = queuedFetch([
        fakeResponse(400, {
          success: false,
          error: 'Missing required fields: message_type and content',
        }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl });

      await expect(client.sendMessage('+1555', 'x')).rejects.toBeInstanceOf(
        MessagingRequestError,
      );
    });

    it('throws MessagingNotFoundError on 404', async () => {
      const fetchImpl = queuedFetch([
        fakeResponse(404, { success: false, error: 'Lead not found' }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl });

      await expect(client.sendMessage('+1555', 'x')).rejects.toBeInstanceOf(
        MessagingNotFoundError,
      );
    });

    it('throws MessagingServerError on 500', async () => {
      const fetchImpl = queuedFetch([
        fakeResponse(500, {
          success: false,
          error: 'Failed to send message. Check input fields or Try later.',
        }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl });

      await expect(client.sendMessage('+1555', 'x')).rejects.toBeInstanceOf(
        MessagingServerError,
      );
    });

    it('honours retryAfter on 429 and succeeds on retry rather than crashing', async () => {
      const { sleep, calls } = makeSleep();
      const fetchImpl = queuedFetch([
        fakeResponse(429, {
          success: false,
          error: 'Rate limit reached. Please slow down your requests.',
          limit: 25,
          retryAfter: 3,
        }),
        fakeResponse(200, {
          success: true,
          data: {
            id: 999,
            phone: '+15555550123',
            message_type: 'text',
            content: 'hello',
            sent_at: '2025-01-15T10:31:00Z',
          },
          message: 'Message sent successfully',
        }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl, sleep });

      const result = await client.sendMessage('+15555550123', 'hello');

      // Recovered on the retry instead of throwing...
      expect(result.id).toBe(999);
      // ...after honouring the documented retryAfter (3s -> 3000ms)...
      expect(calls).toEqual([3000]);
      // ...and it did make a second request.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('throws MessagingRateLimitError only after retries are exhausted', async () => {
      const { sleep, calls } = makeSleep();
      const rateLimited = () =>
        fakeResponse(429, {
          success: false,
          error: 'Rate limit reached. Please slow down your requests.',
          retryAfter: 2,
        });
      // maxRetries: 1 -> one initial attempt plus one retry, both 429.
      const fetchImpl = queuedFetch([rateLimited(), rateLimited()]);
      const client = new SendaraMessagingClient({
        ...OPTS,
        fetchImpl,
        sleep,
        maxRetries: 1,
      });

      const error = await client
        .sendMessage('+1555', 'x')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MessagingRateLimitError);
      expect((error as MessagingRateLimitError).retryAfter).toBe(2);
      // Backed off once (the single allowed retry) before giving up.
      expect(calls).toEqual([2000]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkPlatform', () => {
    it('GETs platform-lookup with the phone query and returns the platform', async () => {
      const fetchImpl = queuedFetch([
        fakeResponse(200, {
          success: true,
          data: { phone: '+15555550123', platform: 'iMessage' },
        }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl });

      const platform = await client.checkPlatform('+15555550123');

      expect(platform).toBe('iMessage');
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://api.sendara.io/v1/platform-lookup?phone=%2B15555550123',
      );
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(
        'sendara_test_key',
      );
    });

    it('throws MessagingAuthError on 401', async () => {
      const fetchImpl = queuedFetch([
        fakeResponse(401, { success: false, error: 'Missing API key' }),
      ]);
      const client = new SendaraMessagingClient({ ...OPTS, fetchImpl });

      await expect(client.checkPlatform('+1555')).rejects.toBeInstanceOf(
        MessagingAuthError,
      );
    });
  });

  describe('provisionLine', () => {
    it('rejects with MessagingNotSupportedError (no Sendara provisioning API yet)', async () => {
      const client = new SendaraMessagingClient(OPTS);

      await expect(client.provisionLine()).rejects.toBeInstanceOf(
        MessagingNotSupportedError,
      );
    });
  });
});
