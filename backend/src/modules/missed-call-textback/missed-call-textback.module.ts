import { Module } from '@nestjs/common';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { MissedCallTextbackService } from './missed-call-textback.service';

// No controllers yet -- the module is only reachable through its contract
// methods (handleRequest/getSnapshot/getStatus/getCapabilities) until the
// orchestrator and a dashboard surface exist for it.
@Module({
  imports: [MessagingModule],
  providers: [MissedCallTextbackService],
  exports: [MissedCallTextbackService],
})
export class MissedCallTextbackModule {}
