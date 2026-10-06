CREATE TYPE "UserRole" AS ENUM ('BUYER', 'SELLER', 'SHOP_STAFF', 'AGENT', 'FINANCE_PARTNER', 'ADMIN', 'SUPPORT');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DELETION_REQUESTED', 'DELETED');
CREATE TYPE "ShopStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "ShopMemberRole" AS ENUM ('OWNER', 'SHOP_STAFF');
CREATE TYPE "LenderType" AS ENUM ('BANK', 'SFD', 'FINTECH');
CREATE TYPE "LenderStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED');
CREATE TYPE "ConsentKind" AS ENUM ('TERMS', 'PRIVACY', 'DATA_PURPOSES');
CREATE TYPE "KycDocumentKind" AS ENUM ('MANAGER_ID', 'FRONT_ID', 'BACK_ID', 'IFU', 'RCCM', 'SHOP_PHOTO', 'LENDER_LICENSE', 'OTHER');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "roles" "UserRole"[] DEFAULT ARRAY['BUYER']::"UserRole"[],
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "deletionRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "logoKey" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'PENDING',
    "ownerId" TEXT NOT NULL,
    "ifu" TEXT,
    "rccm" TEXT,
    "encryptedKkiapayPrivateKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopMember" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ShopMemberRole" NOT NULL DEFAULT 'SHOP_STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopInvitation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LenderOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LenderType" NOT NULL,
    "accreditationNumber" TEXT NOT NULL,
    "accreditationDocumentKey" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "LenderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LenderOrganization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LenderMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LenderMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "shopId" TEXT,
    "kind" "KycDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE INDEX "Shop_status_city_idx" ON "Shop"("status", "city");
CREATE INDEX "Shop_ownerId_idx" ON "Shop"("ownerId");
CREATE INDEX "ShopMember_userId_idx" ON "ShopMember"("userId");
CREATE UNIQUE INDEX "ShopMember_shopId_userId_key" ON "ShopMember"("shopId", "userId");
CREATE UNIQUE INDEX "ShopInvitation_tokenHash_key" ON "ShopInvitation"("tokenHash");
CREATE INDEX "ShopInvitation_phone_expiresAt_idx" ON "ShopInvitation"("phone", "expiresAt");
CREATE UNIQUE INDEX "LenderOrganization_accreditationNumber_key" ON "LenderOrganization"("accreditationNumber");
CREATE UNIQUE INDEX "LenderMember_userId_lenderId_key" ON "LenderMember"("userId", "lenderId");
CREATE UNIQUE INDEX "KycDocument_storageKey_key" ON "KycDocument"("storageKey");
CREATE INDEX "KycDocument_shopId_kind_idx" ON "KycDocument"("shopId", "kind");
CREATE INDEX "KycDocument_ownerUserId_idx" ON "KycDocument"("ownerUserId");
CREATE INDEX "Consent_userId_acceptedAt_idx" ON "Consent"("userId", "acceptedAt");
CREATE INDEX "AuditLog_resourceType_resourceId_createdAt_idx" ON "AuditLog"("resourceType", "resourceId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON "OtpChallenge"("phone", "createdAt");
CREATE INDEX "OtpChallenge_expiresAt_idx" ON "OtpChallenge"("expiresAt");
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");

ALTER TABLE "Shop" ADD CONSTRAINT "Shop_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShopMember" ADD CONSTRAINT "ShopMember_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopMember" ADD CONSTRAINT "ShopMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopInvitation" ADD CONSTRAINT "ShopInvitation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopInvitation" ADD CONSTRAINT "ShopInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LenderMember" ADD CONSTRAINT "LenderMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LenderMember" ADD CONSTRAINT "LenderMember_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "LenderOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_immutable_update" BEFORE UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
CREATE TRIGGER "AuditLog_immutable_delete" BEFORE DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();