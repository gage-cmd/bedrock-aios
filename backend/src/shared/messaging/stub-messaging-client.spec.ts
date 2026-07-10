import { StubMessagingClient } from './stub-messaging-client';
import { MessagingNotSupportedError } from './messaging-errors';

// The stub is the default client used everywhere until a real Sendara key
// exists, so its contract (shape of what it returns, and that provisioning is
// refused the same way the real client refuses it) is worth pinning down.
describe('StubMessagingClient', () => {
  let client: StubMessagingClient;

  beforeEach(() => {
    client = new StubMessagingClient();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendMessage', () => {
    it('resolves with a realistic SentMessage for the given recipient', async () => {
      const result = await client.sendMessage('+15555550123', 'hello there');

      expect(result.phone).toBe('+15555550123');
      expect(typeof result.id).toBe('number');
      // sentAt is a valid ISO 8601 timestamp.
      expect(Number.isNaN(Date.parse(result.sentAt))).toBe(false);
    });

    it('does not throw and returns distinct ids across sends', async () => {
      const a = await client.sendMessage('+15555550001', 'one');
      const b = await client.sendMessage('+15555550002', 'two');

      expect(a.phone).toBe('+15555550001');
      expect(b.phone).toBe('+15555550002');
      // Not a hard guarantee of the interface, but the stub should not hand
      // back a constant id -- that would mask id-collision bugs in callers.
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('checkPlatform', () => {
    it('resolves to one of the documented platforms', async () => {
      const platform = await client.checkPlatform('+15555550123');

      expect(['iMessage', 'WhatsApp', 'SMS']).toContain(platform);
    });
  });

  describe('provisionLine', () => {
    it('rejects with MessagingNotSupportedError, matching the real client', async () => {
      await expect(client.provisionLine()).rejects.toBeInstanceOf(
        MessagingNotSupportedError,
      );
    });
  });
});
