# Share a book on the web

Two parts: the viewer (static files) and the Worker (likes and the download log). Both are optional.
Each release also attaches `oddhalls-web-<version>.zip` with these two folders.

## Viewer

1. Copy `web/viewer/config.json.example` to `config.json`, next to `index.html`:

   ```json
   { "r2PublicUrl": "https://pub-xxxxxxxx.r2.dev" }
   ```

   The URL is the public address of your R2 bucket. oddhalls Settings shows it.
2. Host the folder on any static host. For Vercel, use the button below, or import this repository and set the root
   directory to `web/viewer`. The repository has no `config.json`, so before you deploy, add `web/viewer/config.json`
   in your clone, or the first visit shows a config error:

   ```json
   { "r2PublicUrl": "https://pub-xxxxxxxx.r2.dev" }
   ```

   The release zip has `config.json.example` to copy.

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjpaulfernandez%2Foddhalls&root-directory=web%2Fviewer)

## Worker

You need a Cloudflare account and `wrangler`.

1. In `web/worker`, copy `wrangler.toml` to `wrangler.local.toml`. Fill in your D1 `database_id` and your R2 bucket
   name.
2. Create the database: `wrangler d1 create photobook-social`.
3. Apply the migrations: `wrangler d1 migrations apply photobook-social --remote --config wrangler.local.toml`.
4. Deploy: `wrangler deploy --config wrangler.local.toml`.
