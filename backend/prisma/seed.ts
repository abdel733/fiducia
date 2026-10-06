import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const admin = await prisma.user.upsert({
    where: { phone: "+22997000001" },
    update: { roles: ["ADMIN"] },
    create: { phone: "+22997000001", roles: ["ADMIN"] },
  });
  const buyers = await Promise.all(["+22997000002", "+22997000003", "+22997000004"].map((phone) => prisma.user.upsert({
    where: { phone }, update: {}, create: { phone, roles: ["BUYER"] },
  })));

  const shopCount = await prisma.shop.count();
  if (shopCount === 0) {
    for (const [index, user] of buyers.slice(0, 2).entries()) {
      const shop = await prisma.shop.create({ data: { name: index === 0 ? "Atelier Mobile Cotonou" : "Porto-Novo Connect", city: index === 0 ? "Cotonou" : "Porto-Novo", address: index === 0 ? "Cadjehoun" : "Centre-ville", whatsapp: index === 0 ? "+22997000012" : "+22997000013", status: "PENDING", ownerId: user.id } });
      await prisma.shopMember.create({ data: { shopId: shop.id, userId: user.id, role: "OWNER" } });
      await prisma.user.update({ where: { id: user.id }, data: { roles: ["BUYER", "SELLER"] } });
    }
  }

  await prisma.lenderOrganization.upsert({
    where: { accreditationNumber: "DEMO-SFD-001" },
    update: {},
    create: {
      name: "Institution SFD de démonstration",
      type: "SFD",
      accreditationNumber: "DEMO-SFD-001",
      accreditationDocumentKey: "seed/no-real-license-document",
      validUntil: new Date("2027-12-31T00:00:00.000Z"),
      status: "PENDING",
      members: { create: { userId: buyers[2]!.id } },
    },
  });
  await prisma.user.update({ where: { id: buyers[2]!.id }, data: { roles: ["BUYER", "FINANCE_PARTNER"] } });
  await prisma.auditLog.create({ data: { actorId: admin.id, action: "SEED_INITIALIZED", resourceType: "System", metadata: { environment: "development" } } });
}

main().finally(async () => prisma.$disconnect());