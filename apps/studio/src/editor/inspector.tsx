import { useState } from 'react';
import type { EditorCtx } from './editor.js';
import type { Diagnostic, FrameOverride } from '@guide/shared';
import { PT_PER_MM, overridePinsGeometry, ptToMm, worstSeverity } from '@guide/shared';
import { Icon } from '../icons.js';

type Patch = FrameOverride['patch'];
type Align = NonNullable<Patch['align']>;

export function Inspector({ ctx }: { ctx: EditorCtx }) {
  const { preview } = ctx;
  const [tab, setTab] = useState<'props' | 'settings' | 'validate'>('props');
  const diags = preview?.diagnostics ?? [];
  const errors = diags.filter((d) => d.severity === 'error').length;
  const warns = diags.filter((d) => d.severity === 'warning').length;

  return (
    <div className="pane pane-right">
      <div className="insp-tabs">
        <button className={`insp-tab ${tab === 'props' ? 'on' : ''}`} onClick={() => setTab('props')}>
          <Icon name="layout" size={14} /> Element
        </button>
        <button className={`insp-tab ${tab === 'settings' ? 'on' : ''}`} onClick={() => setTab('settings')}>
          <Icon name="bleed" size={14} /> Settings
        </button>
        <button className={`insp-tab ${tab === 'validate' ? 'on' : ''}`} onClick={() => setTab('validate')}>
          <Icon name="check" size={14} /> Validate
          {errors > 0 ? <span className="count bad">{errors}</span> : warns > 0 ? <span className="count warn">{warns}</span> : null}
        </button>
      </div>
      <div className="pane-scroll" style={{ padding: 0 }}>
        {tab === 'props' ? <Properties ctx={ctx} /> : tab === 'settings' ? <Settings ctx={ctx} /> : <Validate ctx={ctx} />}
      </div>
    </div>
  );
}

const TRIM_PRESETS = [
  { label: 'Pocket', w: 101.5, h: 185 },
  { label: 'A6', w: 105, h: 148 },
  { label: 'A5', w: 148, h: 210 },
  { label: 'DL', w: 99, h: 210 },
];

function Settings({ ctx }: { ctx: EditorCtx }) {
  const { edition, update } = ctx;
  const s = edition.settings;
  const mg = s.margins ?? { top: 12, bottom: 14, inner: 12, outer: 9 };
  const setS = (patch: Partial<typeof s>) => update((e) => { Object.assign(e.settings, patch); });
  const setMargin = (k: 'top' | 'bottom' | 'inner' | 'outer', v: number) =>
    update((e) => {
      const m = { ...(e.settings.margins ?? { top: 12, bottom: 14, inner: 12, outer: 9 }) };
      m[k] = v;
      e.settings.margins = m;
    });
  const mapPage = edition.pages.find((p) => p.kind === 'map') as { kind: 'map'; spread: boolean } | undefined;
  const setSpread = (spread: boolean) =>
    update((e) => { const mp = e.pages.find((p) => p.kind === 'map'); if (mp && mp.kind === 'map') mp.spread = spread; });

  return (
    <>
      <div className="insp-block">
        <h4>Trim size</h4>
        <div className="preset-row">
          {TRIM_PRESETS.map((p) => (
            <button key={p.label} className={`btn sm ${s.trimWidthMm === p.w && s.trimHeightMm === p.h ? 'primary' : ''}`}
              onClick={() => setS({ trimWidthMm: p.w, trimHeightMm: p.h })}>{p.label}</button>
          ))}
        </div>
        <div className="coord-grid" style={{ marginTop: 10 }}>
          <Coord label="Width (mm)" value={s.trimWidthMm} onCommit={(v) => setS({ trimWidthMm: clamp(v, 40, 330) })} />
          <Coord label="Height (mm)" value={s.trimHeightMm} onCommit={(v) => setS({ trimHeightMm: clamp(v, 40, 480) })} />
        </div>
      </div>

      <div className="insp-block">
        <h4>Margins (mm)</h4>
        <div className="coord-grid">
          <Coord label="Top" value={mg.top} onCommit={(v) => setMargin('top', clamp(v, 0, 60))} />
          <Coord label="Bottom" value={mg.bottom} onCommit={(v) => setMargin('bottom', clamp(v, 0, 60))} />
          <Coord label="Inner (spine)" value={mg.inner} onCommit={(v) => setMargin('inner', clamp(v, 0, 60))} />
          <Coord label="Outer (fore-edge)" value={mg.outer} onCommit={(v) => setMargin('outer', clamp(v, 0, 60))} />
        </div>
      </div>

      <div className="insp-block">
        <h4>Prepress</h4>
        <div className="coord-grid">
          <Coord label="Bleed (mm)" value={s.bleedMm} onCommit={(v) => setS({ bleedMm: clamp(v, 0, 12) })} />
          <Coord label="Grid (pt)" value={s.baselineGridPt} onCommit={(v) => setS({ baselineGridPt: clamp(v, 6, 24) })} />
          <Coord label="Ink limit (%)" value={s.inkLimit} onCommit={(v) => setS({ inkLimit: clamp(v, 200, 360) })} />
        </div>
        <div className="set-static">ICC profile · <b>Guide Studio Coated CMYK</b> (built-in)</div>
      </div>

      <div className="insp-block">
        <h4>Spot colour</h4>
        <label className="set-toggle">
          <input type="checkbox" checked={!!s.spotColor}
            onChange={(e) => setS({ spotColor: e.target.checked ? { name: 'Brand', altHex: edition.hotel.brand.primary } : null })} />
          Render a brand spot plate
        </label>
        {s.spotColor && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <TextField label="Plate name" value={s.spotColor.name} onCommit={(v) => setS({ spotColor: { name: v || 'Brand', altHex: s.spotColor!.altHex } })} />
            <div className="field">
              <label>Fallback colour</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={s.spotColor.altHex} onChange={(e) => setS({ spotColor: { name: s.spotColor!.name, altHex: e.target.value } })}
                  style={{ width: 34, height: 32, padding: 0, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'none' }} />
                <input className="input" value={s.spotColor.altHex} onChange={(e) => setS({ spotColor: { name: s.spotColor!.name, altHex: e.target.value } })} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="insp-block">
        <h4>Edition</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TextField label="Publisher (cover “By …”)" value={s.publisher} onCommit={(v) => setS({ publisher: v })} />
          <TextField label="Digital base URL (QR target)" value={s.digitalBaseUrl} onCommit={(v) => setS({ digitalBaseUrl: v })} />
        </div>
        {mapPage && (
          <label className="set-toggle" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={mapPage.spread} onChange={(e) => setSpread(e.target.checked)} />
            Map as a two-page spread
          </label>
        )}
      </div>
    </>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isNaN(v) ? lo : Math.min(hi, Math.max(lo, v));
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
  const patch = override?.patch;
  const r = frame.rect;
  const isText = frame.kind === 'text';

  // Pin geometry: seed all four sides so the box is fully fixed, then apply the
  // edit. Typing a coordinate is an explicit "place it here".
  const setGeom = (p: Partial<Patch>) => {
    update((e) => {
      const ex = e.overrides.find((o) => o.frame === frameId);
      if (ex) {
        Object.assign(ex.patch, p);
        ex.at = new Date().toISOString();
      } else {
        e.overrides.push({
          frame: frameId,
          patch: { x: r.x, y: r.y, w: r.w, h: r.h, ...p },
          base: { x: r.x, y: r.y, w: r.w, h: r.h },
          at: new Date().toISOString(),
        });
      }
    });
  };

  // Set or clear a single field WITHOUT pinning geometry (typography, hide), so
  // the element keeps reflowing with the data. Pruned when nothing is left.
  const setField = <K extends keyof Patch>(field: K, value: Patch[K] | undefined) => {
    update((e) => {
      let ov = e.overrides.find((o) => o.frame === frameId);
      if (!ov) {
        if (value === undefined) return;
        ov = { frame: frameId, patch: {}, base: { x: r.x, y: r.y, w: r.w, h: r.h }, at: '' };
        e.overrides.push(ov);
      }
      if (value === undefined) delete ov.patch[field];
      else ov.patch[field] = value;
      ov.at = new Date().toISOString();
      if (Object.keys(ov.patch).length === 0) e.overrides = e.overrides.filter((o) => o !== ov);
    });
  };

  const reset = () => update((e) => { e.overrides = e.overrides.filter((o) => o.frame !== frameId); });
  // Drop only the geometry pin, keeping any typography overrides intact.
  const unpin = () => update((e) => {
    const ov = e.overrides.find((o) => o.frame === frameId);
    if (!ov) return;
    delete ov.patch.x; delete ov.patch.y; delete ov.patch.w; delete ov.patch.h;
    ov.at = new Date().toISOString();
    if (Object.keys(ov.patch).length === 0) e.overrides = e.overrides.filter((o) => o !== ov);
  });
  const pinned = override ? overridePinsGeometry(override) : false;

  // Coordinates shown in mm from the trim edge.
  const toMm = (ptVal: number, sub = 0) => +(ptToMm(ptVal - sub)).toFixed(1);
  const fromMm = (mmVal: number, add = 0) => mmVal * PT_PER_MM + add;

  return (
    <>
      <ListingContent ctx={ctx} frameId={frameId} />

      {isText && (
        <div className="insp-block">
          <h4>Typography</h4>
          <Stepper label="Type size" value={patch?.fontScale ?? 1} min={0.5} max={2.5} step={0.05}
            fmt={pct} onChange={(v) => setField('fontScale', near(v, 1) ? undefined : v)} />
          <Stepper label="Line spacing" value={patch?.leading ?? 1} min={0.6} max={2} step={0.05}
            fmt={pct} onChange={(v) => setField('leading', near(v, 1) ? undefined : v)} />
          <Stepper label="Letter spacing" value={patch?.tracking ?? 0} min={-80} max={400} step={10}
            fmt={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`} onChange={(v) => setField('tracking', near(v, 0) ? undefined : v)} />
          <div className="typo-row">
            <label>Alignment</label>
            <div className="seg align-seg">
              {(['start', 'center', 'end', 'justify'] as Align[]).map((a) => (
                <button key={a} className={patch?.align === a ? 'on' : ''} title={ALIGN_LABEL[a]}
                  onClick={() => setField('align', patch?.align === a ? undefined : a)}>
                  <Icon name={ALIGN_ICON[a]} size={14} />
                </button>
              ))}
            </div>
          </div>
          <label className="typo-check">
            <input type="checkbox" checked={!!patch?.caps} onChange={(e) => setField('caps', e.target.checked ? true : undefined)} />
            Uppercase
          </label>
        </div>
      )}

      <div className="insp-block">
        <h4>Size &amp; position</h4>
        <div style={{ fontSize: 12, color: 'var(--ink-faint)', marginBottom: 12, wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums' }}>{frameId}</div>
        <div className="coord-grid">
          <Coord label="X (mm)" value={toMm(r.x, bleed)} onCommit={(v) => setGeom({ x: fromMm(v, bleed) })} />
          <Coord label="Y (mm)" value={toMm(r.y, bleed)} onCommit={(v) => setGeom({ y: fromMm(v, bleed) })} />
          <Coord label="W (mm)" value={toMm(r.w)} onCommit={(v) => setGeom({ w: fromMm(v) })} />
          <Coord label="H (mm)" value={toMm(r.h)} onCommit={(v) => setGeom({ h: fromMm(v) })} />
        </div>
        {pinned && (
          <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={unpin}>
            <Icon name="reset" size={13} /> Unpin position
          </button>
        )}
      </div>

      <div className="insp-block">
        <h4>Override</h4>
        {override ? (
          <>
            <div className={`override-note ${pinned ? 'pinned' : 'custom'}`} style={{ marginBottom: 10 }}>
              <Icon name="info" size={14} />
              <span>{pinned
                ? 'Pinned in place. Data changes won’t move it; later layout shifts are flagged instead of discarding your placement.'
                : 'Custom styling applied. This element still reflows with the data — only its look is overridden.'}</span>
            </div>
            <button className="btn sm" onClick={reset}><Icon name="reset" size={13} /> Reset to automatic</button>
          </>
        ) : (
          <div className="faint" style={{ fontSize: 12.5 }}>Automatic. Drag, resize, or restyle this element to override it.</div>
        )}
        <label className="typo-check" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={!!patch?.hidden} onChange={(e) => setField('hidden', e.target.checked ? true : undefined)} />
          Hide this element
        </label>
      </div>
    </>
  );
}

const ALIGN_ICON: Record<Align, string> = { start: 'alignLeft', center: 'alignCenter', end: 'alignRight', justify: 'alignJustify' };
const ALIGN_LABEL: Record<Align, string> = { start: 'Left', center: 'Centre', end: 'Right', justify: 'Justify' };
const pct = (v: number) => `${Math.round(v * 100)}%`;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** A labelled −/value/+ control. Values are clamped and rounded to 3 dp. */
function Stepper({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 1000) / 1000)));
  return (
    <div className="typo-row">
      <label>{label}</label>
      <div className="stepper">
        <button className="step-btn" onClick={() => set(value - step)} disabled={value <= min} title="Decrease"><Icon name="minus" size={13} /></button>
        <span className="step-val">{fmt(value)}</span>
        <button className="step-btn" onClick={() => set(value + step)} disabled={value >= max} title="Increase"><Icon name="plus" size={13} /></button>
      </div>
    </div>
  );
}

/**
 * Edit a listing's per-edition copy overrides in place. Empty means "use the
 * directory record" — the placeholder shows what that fallback is. Writing
 * here changes the copy the engine resolves, so the canvas reflows live.
 */
function ListingContent({ ctx, frameId }: { ctx: EditorCtx; frameId: string }) {
  const m = /^listing:([^:]+):/.exec(frameId);
  if (!m) return null;
  const listingId = m[1]!;
  const listing = ctx.edition.listings.find((l) => l.id === listingId);
  if (!listing) return null;
  const biz = ctx.businesses.find((b) => b.id === listing.businessId);

  const setCopy = (field: 'name' | 'oneLiner' | 'description', value: string) => {
    ctx.update((e) => {
      const l = e.listings.find((x) => x.id === listingId);
      if (!l) return;
      const copy = { ...(l.copy ?? {}) };
      if (value.trim()) copy[field] = value;
      else delete copy[field];
      l.copy = Object.keys(copy).length ? copy : undefined;
    });
  };

  return (
    <div className="insp-block">
      <h4>Content · {biz?.name ?? 'listing'}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextField label="Name" value={listing.copy?.name ?? ''} placeholder={biz?.name ?? ''} onCommit={(v) => setCopy('name', v)} />
        <TextField label="One-liner" value={listing.copy?.oneLiner ?? ''} placeholder={biz?.oneLiner ?? ''} onCommit={(v) => setCopy('oneLiner', v)} />
        <TextField label="Description" value={listing.copy?.description ?? ''} placeholder={biz?.description ?? ''} textarea onCommit={(v) => setCopy('description', v)} />
      </div>
    </div>
  );
}

function TextField({ label, value, placeholder, textarea, onCommit }: {
  label: string; value: string; placeholder?: string; textarea?: boolean; onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setLocal(value); }
  const common = {
    value: local,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setLocal(e.target.value),
    onBlur: () => { if (local !== value) onCommit(local); },
  };
  return (
    <div className="field">
      <label>{label}</label>
      {textarea ? <textarea className="textarea" rows={3} {...common} /> : <input className="input" {...common} />}
    </div>
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
