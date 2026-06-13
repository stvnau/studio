import { useState } from 'react';
import type { EditorCtx } from './editor.js';
import type { Diagnostic, FrameOverride } from '@guide/shared';
import { PT_PER_MM, ptToMm, worstSeverity } from '@guide/shared';
import { Icon } from '../icons.js';

export function Inspector({ ctx }: { ctx: EditorCtx }) {
  const { preview, selection } = ctx;
  const [tab, setTab] = useState<'props' | 'validate'>('props');
  const diags = preview?.diagnostics ?? [];
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warns = diags.filter((d) => d.severity === 'warning').length;

  return (
    <div className="pane pane-right">
      <div className="insp-tabs">
        <button className={`insp-tab ${tab === 'props' ? 'on' : ''}`} onClick={() => setTab('props')}>
          <Icon name="layout" size={14} /> Properties
        </button>
        <button className={`insp-tab ${tab === 'validate' ? 'on' : ''}`} onClick={() => setTab('validate')}>
          <Icon name="check" size={14} /> Validate
          {errors > 0 ? <span className="count bad">{errors}</span> : warns > 0 ? <span className="count warn">{warns}</span> : null}
        </button>
      </div>
      <div className="pane-scroll" style={{ padding: 0 }}>
        {tab === 'props' ? <Properties ctx={ctx} /> : <Validate ctx={ctx} />}
      </div>
    </div>
  );
}

function Properties({ ctx }: { ctx: EditorCtx }) {
  const { edition, preview, selection, update } = ctx;
  const frameId = selection.frameId;
  const frame = frameId ? preview?.frames[frameId] : undefined;

  if (!frameId || !frame) {
    return (
      <>
        <div className="insp-block">
          <h4>Edition</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13 }}>
            <Row k="Trim" v={`${edition.settings.trimWidthMm} × ${edition.settings.trimHeightMm} mm`} />
            <Row k="Bleed" v={`${edition.settings.bleedMm} mm`} />
            <Row k="Sections" v={String(edition.sections.length)} />
            <Row k="Places" v={String(edition.listings.length)} />
            <Row k="Ink limit" v={`${edition.settings.inkLimit}%`} />
            <Row k="Profile" v="Guide Studio CMYK" />
          </div>
        </div>
        <div className="insp-empty">
          <div className="ring"><Icon name="layout" size={18} /></div>
          <div style={{ fontSize: 13 }}>Select any element on the canvas</div>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>to nudge it, type exact coordinates,<br />or reset it back to automatic.</div>
        </div>
      </>
    );
  }

  const page = preview!.pages.find((p) => p.pageId === frame.pageId);
  const bleed = page?.bleed ?? 0;
  const override = edition.overrides.find((o) => o.frame === frameId);
  const r = frame.rect;

  const setPatch = (patch: Partial<FrameOverride['patch']>) => {
    update((e) => {
      const ex = e.overrides.find((o) => o.frame === frameId);
      if (ex) {
        Object.assign(ex.patch, patch);
        ex.at = new Date().toISOString();
      } else {
        e.overrides.push({
          frame: frameId,
          patch: { x: r.x, y: r.y, w: r.w, h: r.h, ...patch },
          base: { x: r.x, y: r.y, w: r.w, h: r.h },
          at: new Date().toISOString(),
        });
      }
    });
  };
  const reset = () => update((e) => { e.overrides = e.overrides.filter((o) => o.frame !== frameId); });

  // Coordinates shown in mm from the trim edge.
  const toMm = (ptVal: number, sub = 0) => +(ptToMm(ptVal - sub)).toFixed(1);
  const fromMm = (mmVal: number, add = 0) => mmVal * PT_PER_MM + add;

  return (
    <>
      <div className="insp-block">
        <h4>{frame.kind} · element</h4>
        <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 12, wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>{frameId}</div>
        <div className="coord-grid">
          <Coord label="X (mm)" value={toMm(r.x, bleed)} onCommit={(v) => setPatch({ x: fromMm(v, bleed) })} />
          <Coord label="Y (mm)" value={toMm(r.y, bleed)} onCommit={(v) => setPatch({ y: fromMm(v, bleed) })} />
          <Coord label="W (mm)" value={toMm(r.w)} onCommit={(v) => setPatch({ w: fromMm(v) })} />
          <Coord label="H (mm)" value={toMm(r.h)} onCommit={(v) => setPatch({ h: fromMm(v) })} />
        </div>
      </div>

      <div className="insp-block">
        <h4>Override</h4>
        {override ? (
          <>
            <div className="override-note pinned" style={{ marginBottom: 10 }}>
              <Icon name="info" size={14} />
              <span>This element is pinned. Data changes won’t move it; later layout shifts are flagged instead of discarding your placement.</span>
            </div>
            <button className="btn sm" onClick={reset}><Icon name="back" size={13} /> Reset to automatic</button>
          </>
        ) : (
          <div className="faint" style={{ fontSize: 12.5 }}>Automatic. Drag on the canvas or edit a value to pin this element.</div>
        )}
        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!override?.patch.hidden} onChange={(e) => setPatch({ hidden: e.target.checked })} />
            Hide this element
          </label>
        </div>
      </div>
    </>
  );
}

function Coord({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  // keep in sync when selection / external value changes
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setLocal(String(value)); }
  return (
    <div className="coord">
      <label>{label}</label>
      <input value={local} inputMode="decimal"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { const n = parseFloat(local); if (!Number.isNaN(n)) onCommit(n); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

function Validate({ ctx }: { ctx: EditorCtx }) {
  const { preview, select, setView } = ctx;
  const diags = preview?.diagnostics ?? [];
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...diags].sort((a, b) => order[a.severity] - order[b.severity]);
  const worst = worstSeverity(diags);

  const focus = (d: Diagnostic) => {
    if (!d.frame || !preview) return;
    const f = preview.frames[d.frame];
    if (!f) return;
    const idx = preview.pages.findIndex((p) => p.pageId === f.pageId);
    if (idx >= 0) setView({ pageIndex: idx });
    select({ frameId: d.frame, pageId: f.pageId });
  };

  if (diags.length === 0 || worst === null) {
    return (
      <div className="diag-clean">
        <div className="ring"><Icon name="check" size={20} /></div>
        <div style={{ fontWeight: 600 }}>Press-ready</div>
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>No layout, image, map or<br />prepress issues found.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      {sorted.map((d, i) => (
        <div key={i} className={`diag ${d.severity}`} onClick={() => focus(d)}>
          <span className="dicon"><Icon name={d.severity === 'error' ? 'alert' : d.severity === 'warning' ? 'alert' : 'info'} size={15} /></span>
          <div>
            <div className="dmsg">{d.message}</div>
            <div className="dcode">{d.code}{d.frame ? ` · ${d.frame}` : ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span className="faint">{k}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}
