import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorCtx } from './editor.js';
import type { PagePreview } from '../api.js';
import type { FrameOverride, Rect } from '@guide/shared';
import { overridePinsGeometry, ptToMm } from '@guide/shared';
import { Icon } from '../icons.js';

export function Canvas({ ctx }: { ctx: EditorCtx }) {
  const { preview, view, setView, selection, select } = ctx;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  const pages = preview?.pages ?? [];
  const current = pages[Math.min(view.pageIndex, Math.max(0, pages.length - 1))];

  // In spread mode, pair current with its neighbour to form left|right.
  let shown: PagePreview[] = current ? [current] : [];
  if (view.mode === 'spread' && current) {
    const idx = pages.indexOf(current);
    if (current.side === 'left' && pages[idx + 1]?.side === 'right') shown = [current, pages[idx + 1]!];
    else if (current.side === 'right' && pages[idx - 1]?.side === 'left') shown = [pages[idx - 1]!, current];
  }

  // Fit-to-viewport base scale (then zoom multiplies).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !current) return;
    const compute = () => {
      // offsetWidth/Height include the scrollbar gutter, so the fit doesn't
      // jitter when a zoom-induced scrollbar appears or disappears.
      const availW = el.offsetWidth - 100;
      const availH = el.offsetHeight - 130;
      const pageW = current.trim.w + (view.showBleed ? current.bleed * 2 : 0);
      const pageH = current.trim.h + (view.showBleed ? current.bleed * 2 : 0);
      const totalW = pageW * shown.length;
      setFit(Math.max(0.2, Math.min(availH / pageH, availW / totalW, 1.6)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [current?.pageId, view.showBleed, view.mode, shown.length]);

  // scale = fit × zoom. zoom 1 (= "100%") means the page is fitted to the
  // viewport — that is the default and what the readout shows.
  const scale = fit * view.zoom;

  // Latest values for the imperatively-attached (non-passive) wheel listener,
  // plus a pending cursor anchor applied after the page resizes.
  const zoomRef = useRef(view.zoom);
  zoomRef.current = view.zoom;
  const anchor = useRef<{ ratio: number; ox: number; oy: number; sl: number; st: number } | null>(null);

  const applyZoom = (target: number, clientX?: number, clientY?: number) => {
    const el = scrollRef.current;
    const oldZoom = zoomRef.current;
    const newZoom = clampZoom(target);
    if (newZoom === oldZoom) return;
    if (el) {
      const rect = el.getBoundingClientRect();
      const ox = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const oy = (clientY ?? rect.top + rect.height / 2) - rect.top;
      anchor.current = { ratio: newZoom / oldZoom, ox, oy, sl: el.scrollLeft, st: el.scrollTop };
    }
    setView({ zoom: newZoom });
  };

  // Trackpad pinch (which the browser delivers as wheel + ctrlKey) and
  // ⌘/Ctrl-scroll zoom toward the cursor. Plain two-finger scroll pans.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const dy = Math.max(-30, Math.min(30, e.deltaY));
      applyZoom(zoomRef.current * Math.exp(-dy * 0.01), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // applyZoom reads live values via refs, so this attaches once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the anchor point under the cursor after a zoom resizes the page.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = Math.max(0, (a.sl + a.ox) * a.ratio - a.ox);
    el.scrollTop = Math.max(0, (a.st + a.oy) * a.ratio - a.oy);
  }, [scale]);

  const go = (delta: number) => {
    const next = Math.min(pages.length - 1, Math.max(0, view.pageIndex + delta));
    setView({ pageIndex: next });
    select({ pageId: pages[next]?.pageId });
  };

  return (
    <div className="canvas-stage">
      <div className="canvas-toolbar">
        <button className="iconbtn" onClick={() => go(-shown.length)} disabled={view.pageIndex <= 0} title="Previous"><Icon name="back" /></button>
        <span className="zlabel">{current ? `${view.pageIndex + 1} / ${pages.length}` : '—'}</span>
        <button className="iconbtn" onClick={() => go(shown.length)} disabled={view.pageIndex >= pages.length - 1} title="Next"><Icon name="chevron" /></button>
        <span className="div" />
        <button className="iconbtn" onClick={() => applyZoom(view.zoom / 1.2)} title="Zoom out"><Icon name="zoomOut" /></button>
        <button className="zlabel zbtn" onClick={() => setView({ zoom: 1 })} title="Reset to fit (100%)">{Math.round(view.zoom * 100)}%</button>
        <button className="iconbtn" onClick={() => applyZoom(view.zoom * 1.2)} title="Zoom in"><Icon name="zoomIn" /></button>
        <button className="iconbtn" onClick={() => setView({ zoom: 1 })} title="Fit to view"><Icon name="layout" /></button>
      </div>

      <div className="canvas-scroll" ref={scrollRef}>
        {!current ? (
          <div className="canvas-empty"><Icon name="layout" size={28} /><span>{preview ? 'No pages' : 'Composing…'}</span></div>
        ) : (
          <div className="canvas-pages">
            {shown.map((pg) => (
              <PageView key={pg.pageId} ctx={ctx} page={pg} scale={scale}
                offset={view.showBleed ? 0 : pg.bleed}
                frames={Object.entries(preview!.frames).filter(([, f]) => f.pageId === pg.pageId)}
                selection={selection} select={select} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PageView({ ctx, page, scale, offset, frames, selection, select }: {
  ctx: EditorCtx; page: PagePreview; scale: number; offset: number;
  frames: [string, { pageId: string; rect: Rect; kind: string }][];
  selection: { frameId?: string; pageId?: string }; select: (s: { frameId?: string; pageId?: string }) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dispW = (page.trim.w + (offset ? 0 : page.bleed * 2)) * scale;
  const dispH = (page.trim.h + (offset ? 0 : page.bleed * 2)) * scale;

  useEffect(() => {
    if (hostRef.current) hostRef.current.innerHTML = page.svg;
  }, [page.svg]);

  const overridesByFrame = new Map(ctx.edition.overrides.map((o) => [o.frame, o]));

  return (
    <div className="canvas-page" style={{ width: dispW, height: dispH }}>
      <div className="page-caption">{page.pageId}{page.side === 'left' ? '  ·  verso' : '  ·  recto'}</div>
      <div ref={hostRef} style={{ width: dispW, height: dispH }} />
      <div className="sel-layer">
        {frames.map(([id, f]) => (
          <FrameHit key={id} ctx={ctx} frameId={id} rect={f.rect} kind={f.kind} scale={scale} offset={offset}
            selected={selection.frameId === id} override={overridesByFrame.get(id)}
            host={hostRef} select={() => select({ frameId: id, pageId: page.pageId })} />
        ))}
      </div>
    </div>
  );
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_PT = 8; // smallest a frame may be dragged to

function FrameHit({ ctx, frameId, rect, kind, scale, offset, selected, override, host, select }: {
  ctx: EditorCtx; frameId: string; rect: Rect; kind: string; scale: number; offset: number;
  selected: boolean; override?: FrameOverride; host: React.RefObject<HTMLDivElement>; select: () => void;
}) {
  const [drag, setDrag] = useState(false);
  // While resizing, `live` holds the in-progress box (pt) for the outline only;
  // the SVG content reflows on commit, keeping canvas == print honest.
  const [live, setLive] = useState<Rect | null>(null);
  const box = live ?? rect;
  const left = (box.x - offset) * scale;
  const top = (box.y - offset) * scale;
  const w = box.w * scale;
  const h = box.h * scale;
  const moved = !!override && overridePinsGeometry(override);

  // Upsert a geometry override, recording the auto rect as the conflict base.
  const commit = (next: Rect) => {
    ctx.update((edn) => {
      const ex = edn.overrides.find((o) => o.frame === frameId);
      if (ex) {
        ex.patch.x = next.x; ex.patch.y = next.y; ex.patch.w = next.w; ex.patch.h = next.h;
        ex.at = new Date().toISOString();
      } else {
        edn.overrides.push({
          frame: frameId,
          patch: { x: next.x, y: next.y, w: next.w, h: next.h },
          base: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
          at: new Date().toISOString(),
        });
      }
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!selected) { select(); return; }
    e.preventDefault();
    setDrag(true);
    const hit = e.currentTarget as HTMLElement;
    const sx = e.clientX, sy = e.clientY;
    const svgGroup = host.current?.querySelector(`[data-frame="${cssEsc(frameId)}"]`) as SVGElement | null;
    const baseX = rect.x, baseY = rect.y;

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      if (svgGroup) svgGroup.setAttribute('transform', `translate(${dx} ${dy})`);
      hit.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDrag(false);
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      hit.style.transform = '';
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      commit({ x: baseX + dx, y: baseY + dy, w: rect.w, h: rect.h });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Resize from a handle: adjust the edges the handle controls, clamp to a
  // minimum, then commit the new box on release.
  const onHandleDown = (handle: Handle) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const start = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    const at = (ev: MouseEvent): Rect => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      let { x, y, w: nw, h: nh } = start;
      if (handle.includes('e')) nw = start.w + dx;
      if (handle.includes('s')) nh = start.h + dy;
      if (handle.includes('w')) { nw = start.w - dx; x = start.x + dx; }
      if (handle.includes('n')) { nh = start.h - dy; y = start.y + dy; }
      if (nw < MIN_PT) { if (handle.includes('w')) x = start.x + start.w - MIN_PT; nw = MIN_PT; }
      if (nh < MIN_PT) { if (handle.includes('n')) y = start.y + start.h - MIN_PT; nh = MIN_PT; }
      return { x, y, w: nw, h: nh };
    };
    const onMove = (ev: MouseEvent) => setLive(at(ev));
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const next = at(ev);
      setLive(null);
      const changed =
        Math.abs(next.x - start.x) > 0.5 || Math.abs(next.y - start.y) > 0.5 ||
        Math.abs(next.w - start.w) > 0.5 || Math.abs(next.h - start.h) > 0.5;
      if (changed) commit(next);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className={`frame-hit ${selected ? 'sel' : ''} ${drag ? 'dragging' : ''} ${live ? 'resizing' : ''} ${moved ? 'moved' : ''}`}
      style={{ left, top, width: w, height: h }}
      onMouseDown={onMouseDown}
      onClick={(e) => { e.stopPropagation(); if (!selected) select(); }}>
      <span className="htag">{kind}</span>
      {live && <span className="dimtag">{ptToMm(live.w).toFixed(1)} × {ptToMm(live.h).toFixed(1)} mm</span>}
      {selected && HANDLES.map((hd) => (
        <span key={hd} className={`rsz rsz-${hd}`} onMouseDown={onHandleDown(hd)} />
      ))}
    </div>
  );
}

function cssEsc(s: string): string {
  return s.replace(/"/g, '\\"');
}

function clampZoom(z: number): number {
  return Math.max(0.25, Math.min(6, z));
}
