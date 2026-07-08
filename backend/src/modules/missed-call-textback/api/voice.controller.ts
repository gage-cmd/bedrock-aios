import {
  Body,
  Controller,
  Header,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TwilioSignatureGuard } from '../../../shared/messaging/twilio-signature.guard';
import { VoiceService } from './voice.service';

/**
 * PUBLIC, machine-to-machine Twilio Voice webhooks for missed-call detection.
 *
 * These endpoints are explicitly excluded from TenantResolverMiddleware in
 * app.module.ts (an intentional allow-list entry, not omission). They carry
 * no tenant JWT -- authenticity is enforced by TwilioSignatureGuard, which
 * verifies X-Twilio-Signature and rejects any unsigned/forged request with
 * 403 before either handler below runs. Mirrors the trust model of the
 * public review funnel (PublicReviewController), swapping the unguessable
 * token for Twilio's request signature.
 */
@Controller('public/voice')
@UseGuards(TwilioSignatureGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  // Twilio hits this when a call arrives at a tenant's number. Returns TwiML
  // that forwards the call; unrecognized numbers get a safe <Reject/>.
  @Post('incoming')
  @Header('Content-Type', 'text/xml')
  incoming(@Body() body: Record<string, string>): Promise<string> {
    return this.voice.buildIncomingCallTwiml(body?.To, body?.From);
  }

  // Twilio hits this when the forwarded leg ends. tenantId and caller come
  // from the signature-protected query string, not the POST body, so a
  // manipulated body cannot retarget the missed-call log to another tenant.
  @Post('status')
  @Header('Content-Type', 'text/xml')
  async status(
    @Query() query: Record<string, string>,
    @Body() body: Record<string, string>,
  ): Promise<string> {
    await this.voice.handleCallStatus(
      query?.tenantId,
      query?.caller,
      body?.CallStatus,
    );
    return this.voice.emptyResponse();
  }
}
