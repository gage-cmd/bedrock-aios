import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { validateRequest } from 'twilio';

// The externally-visible base URL Twilio actually reaches us on (scheme +
// host, no trailing slash). Twilio computes its signature over the FULL URL
// it requested, so behind a proxy (Railway) req.protocol/host can't be
// trusted -- this must be set to the real public origin in any environment
// that receives live Twilio traffic. Defaults to the local dev port so the
// stack runs without it configured.
export function publicBaseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 3001}`
  );
}

/**
 * Verifies Twilio's X-Twilio-Signature on inbound webhook requests.
 *
 * These endpoints are machine-to-machine (Twilio's infrastructure calls
 * them), so there is no tenant JWT -- authenticity is proven by the HMAC
 * signature Twilio computes over the exact request URL plus its POST params,
 * keyed by the account's Auth Token. A request that is missing the header, or
 * whose signature doesn't verify, is rejected here with 403 BEFORE the route
 * handler runs -- so no tenant lookup, database write, or messaging happens
 * for an unverified request.
 *
 * Because the signature covers the URL including its query string, any
 * context we place there (e.g. the statusCallback's tenantId) is integrity
 * protected: it cannot be altered without invalidating the signature.
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      // Fail closed: with no token we cannot verify anything, so we must not
      // treat the request as trusted.
      throw new ForbiddenException('Twilio signature verification unavailable');
    }

    const signature = req.header('X-Twilio-Signature');
    if (!signature) {
      throw new ForbiddenException('Missing Twilio signature');
    }

    const url = `${publicBaseUrl()}${req.originalUrl}`;
    // req.body is the express-parsed urlencoded form Twilio POSTs; for a GET
    // it is empty, which is what validateRequest expects.
    const params = (req.body ?? {}) as Record<string, string>;

    if (!validateRequest(authToken, signature, url, params)) {
      throw new ForbiddenException('Invalid Twilio signature');
    }

    return true;
  }
}
