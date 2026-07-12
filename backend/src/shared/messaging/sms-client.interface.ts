export interface PurchasedNumber {
  phoneNumber: string;
  twilioSid: string;
}

// A number offered by the provider for a given area code, before purchase.
// Search is read-only and free; only purchaseNumber() spends money.
export interface AvailableNumber {
  phoneNumber: string;
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
  // Read-only lookup of numbers available in an area code -- no purchase, so
  // the admin can pick a local number before committing to buy one.
  searchAvailableNumbers(areaCode: string): Promise<AvailableNumber[]>;
  // Purchases phoneNumber if given (the one the admin selected); otherwise
  // buys the first available number (the pre-selection default path).
  purchaseNumber(phoneNumber?: string): Promise<PurchasedNumber>;
  // Registers a purchased number into a Messaging Service. numberId is the
  // Twilio phone number SID from purchaseNumber(); messagingServiceSid is the
  // tenant's OWN Messaging Service (ISV model -- each client sends through
  // their own registered Brand/Campaign/Messaging Service, so the SID is passed
  // per call, never held as an account-wide default on the client).
  addNumberToMessagingService(
    numberId: string,
    messagingServiceSid: string,
  ): Promise<void>;
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
}
