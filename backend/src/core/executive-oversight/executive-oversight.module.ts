import { Module } from '@nestjs/common';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ExecutiveOversightController } from './executive-oversight.controller';
import { ExecutiveOversightService } from './executive-oversight.service';
import { ReportSchedulerService } from './report-scheduler.service';

// Executive Oversight: the internal weekly report engine. It reads every
// enabled module's snapshot + activity through the shared registry (never
// importing module code), so it depends on ModuleRegistryModule the same way
// the orchestrator does. No public endpoint -- the controller's reads are
// tenant-JWT-guarded like every other non-excluded route.
@Module({
  imports: [ModuleRegistryModule],
  controllers: [ExecutiveOversightController],
  providers: [ExecutiveOversightService, ReportSchedulerService],
  exports: [ExecutiveOversightService],
})
export class ExecutiveOversightModule {}
