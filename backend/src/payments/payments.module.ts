import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CryptoModule } from "../crypto/crypto.module";
import { PrismaModule } from "../database/prisma.module";
import { KkiapayProvider } from "./kkiapay.provider";
import { MockPaymentProvider } from "./mock-payment.provider";
import { MockEMecefInvoiceProvider } from "./invoice.provider";
import { PaymentWebhookController, PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [AuthModule, CryptoModule, PrismaModule],
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [PaymentsService, KkiapayProvider, MockPaymentProvider, MockEMecefInvoiceProvider],
  exports: [PaymentsService, MockEMecefInvoiceProvider],
})
export class PaymentsModule {}
