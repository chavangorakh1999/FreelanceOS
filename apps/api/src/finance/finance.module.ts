import { Global, Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

@Global()
@Module({ controllers: [FinanceController], providers: [InvoicesService, PaymentsService, FinanceService], exports: [FinanceService, InvoicesService] })
export class FinanceModule {}
