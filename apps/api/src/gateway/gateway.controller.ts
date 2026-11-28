import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Auth, AuthContext, Public } from '../common/auth';
import { Portal, PortalContext, PortalGuard } from '../portal/portal.guard';
import { GatewayService } from './gateway.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class GatewaySettingsDto {
  @IsIn(['SANDBOX', 'PRODUCTION']) environment: 'SANDBOX' | 'PRODUCTION';
  @Transform(trim) @IsString() @MinLength(4) @MaxLength(200) clientId: string;
  /** Leave out to keep the saved key. */
  @IsOptional() @Transform(trim) @IsString() @MinLength(8) @MaxLength(500) clientSecret?: string;
  @IsBoolean() enabled: boolean;
}
class CheckoutDto { @IsOptional() @IsString() @MaxLength(20) phone?: string }
class VerifyDto { @IsString() @Matches(/^fos_[0-9a-f]{24}$/) orderId: string }
const uuid = new ParseUUIDPipe();

@Controller('payment-gateway')
export class GatewaySettingsController {
  constructor(private readonly g: GatewayService) {}
  @Get() get(@Auth() a: AuthContext) { return this.g.settings(a); }
  @Put() save(@Auth() a: AuthContext, @Body() dto: GatewaySettingsDto) { return this.g.save(a, dto); }
  @HttpCode(204) @Delete() remove(@Auth() a: AuthContext) { return this.g.disconnect(a); }
}

/** Needs a verified portal session; `@Public()` only turns off the staff guard. */
@Controller('portal/invoices/:id/online-payment')
@Public()
@UseGuards(PortalGuard)
export class PortalCheckoutController {
  constructor(private readonly g: GatewayService) {}
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post() start(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() dto: CheckoutDto) { return this.g.startCheckout(p, id, dto.phone); }
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) @HttpCode(200) @Post('verify') verify(@Portal() p: PortalContext, @Param('id', uuid) id: string, @Body() dto: VerifyDto) { return this.g.verifyForPortal(p, id, dto.orderId); }
}

/** Cashfree calls this with a signed body (kept raw by the /webhooks middleware). */
@Controller('webhooks/cashfree')
export class CashfreeWebhookController {
  constructor(private readonly g: GatewayService) {}
  @Public() @Throttle({ default: { limit: 120, ttl: 60_000 } }) @HttpCode(200) @Post(':workspaceId')
  hook(@Param('workspaceId', uuid) workspaceId: string, @Req() req: Request, @Headers('x-webhook-timestamp') ts?: string, @Headers('x-webhook-signature') sig?: string) {
    return this.g.webhook(workspaceId, Buffer.isBuffer(req.body) ? req.body : Buffer.from(''), ts, sig);
  }
}
