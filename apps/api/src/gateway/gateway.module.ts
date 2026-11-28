import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CashfreeWebhookController, GatewaySettingsController, PortalCheckoutController } from './gateway.controller';
import { GatewayService } from './gateway.service';

@Global()
@Module({ imports: [JwtModule.register({})], controllers: [GatewaySettingsController, PortalCheckoutController, CashfreeWebhookController], providers: [GatewayService], exports: [GatewayService] })
export class GatewayModule {}
