import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { MissedCallTextbackService } from '../missed-call-textback.service';

// The dashboard's read/write surface for this module. Everything here is
// tenant-scoped through req.tenantContext (set by the auth middleware).
// The Twilio voice webhooks that actually detect a missed call live in a
// separate controller (Step 3) -- they are unauthenticated Twilio callbacks,
// a different trust boundary from these signed-in dashboard requests.
@Controller('modules/missed-call-textback')
export class MissedCallTextbackController {
  constructor(private readonly service: MissedCallTextbackService) {}

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
      // handleRequest throws plain Errors for expected failures (missing
      // phone, unknown intent, no active number). Nest's default filter would
      // turn those into an opaque 500 "Internal server error", hiding the
      // reason the dashboard needs to show the user.
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
