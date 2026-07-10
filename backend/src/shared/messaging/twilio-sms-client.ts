import twilio, { Twilio } from 'twilio';
import {
  AvailableNumber,
  PurchasedNumber,
  SendMessageParams,
  SendMessageResult,
  SmsClient,
} from './sms-client.interface';

// Real implementation, selected by SMS_PROVIDER=twilio. Fully built and
// ready to go, but not the active client yet -- no live Twilio account
// exists. Left complete here so switching over later is a one-line env
// change, not a build.
export class TwilioSmsClient implements SmsClient {
  private readonly client: Twilio;
  private readonly messagingServiceSid: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    if (!accountSid || !authToken || !messagingServiceSid) {
      throw new Error(
        'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID must all be set to use TwilioSmsClient',
      );
    }

    this.client = twilio(accountSid, authToken);
    this.messagingServiceSid = messagingServiceSid;
  }

  async searchAvailableNumbers(areaCode: string): Promise<AvailableNumber[]> {
    const numbers = await this.client
      .availablePhoneNumbers('US')
      .local.list({ areaCode: Number(areaCode), smsEnabled: true, limit: 20 });

    return numbers.map((n) => ({ phoneNumber: n.phoneNumber }));
  }

  async purchaseNumber(phoneNumber?: string): Promise<PurchasedNumber> {
    let toBuy = phoneNumber;
    if (!toBuy) {
      const [available] = await this.client
        .availablePhoneNumbers('US')
        .local.list({ smsEnabled: true, limit: 1 });

      if (!available) {
        throw new Error('No available Twilio phone numbers to purchase');
      }
      toBuy = available.phoneNumber;
    }

    const purchased = await this.client.incomingPhoneNumbers.create({
      phoneNumber: toBuy,
    });

    return { phoneNumber: purchased.phoneNumber, twilioSid: purchased.sid };
  }

  async addNumberToMessagingService(numberId: string): Promise<void> {
    await this.client.messaging.v1
      .services(this.messagingServiceSid)
      .phoneNumbers.create({ phoneNumberSid: numberId });
  }

  async sendMessage({
    from,
    to,
    body,
  }: SendMessageParams): Promise<SendMessageResult> {
    const message = await this.client.messages.create({ from, to, body });

    return { sid: message.sid, status: message.status };
  }
}
