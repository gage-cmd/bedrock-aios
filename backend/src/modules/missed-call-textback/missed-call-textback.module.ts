import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { ModuleRegistryService } from '../../core/module-registry/module-registry.service';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { TwilioSignatureGuard } from '../../shared/messaging/twilio-signature.guard';
import { MissedCallTextbackController } from './api/missed-call-textback.controller';
import { VoiceController } from './api/voice.controller';
import { VoiceService } from './api/voice.service';
import { MissedCallTextbackService } from './missed-call-textback.service';

// The orchestrator reaches this module through its contract methods
// (handleRequest/getSnapshot/getStatus/getCapabilities) via the registry
// registration below; the dashboard reaches the same methods over HTTP
// through MissedCallTextbackController. VoiceController is the machine-to-
// machine Twilio side: it detects missed calls and drives log-missed-call,
// guarded by Twilio signature verification rather than a tenant JWT.
@Module({
  imports: [MessagingModule, ModuleRegistryModule],
  controllers: [MissedCallTextbackController, VoiceController],
  providers: [MissedCallTextbackService, VoiceService, TwilioSignatureGuard],
  exports: [MissedCallTextbackService],
})
export class MissedCallTextbackModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly service: MissedCallTextbackService,
  ) {}

  onModuleInit(): void {
    this.registry.registerModule('missed-call-textback', this.service);
  }
}
