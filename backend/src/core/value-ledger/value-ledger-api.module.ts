import { Module } from '@nestjs/common';
import { ValueLedgerModule } from '../../shared/value-ledger/value-ledger.module';
import { ValueLedgerController } from './value-ledger.controller';

@Module({
  imports: [ValueLedgerModule],
  controllers: [ValueLedgerController],
})
export class ValueLedgerApiModule {}
