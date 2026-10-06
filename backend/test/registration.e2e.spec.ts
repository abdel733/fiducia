import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AccessTokenGuard } from "../src/auth/access-token.guard";
import { AuthService } from "../src/auth/auth.service";
import { AuthController } from "../src/auth/auth.controller";
import { RolesGuard } from "../src/auth/roles.guard";
import { ShopsController } from "../src/shops/shops.controller";
import { ShopsService } from "../src/shops/shops.service";

describe("registration then shop creation (e2e)", () => {
  let app: INestApplication;
  const createShop = jest.fn().mockResolvedValue({ id: "shop-1", status: "PENDING", name: "Atelier Mobile" });
  const auth = {
    requestOtp: jest.fn().mockResolvedValue({ accepted: true }),
    verifyOtp: jest.fn().mockResolvedValue({ accessToken: "test-access", refreshToken: "test-refresh", expiresIn: 900, user: { id: "buyer-1", phone: "+22997000000", roles: ["BUYER"] } }),
  };

  beforeAll(async () => {
    const accessGuard = { canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => { context.switchToHttp().getRequest().user = { id: "buyer-1", phone: "+22997000000", roles: ["BUYER"] }; return true; } };
    const builder = Test.createTestingModule({
      controllers: [AuthController, ShopsController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ShopsService, useValue: { create: createShop, listMine: jest.fn(), getForMember: jest.fn() } },
      ],
    });
    const moduleRef = await builder.overrideGuard(AccessTokenGuard).useValue(accessGuard).overrideGuard(RolesGuard).useValue({ canActivate: () => true }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => { if (app) await app.close(); });

  it("accepts OTP registration with consent and creates a pending shop", async () => {
    const server = app.getHttpServer();
    await request(server).post("/v1/auth/otp/request").send({ phone: "+22997000000" }).expect(202);
    const session = await request(server).post("/v1/auth/otp/verify").send({ phone: "+22997000000", code: "123456", consentVersion: "v1", termsAccepted: true, privacyAccepted: true, purposesAccepted: true }).expect(200);
    expect(session.body.user.phone).toBe("+22997000000");
    await request(server).post("/v1/shops").set("Authorization", "Bearer test-access").send({ name: "Atelier Mobile", city: "Cotonou", address: "Cadjehoun", whatsapp: "+22997000000" }).expect(201);
    expect(createShop).toHaveBeenCalledWith("buyer-1", expect.objectContaining({ name: "Atelier Mobile" }));
  });
});