# Fiducia

Fiducia is a mobile-first marketplace and verification platform for physical retail businesses, finance partners, and device-ownership workflows in West Africa. The monorepo combines a secure NestJS API, a Next.js storefront/admin web app, shared domain validation, and local infrastructure for Postgres, Redis, MinIO, and Mailpit.

## Stack

- Monorepo: pnpm + Turborepo
- API: NestJS + Prisma + PostgreSQL
- Web: Next.js App Router + TypeScript + Tailwind
- Shared: validation and finance helpers
- Infra: Docker Compose for Postgres, Redis, MinIO, Mailpit
- Security: OTP auth, JWT access/refresh rotation, RBAC, signed URLs, encrypted private files

## Project structure

- [backend](backend) — NestJS API, Prisma schema, migration/seed scripts, tests
- [frontend](frontend) — Next.js app for sign-in, shop onboarding, and account views
- [packages/shared](packages/shared) — reusable validation and money helpers
- [packages/config](packages/config) — typed environment validation
- [docker-compose.yml](docker-compose.yml) — local services for Postgres, Redis, MinIO, Mailpit
- [.env.example](.env.example) — environment contract and local defaults

## Local setup

Requirements:

- Node.js 22+
- pnpm 9+
- Docker Desktop / Docker Engine

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Start the local services:

```bash
docker compose up -d postgres redis minio mailpit
```

3. Install dependencies:

```bash
pnpm install
```

4. Generate Prisma client and apply the schema:

```bash
pnpm db:generate
pnpm --dir backend exec prisma migrate dev --name init
pnpm db:seed
```

5. Start the API and web app:

```bash
pnpm --dir backend dev
pnpm --dir frontend dev
```

The app is then available at:

- Web: http://localhost:3000
- API: http://localhost:4000/v1
- Swagger UI: http://localhost:4000/docs

## API contract

The API is mounted under the `v1` prefix and exposes the following main endpoints.

### Auth

- `POST /v1/auth/otp/request` — request a six-digit OTP for a phone number
- `POST /v1/auth/otp/verify` — verify OTP and return a new access token + refresh token
- `POST /v1/auth/refresh` — rotate the refresh token
- `POST /v1/auth/logout` — revoke the current refresh token

### Users

- `GET /v1/users/me` — authenticated account snapshot
- `GET /v1/users/me/export` — export personal account JSON
- `DELETE /v1/users/me` — request account deletion

### Shops

- `POST /v1/shops` — create a shop in `PENDING` verification state
- `GET /v1/shops/mine` — list the caller's shops
- `POST /v1/shops/invitations/accept` — accept an invitation token
- `GET /v1/shops/:shopId` — fetch a shop for authorized members only
- `POST /v1/shops/:shopId/invitations` — invite a member by phone
- `POST /v1/shops/:shopId/documents` — upload and encrypt a private KYC document
- `GET /v1/shops/:shopId/documents/:documentId` — download a protected KYC document
- `PATCH /v1/shops/:shopId/status` — admin-only status transition
- `POST /v1/shops/:shopId/logo` — upload a shop logo
- `GET /v1/shops/:shopId/logo-url` — get a short-lived signed logo URL

### Lenders

- `POST /v1/lenders/accreditation` — upload lender accreditation document
- `POST /v1/lenders` — register a lender profile
- `GET /v1/lenders/mine` — list own lender records
- `PATCH /v1/lenders/:lenderId/status` — admin-only lender verification status

### IMEI verification

- `POST /v1/imei/verify` — authenticated IMEI verification against the provider pool and internal registry
- `POST /v1/imei/verify/public` — public limited verification summary with masked IMEI and reduced details
- `GET /v1/imei/:hash/history` — registry history for an IMEI hash, restricted to authorized actors

### Health

- `GET /v1/health` — process availability health check

## Security and compliance notes

The current implementation follows the requested audit and compliance rules for a regulated marketplace:

- OTP flow with 6-digit codes, 5-minute expiry, and attempts/rate limiting
- JWT access tokens with short TTL and rotating refresh tokens
- RBAC guards for admin-only actions
- Private object storage with signed URLs for public file access
- Encryption of sensitive KYC data and deterministic lookups for identifiers such as IMEI
- Append-only audit log service for critical state changes
- CORS and Helmet protection on the API

## Verification status

The project is validated in the current workspace with the following commands:

```bash
cd /workspaces/fiducia
pnpm test
pnpm typecheck
pnpm build
```

The latest workspace verification passed: the API test suite reported 9 passing tests, and the shared/config packages validated as expected.

## Remaining work

The foundation is in place and the codebase is ready for the next production and product phases:

- final seed data and migration validation in a real Postgres instance
- deeper lender and retailer approval workflows
- marketplace financing, layaway, and certificate lifecycle flows
- hardening of production secrets, backup strategy, and S3 lifecycle policy
- broader end-to-end test coverage for onboarding and admin operations

## Limites connues du moteur

| Sujet | Limite connue | Conséquence pour l’usage |
| --- | --- | --- |
| Vérification IMEI | Le moteur ne dit jamais « non volé » ; il indique un verdict prudent basé sur le niveau de couverture et les alertes reçues. | L’outil doit rester honnête sur ses limites et ne jamais présenter une certitude absolue. |
| Fournisseurs tiers | Les fournisseurs externes sont branchés via un adaptateur générique et ne sont pas scrappés sur des sites publics. | Le moteur dépend de la qualité, des coûts et de la disponibilité des licences. |
| Cache | Le cache est court et limité à l’IMEI haché. | Une variation rapide d’état ou un changement de provenance n’est pas immédiatement répliquée. |
| Couverture partielle | Si un fournisseur répond en erreur ou en timeout, le verdict peut devenir `WARNING`. | Le système protège les décisions critiques, mais la preuve reste partielle. |
| Gage et blocage | Un registre interne actif (gage, signalement, blocage) l’emporte sur la couverture extérieure. | Le moteur peut refuser ou suspendre un IMEI même sans confirmation externe complète. |
| Données publiques | Les résultats publics utilisent un IMEI masqué et omettent les détails sensibles. | Les traitements publics ne peuvent pas exposer de données personnelles ou des preuves internes. |

## Useful links

- Swagger UI: http://localhost:4000/docs
- Next.js app: http://localhost:3000
- Docker Compose: [docker-compose.yml](docker-compose.yml)
- API bootstrap: [backend/src/main.ts](backend/src/main.ts)
- Prisma schema: [backend/prisma/schema.prisma](backend/prisma/schema.prisma)
