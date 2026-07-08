import { Injectable } from '@nestjs/common';
import { twiml as Twiml } from 'twilio';
import { MessagingService } from '../../../shared/messaging/messaging.service';
import { publicBaseUrl } from '../../../shared/messaging/twilio-signature.guard';
import { MissedCallTextbackService } from '../missed-call-textback.service';

@Injectable()
export class VoiceService {
  constructor(
    private readonly messaging: MessagingService,
    private readonly missedCallTextback: MissedCallTextbackService,
  ) {}

  // Builds the TwiML response for an inbound call. Resolves the tenant from
  // the number that was dialed (the call's "To"), then forwards to that
  // tenant's configured destinationNumber, ringing for ringTimeoutSeconds,
  // with a statusCallback that carries the resolved tenant + original caller.
  //
  // The tenant/caller are placed in the statusCallback URL's query string on
  // purpose: TwilioSignatureGuard signs that whole URL, so /status can trust
  // those values as the ones this call resolved -- they cannot be swapped for
  // another tenant without breaking the signature.
  async buildIncomingCallTwiml(to: string, from: string): Promise<string> {
    const response = new Twiml.VoiceResponse();

    const tenant = to ? await this.messaging.findTenantByPhoneNumber(to) : null;
    if (!tenant) {
      // Unrecognized number -- decline the call. No tenant, no lookup beyond
      // the number, nothing logged. Nothing about our system is revealed.
      response.reject();
      return response.toString();
    }

    const { destinationNumber, ringTimeoutSeconds } =
      await this.missedCallTextback.getDialSettings(tenant.tenantId);

    if (!destinationNumber) {
      // Configured tenant but nowhere to forward yet -- decline rather than
      // dial an empty destination.
      response.reject();
      return response.toString();
    }

    const statusCallback = this.buildStatusCallbackUrl(tenant.tenantId, from);

    const dial = response.dial({ timeout: ringTimeoutSeconds });
    dial.number(
      {
        statusCallback,
        statusCallbackEvent: ['completed'],
        statusCallbackMethod: 'POST',
      },
      destinationNumber,
    );

    return response.toString();
  }

  // Handles the dialed leg's completion. Anything other than "completed"
  // (no-answer, busy, failed, canceled) means the forward was not answered,
  // so we log the missed call and fire the text-back for the ORIGINAL
  // caller, on the tenant carried in the signed callback URL -- never a
  // tenant derived from the (untrusted) POST body.
  async handleCallStatus(
    tenantId: string,
    caller: string,
    callStatus: string,
  ): Promise<boolean> {
    if (!tenantId || !caller || callStatus === 'completed') {
      return false;
    }

    await this.missedCallTextback.handleRequest(tenantId, 'log-missed-call', {
      phone: caller,
    });
    return true;
  }

  // Empty but valid TwiML -- acknowledges a status callback with 200 without
  // asking Twilio to do anything further.
  emptyResponse(): string {
    return new Twiml.VoiceResponse().toString();
  }

  private buildStatusCallbackUrl(tenantId: string, caller: string): string {
    const url = new URL(`${publicBaseUrl()}/public/voice/status`);
    url.searchParams.set('tenantId', tenantId);
    url.searchParams.set('caller', caller);
    return url.toString();
  }
}
