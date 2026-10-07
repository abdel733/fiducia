import { config as loadEnvironmentFile } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "prisma/config";

loadEnvironmentFile({ path: process.env.ENV_FILE ?? resolve(__dirname, ".env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://fiducia:fiducia_local@localhost:5432/fiducia?schema=public" },
});