# MergeBrake — landing page

Single-file static site for `https://mergebrake.dev`. No build step, no
dependencies — Tailwind is loaded from the CDN at request time and the only
JavaScript is the copy-to-clipboard handler.

## Local preview

```bash
# Any static file server works.
npx --yes serve website
# or
python3 -m http.server -d website 8080
```

Open `http://localhost:3000` (or `:8080` for the Python variant).

## Deploy

The folder is deployable as-is to:

- **Cloudflare Pages** — `Build command`: empty. `Build output directory`:
  `website`.
- **Vercel** — set `Output Directory` to `website`, no install/build command.
- **Netlify** — drag-and-drop the `website/` folder, or commit and point the
  publish directory at `website`.
- **GitHub Pages** — enable Pages on `main`, set source to `/website`.

For mergebrake.dev specifically: register the domain, point an `A`/`ALIAS`
record at the host, and add an HTTPS certificate (Cloudflare Pages / Vercel
issue this automatically).

## Editing

The page is one `index.html` file. Style tokens live in the inline
`tailwind.config` block at the top — adjust `brake.500` to retheme.

## Open Graph image

`og.png` (1200 × 630) is the asset Twitter / LinkedIn / Slack pull when the
page is shared. The source of truth is `og.svg` — edit that, then regenerate
the PNG:

```bash
npm run og:build   # at the repo root
```

The script lives at `website/scripts/build-og.mjs` and uses
[`@resvg/resvg-js`](https://www.npmjs.com/package/@resvg/resvg-js) (WASM, no
native build) to rasterize the SVG. Commit both `og.svg` and `og.png` — the
PNG is what consumers actually fetch.
