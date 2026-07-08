export interface PurchasedNumber {
  phoneNumber: string;
  twilioSid: string;
}

export interface SendMessageParams {
  from: string;
  to: string;
  body: string;
}

export interface SendMessageResult {
  sid: string;
  status: string;
}

// Implemented by StubSmsClient (default, no real Twilio account required)
// and TwilioSmsClient (real, selected by SMS_PROVIDER=twilio). Neither the
// messaging service nor its callers should know or care which one is active.
export interface SmsClient {
  purchaseNumber(): Promise<PurchasedNumber>;
  // numberId is the Twilio phone number SID returned by purchaseNumber().
  addNumberToMessagingService(numberId: string): Promise<void>;
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
}
