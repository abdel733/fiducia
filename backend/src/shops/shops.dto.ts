import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { KycDocumentKind, ShopStatus } from "@prisma/client";

export class CreateShopDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(80) city!: string;
  @IsString() @MaxLength(240) address!: string;
  @IsString() @Matches(/^\+229[0-9]{8}$/) whatsapp!: string;
  @IsOptional() @IsString() @MaxLength(30) ifu?: string;
  @IsOptional() @IsString() @MaxLength(30) rccm?: string;
}

export class KycUploadDto {
  @IsEnum(KycDocumentKind) kind!: KycDocumentKind;
}

export class InviteShopMemberDto {
  @IsString() @Matches(/^\+229[0-9]{8}$/) phone!: string;
}

export class AcceptShopInvitationDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{32,}$/) token!: string;
}

export class ShopStatusDto {
  @IsEnum(ShopStatus) status!: ShopStatus;
}