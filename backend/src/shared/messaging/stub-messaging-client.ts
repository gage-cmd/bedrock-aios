import { randomInt } from 'crypto';
import {
  MessagingClient,
  MessagingPlatform,
  SentMessage,
} from './messaging-client.interface';
import { MessagingNotSupportedError } from './messaging-errors';

// Default MessagingClient (no Sendara account required). Mirrors
// SendaraMessagingClient's shape so the rest of the platform can be exercised
// end to end before a real Sendara key exists: sendMessage returns a
// realistic SentMessage and logs what would have gone out, checkPlatform
// returns a plausible platform, and provisionLine matches the real client by
// refusing with the same "not yet supported" error.
export class StubMessagingClient implements MessagingClient {
  sendMessage(to: string, body: string): Promise<SentMessage> {
    console.log(`[stub-messaging] would have sent to ${to}: ${body}`);

    return Promise.resolve({
      id: randomInt(1, 1_000_000_000),
      phone: to,
      sentAt: new Date().toISOString(),
    });
  }

  checkPlatform(phone: string): Promise<MessagingPlatform> {
    console.log(`[stub-messaging] would have looked up platform for ${phone}`);

    // Default to iMessage -- Sendara's highest-priority platform -- so the
    // stubbed happy path exercises the same branch the real service prefers.
    return Promise.resolve('iMessage');
  }

  provisionLine(): Promise<never> {
    // Match the real client exactly: provisioning is not built yet.
    return Promise.reject(
      new MessagingNotSupportedError(
        'Line provisioning is not yet supported -- pending Sendara answer on agency provisioning',
      ),
    );
  }
}
