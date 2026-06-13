/**
 * The digital web edition — the destination QR codes point at. It paints the
 * very same display list the press PDF uses (soft-proofed to sRGB), so the
 * online guide is a faithful twin of the printed one, not a separate build.
 */

import { paintPageSvg } from '@guide/paint';
import {
  numberedListings,
  type DocRender,
  type Edition,
  type PageRender,
} from '@guide/shared';
import type { FontManager } from '@guide/engine';

export interface DigitalDeps {
  fonts: FontManager;
  /** Resolve an asset id to a URL usable in the HTML (data: or http). */
  assetUrl: (id: string) => string;
}

export function renderDigitalHtml(render: DocRender, edition: Edition, deps: DigitalDeps): string {
  const pageSvgs = render.pages
    .map((page) => paintPage(page, deps))
    .map((svg, i) => `<figure class="page" data-page="${i + 1}">${svg}</figure>`)
    .join('\n');

  const index = numberedListings(edition)
    .map(
      ({ listing, number }) =>
        `<li><span class="n">${number}</span><span class="nm">${esc(
          listing.copy?.name ?? '',
        )}</span></li>`,
    )
    .join('');

  const title = `${edition.hotel.name} — ${edition.name}`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body>
<header class="masthead">
  <p class="eyebrow">Pocket Guide</p>
  <h1>${esc(edition.hotel.wordmark ?? edition.hotel.name)}</h1>
  <p class="sub">${esc(edition.name)}${edition.settings.publisher ? ` · By ${esc(edition.settings.publisher)}` : ''}</p>
</header>
<main class="reader">${pageSvgs}</main>
${index ? `<aside class="index"><h2>In this guide</h2><ol>${index}</ol></aside>` : ''}
<footer class="colophon"><p>© OpenStreetMap contributors · Set with Guide Studio</p></footer>
</body></html>`;
}

function paintPage(page: PageRender, deps: DigitalDeps): string {
  return paintPageSvg(page, {
    glyphPath: (fontId, gid) => deps.fonts.glyphPath(fontId, gid),
    unitsPerEm: (fontId) => deps.fonts.metrics(fontId).unitsPerEm,
    assetUrl: deps.assetUrl,
    showBleed: false,
    background: '#ffffff',
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
:root{--bg:#0d0e0c;--panel:#16181400;--ink:#1a1c18;--paper:#f3f1ea;--muted:#8a8c84;--accent:#b65c3f}
*{box-sizing:border-box}
body{margin:0;background:#111210;color:#e9e7df;font-family:ui-serif,Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased}
.masthead{padding:14vh 6vw 8vh;text-align:center}
.masthead .eyebrow{margin:0 0 1.4rem;font:600 .68rem/1 ui-sans-serif,system-ui;letter-spacing:.42em;text-transform:uppercase;color:var(--muted)}
.masthead h1{margin:0;font-size:clamp(2.6rem,9vw,5.5rem);font-weight:540;letter-spacing:-.01em}
.masthead .sub{margin:1.4rem 0 0;color:var(--muted);font-style:italic;font-size:1.05rem}
.reader{display:flex;flex-direction:column;align-items:center;gap:5vh;padding:2vh 4vw 12vh}
.page{margin:0;width:min(420px,86vw);box-shadow:0 24px 60px -28px rgba(0,0,0,.8),0 2px 10px -4px rgba(0,0,0,.5);border-radius:3px;overflow:hidden;background:#fff}
.page svg{display:block;width:100%;height:auto}
.index{max-width:560px;margin:0 auto 12vh;padding:0 6vw}
.index h2{font:600 .72rem/1 ui-sans-serif,system-ui;letter-spacing:.34em;text-transform:uppercase;color:var(--muted);margin:0 0 1.4rem;text-align:center}
.index ol{list-style:none;margin:0;padding:0;columns:2;column-gap:2.4rem}
.index li{display:flex;gap:.7rem;padding:.42rem 0;break-inside:avoid;border-bottom:1px solid #ffffff12;align-items:baseline}
.index .n{color:var(--accent);font:600 .82rem ui-sans-serif,system-ui;min-width:1.4rem}
.index .nm{font-size:.96rem}
.colophon{padding:0 6vw 8vh;text-align:center;color:#55564f;font:400 .76rem ui-sans-serif,system-ui}
`;
