# meta-service

Service wrapping Meta Graph API v22.0 (Marketing API + Pages API) for programmatic ads management and organic posting.

## Stack
- TypeScript (strict), Express.js, Zod for validation + OpenAPI
- Drizzle ORM + Postgres (postgres.js)
- Vitest + Supertest for tests
- Deployed on the Hetzner box via Dockerfile (`docker-compose.override.yml` + `deploy.sh meta-service`), reachable at `https://meta.distribute.you` and, inside the compose network, at `http://meta-service:8080`

## Two paths, and they do not mix

**Managed (`/managed/*`).** How the product actually runs Meta ads. The
campaign, the page and the dataset are OURS, held as platform keys in
key-service (`meta-system-user-token`, `meta-app-secret`, `meta-ad-account-id`,
`meta-page-id`, and optionally `meta-instagram-account-id`, `meta-dataset-id`,
`meta-conversions-api-token`). The client connects nothing, ever. A caller with
an org, a brand, a daily budget, ad copy and a link gets a campaign, an ad set
carrying the targeting/budget/optimisation, and a text-only ad submitted for
review — in one call.

**Connect (`/auth/meta/*`, `/connections`, `/accounts`, `/insights`).** The
older per-user OAuth path, where a user authorises their own Meta account. It
stays for whatever already uses it, and it is never involved in a managed
launch.

## Invariants worth not relearning

- **Ads are TEXT ONLY.** `createLinkCreative` sends `link_data` with no
  `image_hash` and no `picture`, so Meta renders the destination page's own link
  preview. Do not invent, generate or substitute a visual.
- **Optimisation is per campaign and changeable.** `PATCH
  /managed/campaigns/:id/optimization` moves the goal (and the custom event) one
  step deeper down the funnel as volume accrues. Meta fixes a campaign's
  OBJECTIVE at creation, so a goal outside it is a 409 that names the reachable
  goals — not a silent no-op and not a second campaign.
- **The review poll and the spend ingest have their OWN schedules
  (`src/services/crons.ts`) and are NEVER chained into the launch run.** Meta
  decides a review minutes to a day later and publishes a day's spend hours
  after the fact; a poll seconds after a submission observes nothing and reports
  success on an ad that was refused. `POST /internal/review-sync` and `POST
  /internal/spend-sync` run the same work on demand.
- **Spend is the org's cost.** `meta-ads-spend` is already in the costs-service
  catalogue as a pass-through advertising line priced at exactly 1 cent per
  unit, so the declared quantity is the number of cents Meta charged. It is
  declared `actual`, never provisioned: the money is already spent when we read
  it, so there is nothing to hold and no affordability gate. Each pass declares
  `observed − declared` only; a downward revision keeps the declared amount.
- **Non-USD ad accounts are refused, not converted.** The cost line is priced in
  USD cents.
- **The identity columns on `meta_managed_campaigns` are load-bearing.** Spend is
  declared by a cron, long after the request headers that carried org/user/brand
  are gone, so the row carries them or the cost lands unattributed.
- **Errors are typed so a caller learns what is wrong.** `PlatformCredentialError`
  (our Meta assets are not configured — 502, names the key), `ManagedRequestError`
  (the request cannot be satisfied as written — 400, names the field) and
  `MetaApiCallError` (Meta refused — 502, carries Meta's code and message). Do
  not let any of these fall through to the generic 500 handler.
- **Cost names are NOT registered from here.** They live in costs-service's seed;
  `PUT /v1/providers-costs/{name}` only versions a name that already exists.

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
- Update DB schema: edit `src/db/schema.ts`, then `pnpm db:generate` and commit the migration. `drizzle/` must be committed — the image copies it and `migrate()` runs at boot.
- Regenerate OpenAPI: `pnpm generate:openapi` (auto-runs on build)
