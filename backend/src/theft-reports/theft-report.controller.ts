import { Body, Controller, Post } from "@nestjs/common";
import { TheftReportInput, TheftReportService } from "./theft-report.service";

@Controller("theft-reports")
export class TheftReportController {
  constructor(private readonly theftReportService: TheftReportService) {}

  @Post("verify")
  verify(@Body() payload: TheftReportInput) {
    return this.theftReportService.verifyTheft(payload);
  }
}
