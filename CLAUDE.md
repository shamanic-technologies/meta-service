# meta-service

Service wrapping Meta Graph API v22.0 (Marketing API + Pages API) for programmatic ads management and organic posting.

## Stack
- TypeScript (strict), Express.js, Zod for validation + OpenAPI
- Drizzle ORM + Neon Postgres
- Vitest + Supertest for tests
- Deployed on Railway via Dockerfile

## Key patterns
- All request/response schemas defined in `src/schemas.ts` using Zod
- OpenAPI auto-generated from Zod — never edit `openapi.json` manually
- `x-api-key` header auth on all endpoints (except health, webhooks)
- Meta OAuth tokens stored in `meta_connections` table (encrypted at rest via AES-256-GCM)
- Uses key-service for Meta app credentials, runs-service for usage tracking
- Meta rate limits tracked via `x-business-use-case-usage` headers
- Batch API used for bulk operations (max 50 per batch)

## Running locally
```
pnpm install
cp .env.example .env   # fill in values
pnpm run db:push       # apply schema to Neon
pnpm dev
```

## Testing
```
pnpm test              # runs vitest
pnpm test:watch        # watch mode
```

## Common tasks
- Add new Meta API endpoint: create route in `src/routes/`, schema in `src/schemas.ts`, register in `src/index.ts`
- Update DB schema: edit `src/db/schema.ts`, run `pnpm db:push`
- Regenerate OpenAPI: `pnpm generate:openapi` (auto-runs on build)
