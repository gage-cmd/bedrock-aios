import { Module } from '@nestjs/common';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { ReviewGenerationController } from './api/review-generation.controller';
import { PublicReviewController } from './api/public-review.controller';
import { ReviewGenerationService } from './review-generation.service';
import { PublicReviewService } from './public-review.service';

@Module({
  imports: [MessagingModule],
  controllers: [ReviewGenerationController, PublicReviewController],
  providers: [ReviewGenerationService, PublicReviewService],
  exports: [ReviewGenerationService],
})
export class ReviewGenerationModule {}
