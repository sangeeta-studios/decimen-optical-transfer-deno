# Build & release

## Scripts

```bash
deno task dev               # https dev server with HMR (self-signed cert)
deno task serve             # build, then serve the production bundle
deno task demo              # dev server with VITE_DEMO=1 — sender locked to bundled payloads
deno task diagnostics       # dev server + per-transfer run reports, saved for benchmark promotion — see diagnostics.md
deno task benchmark         # diagnostics + sender locked to the canonical 1 MB benchmark payload
deno task benchmark:promote # declare a captured run a record (updates benchmarks/ + README)
deno task benchmark:readme  # re-render the README "Measured speed" section from records.json
deno task test              # golden wire-format vectors and unit tests (deno test)
deno task build             # typecheck (app + build passes), hosted site → dist/
deno task build:standalone  # both self-contained pages → dist-standalone/
deno task build:all         # everything
deno task icons             # regenerate public/ icons from the logo (needs librsvg)
```

`deno task icons` strips the logo SVG's comments before rasterizing (a `--` inside a comment is invalid XML that browsers tolerate but librsvg rejects) and does exact-match surgery on the markup, throwing if the logo changes shape.

`VITE_SITE_URL` overrides the published URL baked into social cards and the share dialogs (default `https://decimen.app/`, trailing slash required).

## PWA / service worker

`vite-plugin-pwa` (workbox) precaches everything including the 940 KB decoder wasm. Two pieces are custom (`build/root-pwa-head.ts`): manifest/SW references are rewritten to resolve to the site root from any page depth (the build validates this), and the registration script does the skip-waiting handshake — a new deploy takes over open pages with a single reload instead of serving the stale precache forever. A workbox `rangeRequests` route serves received media from the Cache API (see [Platform quirks](platform-quirks.md)).

## CI (`.github/workflows`)

- **`ci.yml`** — tests and builds on every push to `main` / `release/*` and every PR. Asserts the served `receive` chunk stays under 20 KB (catches the inlined worker/wasm leaking into the site build) and that manifest/SW references point at files that exist.
- **`pages.yml`** — deploys to GitHub Pages on every push to `main`.
- **`release.yml`** — on a `v*` tag: builds everything, attaches `decimen-<tag>-site.zip`, both standalone files, and `SHA256SUMS.txt`.

The site builds with `base: "./"`, so it works under a project subpath with no configuration.

## Release pattern

1. `git checkout -b release/vX.Y.Z`, bump `version` in `deno.json`, commit.
2. Feature work + docs on the branch; PR to `main`.
3. Tag `vX.Y.Z` after merge — `release.yml` builds and attaches the artifacts.

The footer stamps `v<version> · build <short-hash>` (`-dirty` when uncommitted work is in the build), so any artifact names its exact source.
