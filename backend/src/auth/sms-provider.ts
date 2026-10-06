import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/config";

export abstract class SmsProvider {
  abstract sendOtp(phone: string, code: string): Promise<void>;
}

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    if (this.config.NODE_ENV === "development" && this.config.OTP_LOGS_ENABLED) {
      this.logger.log(`Mock OTP for ${phone}: ${code}`);
    }
  }
}