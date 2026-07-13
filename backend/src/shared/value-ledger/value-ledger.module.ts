import { Module } from '@nestjs/common';
import { ValueLedgerService } from './value-ledger.service';

@Module({
  providers: [ValueLedgerService],
  exports: [ValueLedgerService],
})
export class ValueLedgerModule {}
