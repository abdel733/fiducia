import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CertificateService, IssueCertificateInput } from "./certificate.service";

@Controller()
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Post("certificates/issue")
  issue(@Body() payload: IssueCertificateInput) {
    return this.certificateService.issue(payload);
  }

  @Get("verify/:code")
  verifyCode(@Param("code") code: string) {
    return this.certificateService.verifyCode(code);
  }
}
