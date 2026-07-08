import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrchestratorService } from './orchestrator.service';

// The Command Center endpoint. Returns ONLY the synthesized answer -- which
// modules were consulted, tool calls, and reasoning stay server-side (in the
// routing log), never in the client payload.
@Controller('command-center')
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post('ask')
  async ask(
    @Req() req: Request,
    @Body() body: { question?: string },
  ): Promise<{ answer: string }> {
    try {
      return await this.orchestrator.ask(
        req.tenantContext!.tenantId,
        body.question ?? '',
      );
    } catch (err) {
      // Nest's default filter would swallow the message into an opaque 500;
      // rethrow expected failures as a 400 the dashboard can display.
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Unable to answer right now',
      );
    }
  }
}
