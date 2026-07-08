import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  PublicReviewService,
  ReviewStateResult,
  SubmitReviewResult,
} from '../public-review.service';

/**
 * PUBLIC, UNAUTHENTICATED endpoints for the customer-facing review funnel.
 *
 * This controller is explicitly excluded from TenantResolverMiddleware in
 * app.module.ts (an intentional allow-list entry, not omission). It never
 * reads req.tenantContext and never accepts a tenant id -- the only thing
 * that scopes access is the `:token` path param, which the service resolves
 * to exactly one review_requests row.
 */
@Controller('public/review')
export class PublicReviewController {
  constructor(private readonly service: PublicReviewService) {}

  @Get(':token')
  getState(@Param('token') token: string): Promise<ReviewStateResult> {
    return this.service.getReviewState(token);
  }

  @Post(':token')
  submit(
    @Param('token') token: string,
    @Body() body: { rating: number; feedback?: string },
  ): Promise<SubmitReviewResult> {
    return this.service.submitReview(token, body?.rating, body?.feedback);
  }
}
