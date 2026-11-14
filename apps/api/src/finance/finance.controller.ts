import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth, AuthContext } from '../common/auth';
import { FinanceService } from './finance.service';
import { CreateInvoiceDto, CreditNoteDto, IssueInvoiceDto, ListInvoicesQuery, SaveInvoiceDto, VoidInvoiceDto } from './invoices.dto';
import { InvoicesService } from './invoices.service';
import { AllocateDto, CreatePaymentDto, ListPaymentsQuery, OverviewQuery, ReversePaymentDto } from './payments.dto';
import { PaymentsService } from './payments.service';

const uuid = new ParseUUIDPipe();

@Controller()
export class FinanceController {
  constructor(private readonly invoices: InvoicesService, private readonly payments: PaymentsService, private readonly finance: FinanceService) {}

  @Get('finance/overview') overview(@Auth() a: AuthContext, @Query() q: OverviewQuery) { return this.finance.overview(a, q); }

  @Get('invoices') list(@Auth() a: AuthContext, @Query() q: ListInvoicesQuery) { return this.invoices.list(a, q); }
  @Post('invoices') create(@Auth() a: AuthContext, @Body() dto: CreateInvoiceDto) { return this.invoices.create(a, dto); }
  @Get('invoices/:id') get(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.invoices.get(a, id); }
  @Put('invoices/:id') save(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: SaveInvoiceDto) { return this.invoices.save(a, id, dto); }
  @HttpCode(204) @Delete('invoices/:id') remove(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.invoices.deleteDraft(a, id); }
  @HttpCode(200) @Post('invoices/:id/issue') issue(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: IssueInvoiceDto) { return this.invoices.issue(a, id, dto); }
  @HttpCode(204) @Post('invoices/:id/void') void(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: VoidInvoiceDto) { return this.invoices.void(a, id, dto); }
  @HttpCode(204) @Post('invoices/:id/share') share(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.invoices.share(a, id); }
  @Post('invoices/:id/credit-notes') creditNote(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: CreditNoteDto) { return this.invoices.creditNote(a, id, dto); }

  @Get('invoices/:id/pdf')
  async pdf(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Res() res: Response) {
    const { filename, buffer } = await this.invoices.pdfFor(a, id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' }).send(buffer);
  }

  @Get('payments') listPayments(@Auth() a: AuthContext, @Query() q: ListPaymentsQuery) { return this.payments.list(a, q); }
  @Get('payments/:id') getPayment(@Auth() a: AuthContext, @Param('id', uuid) id: string) { return this.payments.get(a, id); }

  @Post('payments')
  async record(@Auth() a: AuthContext, @Body() dto: CreatePaymentDto, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    const r = await this.payments.create(a, dto, key?.slice(0, 200));
    res.status(r.replayed ? 200 : 201);
    return { replayed: r.replayed, ...(await this.payments.get(a, r.payment.id)) };
  }

  @HttpCode(200) @Post('payments/:id/allocations') allocate(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: AllocateDto) { return this.payments.allocate(a, id, dto.allocations); }
  @HttpCode(200) @Post('payments/:id/reverse') reverse(@Auth() a: AuthContext, @Param('id', uuid) id: string, @Body() dto: ReversePaymentDto) { return this.payments.reverse(a, id, dto); }
}
