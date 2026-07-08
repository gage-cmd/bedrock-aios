import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { ModuleRegistryService } from '../../core/module-registry/module-registry.service';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { MissedCallTextbackController } from './api/missed-call-textback.controller';
import { MissedCallTextbackService } from './missed-call-textback.service';

// The orchestrator reaches this module through its contract methods
// (handleRequest/getSnapshot/getStatus/getCapabilities) via the registry
// registration below; the dashboard reaches the same methods over HTTP
// through the controller. The Twilio voice webhooks (Step 3) are a separate
// controller, not yet built.
@Module({
  imports: [MessagingModule, ModuleRegistryModule],
  controllers: [MissedCallTextbackController],
  providers: [MissedCallTextbackService],
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
