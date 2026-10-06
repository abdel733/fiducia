import { UserRole } from "@prisma/client";

export interface AuthenticatedUser {
  id: string;
  roles: UserRole[];
  phone: string;
}

export interface AccessPayload {
  sub: string;
  tokenType: "access";
}