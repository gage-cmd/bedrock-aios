import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ValueLedgerService,
  ValueSummary,
} from '../../shared/value-ledger/value-ledger.service';

// The dashboard's one read for "what has this created for me": week and
// all-time recovered-value totals with the honest basis flag. tenantId
// always comes from the verified request context, never the client.
@Controller('value-ledger')
export class ValueLedgerController {
  constructor(private readonly valueLedger: ValueLedgerService) {}

  @Get('summary')
  getSummary(@Req() req: Request): Promise<ValueSummary> {
    return this.valueLedger.summary(req.tenantContext!.tenantId);
  }
}
