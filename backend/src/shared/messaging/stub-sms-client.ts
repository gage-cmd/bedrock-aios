import { randomBytes, randomInt } from 'crypto';
import {
  PurchasedNumber,
  SendMessageParams,
  SendMessageResult,
  SmsClient,
} from './sms-client.interface';

// Default SmsClient (SMS_PROVIDER unset or "stub"). No Twilio account
// required -- generates realistic-looking numbers/SIDs and logs what would
// have been sent, so the rest of the messaging service and every module
// built on top of it can be exercised end to end before a real Twilio
// account exists.
export class StubSmsClient implements SmsClient {
  purchaseNumber(): Promise<PurchasedNumber> {
    const phoneNumber = `+1555${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    const twilioSid = `PN${randomBytes(16).toString('hex')}`;

    return Promise.resolve({ phoneNumber, twilioSid });
  }

  addNumberToMessagingService(numberId: string): Promise<void> {
    console.log(
      `[stub-sms] would have added number ${numberId} to the messaging service`,
    );
    return Promise.resolve();
  }

  sendMessage({
    from,
    to,
    body,
  }: SendMessageParams): Promise<SendMessageResult> {
    console.log(
      `[stub-sms] would have sent SMS from ${from} to ${to}: ${body}`,
    );

    return Promise.resolve({
      sid: `SM${randomBytes(16).toString('hex')}`,
      status: 'delivered',
    });
  }
}
