import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { ModuleRegistryService } from '../../core/module-registry/module-registry.service';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { ValueLedgerModule } from '../../shared/value-ledger/value-ledger.module';
import { ReviewGenerationController } from './api/review-generation.controller';
import { PublicReviewController } from './api/public-review.controller';
import { ReviewGenerationService } from './review-generation.service';
import { PublicReviewService } from './public-review.service';

@Module({
  imports: [MessagingModule, ValueLedgerModule, ModuleRegistryModule],
  controllers: [ReviewGenerationController, PublicReviewController],
  providers: [ReviewGenerationService, PublicReviewService],
  exports: [ReviewGenerationService],
})
export class ReviewGenerationModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly service: ReviewGenerationService,
  ) {}

  onModuleInit(): void {
    this.registry.registerModule('review-generation', this.service);
  }
}
