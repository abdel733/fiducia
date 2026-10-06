import { Equals, IsBoolean, IsString, Matches, MaxLength } from "class-validator";

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+229[0-9]{8}$/)
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+229[0-9]{8}$/)
  phone!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;

  @IsString()
  @MaxLength(30)
  consentVersion!: string;

  @IsBoolean() @Equals(true)
  termsAccepted!: boolean;

  @IsBoolean() @Equals(true)
  privacyAccepted!: boolean;

  @IsBoolean() @Equals(true)
  purposesAccepted!: boolean;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}