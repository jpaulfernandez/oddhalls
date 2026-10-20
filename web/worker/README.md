# @photobook/worker

Cloudflare Worker + D1 behind the viewer's likes and the editor's Downloads tab, plus link-preview cards and an Atom feed. Plain `fetch` handler, no framework.
Routes and payloads live in `src/contracts.ts`, a verbatim copy of `packages/shared/src/publish/social.ts` so this folder deploys on its own (a test in `packages/shared` fails when the copy drifts).
It is optional: without it the viewer hides likes and logs nothing, and share links fall back directly to the viewer URL.

## Routes

- `GET /v1/health` — reports worker health and `preview: boolean` (whether the R2 `BOOKS` binding is configured)
- `GET /b/:slug` — HTML link preview card with Open Graph and Twitter Card tags; redirects browsers to the viewer
- `GET /feed.xml` — Atom 1.0 syndication feed of public books in the bucket (newest first, up to 50)
- `POST /v1/likes`, `GET /v1/books/:bookId/likes?device=<id>`
- `POST /v1/events`
- `GET /v1/admin/books/:bookId/activity` with `Authorization: Bearer <ADMIN_TOKEN>`

CORS is open (`*`): the viewer can run on any origin and only the admin route needs the token.

## R2 Bucket Binding (`BOOKS`)

For link preview cards (`GET /b/:slug`) and the Atom feed (`GET /feed.xml`), the Worker needs read access to your books R2 bucket via the `BOOKS` binding in `wrangler.toml` / `wrangler.local.toml`:

```toml
[[r2_buckets]]
binding = "BOOKS"
bucket_name = "photobook"
```

Without the `BOOKS` binding, `/b/:slug` and `/feed.xml` return 404 and `/v1/health` returns `{ "preview": false }`.


## Run locally

```sh
cd worker
pnpm exec wrangler d1 migrations apply photobook-social --local
printf 'ADMIN_TOKEN=dev-token\n' > .dev.vars   # git-ignored
pnpm dev                                        # http://localhost:8787
```

`pnpm test` starts the worker with `unstable_dev` against a throwaway local D1; no setup needed.

## Deploy your own

This folder has no dependency on the rest of the repository. Copy it anywhere (or download `web/worker` from
`https://github.com/jpaulfernandez/oddhalls`) and run, inside it:

```sh
pnpm install
pnpm exec wrangler login
cp wrangler.toml wrangler.local.toml            # git-ignored; set `name`, `bucket_name`, and the database id below
pnpm exec wrangler d1 create photobook-social   # put the printed database_id in wrangler.local.toml
pnpm exec wrangler d1 migrations apply photobook-social --remote --config wrangler.local.toml   # rerun when migrations/ changes
pnpm exec wrangler deploy --config wrangler.local.toml
openssl rand -hex 32 | tr -d '\n' | tee ~/.photobook-admin-token \
  | pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.local.toml
```

`pnpm run db:migrate` and `pnpm run deploy` do the two wrangler steps and pick `wrangler.local.toml` when it exists.

Then set the Worker URL and the admin token in the editor's Settings (see `docs/PUBLISHING.md`, section 8).
