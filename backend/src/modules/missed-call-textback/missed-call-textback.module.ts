import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { ModuleRegistryService } from '../../core/module-registry/module-registry.service';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { MissedCallTextbackService } from './missed-call-textback.service';

// No controllers yet -- the module is only reachable through its contract
// methods (handleRequest/getSnapshot/getStatus/getCapabilities), which the
// orchestrator gets to via the registry registration below.
@Module({
  imports: [MessagingModule, ModuleRegistryModule],
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
