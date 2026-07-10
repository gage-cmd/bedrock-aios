// Typed errors for the Sendara-backed MessagingClient. Every documented
// Sendara error shape maps to exactly one of these so callers can branch on
// the class (auth vs. rate limit vs. bad request) instead of string-matching
// status codes. Sendara's error envelope is always { success: false, error }
// (plus optional extras like retryAfter on 429); `error` is carried through as
// the message, and the HTTP status is preserved on `status`.

export class MessagingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MessagingError';
  }
}

// 401 -- SENDARA_API_KEY missing from the request or rejected by Sendara.
export class MessagingAuthError extends MessagingError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'MessagingAuthError';
  }
}

// 400 -- malformed request (missing/invalid fields, bad message_type, etc.).
export class MessagingRequestError extends MessagingError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'MessagingRequestError';
  }
}

// 404 -- Sendara could not find the target (e.g. lead not found).
export class MessagingNotFoundError extends MessagingError {
  constructor(message: string) {
    super(message, 404);
    this.name = 'MessagingNotFoundError';
  }
}

// 429 -- the documented 25 requests/minute per-key limit was hit. retryAfter
// is the number of seconds Sendara says to wait; the client honours it with a
// backoff/retry and only surfaces this error once retries are exhausted.
export class MessagingRateLimitError extends MessagingError {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super(message, 429);
    this.name = 'MessagingRateLimitError';
  }
}

// 500 (and any other 5xx) -- Sendara-side failure. Retrying the same request
// may or may not help; we surface it rather than pretending the send worked.
export class MessagingServerError extends MessagingError {
  constructor(message: string, status = 500) {
    super(message, status);
    this.name = 'MessagingServerError';
  }
}

// Thrown by capabilities that are intentionally not built yet because Sendara
// has not documented them: line provisioning (no agency-mode provisioning
// endpoint exists) and inbound/webhook handling (no documented delivery
// mechanism or signature scheme). Distinct from MessagingError so a caller can
// tell "not supported yet" apart from a real send/lookup failure.
export class MessagingNotSupportedError extends MessagingError {
  constructor(message: string) {
    super(message);
    this.name = 'MessagingNotSupportedError';
  }
}
