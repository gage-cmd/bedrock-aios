import { randomBytes, randomInt } from 'crypto';
import {
  AvailableNumber,
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
  // Synthesizes numbers in the requested area code so the search-and-select
  // step is fully exercisable with no Twilio account.
  searchAvailableNumbers(areaCode: string): Promise<AvailableNumber[]> {
    const numbers = Array.from({ length: 5 }, () => ({
      phoneNumber: `+1${areaCode}${String(randomInt(0, 10_000_000)).padStart(7, '0')}`,
    }));

    return Promise.resolve(numbers);
  }

  purchaseNumber(phoneNumber?: string): Promise<PurchasedNumber> {
    // Honour the selected number when given; otherwise mint a random one.
    const number =
      phoneNumber ??
      `+1555${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
    const twilioSid = `PN${randomBytes(16).toString('hex')}`;

    return Promise.resolve({ phoneNumber: number, twilioSid });
  }

  addNumberToMessagingService(
    numberId: string,
    messagingServiceSid: string,
  ): Promise<void> {
    console.log(
      `[stub-sms] would have added number ${numberId} to messaging service ${messagingServiceSid}`,
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
