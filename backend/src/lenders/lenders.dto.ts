import { IsDateString, IsEnum, IsString, MaxLength, Matches } from "class-validator";
import { LenderType, LenderStatus } from "@prisma/client";

export class RegisterLenderDto {
  @IsString() @MaxLength(160) name!: string;
  @IsEnum(LenderType) type!: LenderType;
  @IsString() @MaxLength(80) accreditationNumber!: string;
  @IsString() @Matches(/^c[a-z0-9]+$/) accreditationDocumentId!: string;
  @IsDateString() validUntil!: string;
}

export class LenderStatusDto {
  @IsEnum(LenderStatus) status!: LenderStatus;
}