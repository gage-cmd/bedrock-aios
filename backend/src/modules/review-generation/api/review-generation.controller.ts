import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReviewGenerationService } from '../review-generation.service';

@Controller('modules/review-generation')
export class ReviewGenerationController {
  constructor(private readonly service: ReviewGenerationService) {}

  @Post('actions')
  async handleAction(
    @Req() req: Request,
    @Body() body: { intent: string; payload?: Record<string, unknown> },
  ): Promise<unknown> {
    try {
      return await this.service.handleRequest(
        req.tenantContext!.tenantId,
        body.intent,
        body.payload,
      );
    } catch (err) {
      // handleRequest throws plain Errors for expected failures (bad
      // contact, no phone number, unknown intent). Nest's default filter
      // turns an uncaught Error into an opaque 500 "Internal server error",
      // which hides the reason the dashboard needs to show the user.
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Request failed',
      );
    }
  }

  @Get('snapshot')
  getSnapshot(@Req() req: Request) {
    return this.service.getSnapshot(req.tenantContext!.tenantId);
  }

  @Get('status')
  getStatus(@Req() req: Request) {
    return this.service.getStatus(req.tenantContext!.tenantId);
  }

  @Get('capabilities')
  getCapabilities() {
    return this.service.getCapabilities();
  }
}
