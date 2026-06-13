# Guide Studio

An in-house tool for a creative agency to **rapidly assemble** and then
**precisely edit** beautiful, print-ready pocket guides — and export files a
commercial printer accepts without rework.

The common case is one click; the precise case is fully controllable. Layout is
generated from structured data with handsome defaults, and every element can be
taken over on a true-to-print canvas, with those overrides persisting through
later data changes.

## The one idea that holds it together

There is a **single layout model** — a display-list IR produced by one function,
`compileEdition()`. Every surface only *paints* that IR:

```
            ┌──────────────────────────────────────────────┐
 Edition ──▶│  compileEdition()   (the only geometry source) │──▶ DocRender (display list)
            └──────────────────────────────────────────────┘            │
                       ▲ uses @guide/carto compileMap()                  │
                       │                                                 ▼
        ┌──────────────┴───────────┐         ┌───────────────┬──────────────┬───────────────┐
        │ @guide/engine            │         │ studio canvas │ press PDF/X-4 │ digital edition│
        │ typesetter · templates   │         │  (SVG paint)  │  (CMYK paint) │  (SVG paint)   │
        └──────────────────────────┘         └───────────────┴──────────────┴───────────────┘
```

Because the on-screen canvas and the press renderer consume the *same* compiled
geometry — and shape text with the *same* font binaries — **what you see is
exactly what prints**. The editor and exporter cannot drift into two engines.

## Packages

| Package | Role |
| --- | --- |
| `@guide/shared` | The contract: geometry, CMYK colour + soft-proof, the display-list IR, the document model (with **derived** canonical numbering), structured diagnostics. |
| `@guide/engine` | The single geometry producer: a real H&J typesetter (hyphenation, justification, baseline grid, widow/runt control, copyfit + honest overset), page templates for every page type, and `compileEdition()`. |
| `@guide/carto` | Automatic editorial cartography: OSM → styled vector basemap, collision-free label placement, numbered tier-coloured pins, legend, attribution, spread-safe gutters. |
| `@guide/press` | `writePdf()` → PDF/X-4 CMYK (OutputIntent + ICC, subset-embedded fonts, black overprint, ink-limit guard, crop/registration marks) or an RGB proof, with preflight. |
| `@guide/paint` | The SVG painter shared by the canvas and the digital edition (text as glyph outlines, soft-proofed colour). |
| `@guide/fonts` | Font catalog + byte source (the same binaries used on screen and in print). |
| `apps/server` | Fastify API: auth, businesses/editions CRUD (enforcing the numbering invariant), assets, the canvas **preview** renderer, and the **export** pipeline that composes engine + carto + press + digital from one compile pass. |
| `apps/studio` | The React studio: library, structure pane, WYSIWYG canvas, inspector + live validation, export. |

## The numbering invariant

A listing's number is **never stored**. It is derived, always, from the
edition's `listingOrder` (`listingNumber()` / `numberedListings()` in
`@guide/shared`). The list row, the map pin, and the legend all read the same
function over the same array, so a mismatch, duplicate, or gap is structurally
impossible.

## Running it

Prerequisites: Node ≥ 22, pnpm. Then:

```bash
pnpm install

# seed the demo guide (The Sandling Hotel, Pelican Point) into ./data
GUIDE_DATA_DIR=$PWD/data pnpm --filter @guide/server exec tsx src/seed.ts fixtures/demo/seed.json

# API server (http://localhost:5170)
GUIDE_DATA_DIR=$PWD/data pnpm --filter @guide/server dev

# studio (http://localhost:5173), proxying the API
pnpm --filter @guide/studio dev
```

Open the studio, create the first account (it becomes the studio owner), and
open the seeded edition.

### Verify the output end to end

```bash
# compiles the demo edition, writes a page contact sheet + a press PDF/X-4,
# and prints all diagnostics
pnpm --filter @guide/server exec tsx scripts/verify-demo.mts /tmp/guide-verify
```

## Tests

```bash
pnpm -r typecheck
pnpm --filter @guide/engine --filter @guide/carto --filter @guide/press --filter @guide/server test
```

## Note on the map data source

Cartography reads OpenStreetMap data through a `MapDataSource`. This repo ships a
bundled **fixture** (`fixtures/maps/pelican-point.json`, Overpass `out geom`
shape) that is byte-compatible with a live Overpass response, so the live client
plugs in behind the same interface with no other change. OpenStreetMap
attribution (ODbL) is always rendered.
