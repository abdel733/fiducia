import { IsString, MaxLength } from "class-validator";

export class ExportDto {
  @IsString()
  @MaxLength(30)
  format = "json";
}