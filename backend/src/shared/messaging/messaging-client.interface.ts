// The messaging abstraction for the Sendara migration. This is deliberately
// SEPARATE from SmsClient (the Twilio-shaped interface in
// sms-client.interface.ts): Sendara is not an SMS gateway but an
// iMessage-first service (iMessage -> WhatsApp -> SMS fallback) whose line is
// implied by the API key rather than passed as a `from` number, so it needs
// its own shape. Twilio Voice and the Twilio SmsClient are untouched by this.
//
// Only the fully documented, safe-to-build-now surface lives here. Two Sendara
// capabilities are intentionally represented but not implemented:
//   - provisionLine(): Sendara documents no agency-mode line-provisioning
//     endpoint. Left throwing MessagingNotSupportedError pending their answer.
//   - inbound/webhooks: not on the interface at all -- Sendara documents no
//     webhook payload or signature scheme, so there is nothing safe to build.

// The three platforms Sendara's platform-lookup can report, in its own
// priority order (iMessage first, SMS as the fallback).
export type MessagingPlatform = 'iMessage' | 'WhatsApp' | 'SMS';

// Result of a successful POST /v1/send-message, projected from Sendara's
// { success, data: { id, phone, message_type, content, sent_at }, message }
// envelope down to what callers actually need.
export interface SentMessage {
  // Sendara's message id (its `data.id`).
  id: number;
  // The recipient number Sendara accepted the message for.
  phone: string;
  // ISO 8601 timestamp from Sendara's `sent_at`.
  sentAt: string;
}

// Implemented by StubMessagingClient (default, no Sendara account required)
// and SendaraMessagingClient (real, backed by https://api.sendara.io). Callers
// should not know or care which one is active.
export interface MessagingClient {
  // Sends a plain-text message to `to`. The sending line is implied by the
  // configured Sendara API key -- there is no `from`. Throws a typed
  // MessagingError subclass on any documented failure (auth/rate-limit/bad
  // request/not-found/server) rather than swallowing it.
  sendMessage(to: string, body: string): Promise<SentMessage>;

  // Reports which platform `phone` is reachable on so a caller can decide
  // before sending. Read-only lookup, no message is sent.
  checkPlatform(phone: string): Promise<MessagingPlatform>;

  // NOT YET SUPPORTED. Sendara documents no agency-mode provisioning endpoint;
  // provisioning is currently a manual/managed step on their side. Always
  // rejects with MessagingNotSupportedError until Sendara confirms whether a
  // programmatic provisioning API exists.
  provisionLine(): Promise<never>;
}
