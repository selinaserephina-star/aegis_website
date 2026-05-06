# Ægis · Ægentisk — website

Static site. No build step required — JSX is transpiled in the browser via Babel Standalone.

## Files

```
index.html              # main entry
agentic-company.html    # /agentic-company essay page
site.css                # all styles (used by both pages)
site.jsx                # main site React components
widgets.jsx             # Mímir Slack feed + ask-codebase widget
tweaks-panel.jsx        # Tweaks panel helpers
```

## External dependencies (CDN, no files to host)

- React 18.3.1 + ReactDOM (unpkg, integrity-pinned)
- Babel Standalone 7.29 (unpkg, integrity-pinned)
- Google Fonts: JetBrains Mono + Newsreader

## Run locally

Any static file server will do, e.g.:

```
python3 -m http.server 8000
# → http://localhost:8000/
```

## Deploy

Drop all six files at the repo root. Works as-is on GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3+CloudFront, etc.

## Notes for handoff

- The site loads three `.jsx` files via `<script type="text/babel" src=...>`. Babel transpiles them client-side on every page load — small cold-start cost (~200ms), brief flash before render.
- If you want to remove the in-browser transpile step, port to Vite. The component split is already production-friendly:
  - `site.jsx` = page composition + sections
  - `widgets.jsx` = the two interactive widgets
  - `tweaks-panel.jsx` = helper components for the in-page tweaks UI (can be dropped from production if you don't ship the Tweaks toggle)
- The `window.claude.complete()` calls in the ask-codebase and Mímir widgets are sandbox-only — replace with your own API call (Anthropic SDK, edge function, etc.) before going live.
- All copy is in plain JSX/HTML, no CMS. Edit in place.

## Page structure

`index.html` — hero · ask-codebase demo · 5 offerings · talks · workshops (with pricing) · testimonial · tooling (Synthesis / ExoCortex / KCP / Skills Library) · transformation arc · who · final CTA.

`agentic-company.html` — essay page linked from the transformation-arc section and the footer.
