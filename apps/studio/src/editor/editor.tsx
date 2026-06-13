import { useCallback, useEffect, useRef, useState } from 'react';
import './editor.css';
import { api, ApiError, type PreviewResult } from '../api.js';
import type { Business, Edition } from '@guide/shared';
import { Icon } from '../icons.js';
import { Structure } from './structure.js';
import { Canvas } from './canvas.js';
import { Inspector } from './inspector.js';
import { ExportButton } from './export.js';

export interface Selection { frameId?: string; pageId?: string }
export interface ViewState { mode: 'page' | 'spread'; zoom: number; showBleed: boolean; pageIndex: number }
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface EditorCtx {
  edition: Edition;
  update: (mutate: (e: Edition) => void) => void;
  businesses: Business[];
  reloadBusinesses: () => void;
  preview: PreviewResult | null;
  previewing: boolean;
  selection: Selection;
  select: (sel: Selection) => void;
  view: ViewState;
  setView: (v: Partial<ViewState>) => void;
}

export function Editor({ id, onExit }: { id: string; onExit: () => void }) {
  const [edition, setEdition] = useState<Edition | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [selection, setSelection] = useState<Selection>({});
  const [view, setViewState] = useState<ViewState>({ mode: 'page', zoom: 1, showBleed: false, pageIndex: 0 });

  const revRef = useRef(0);
  const previewReq = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // initial load
  useEffect(() => {
    let alive = true;
    Promise.all([api.getEdition(id), api.listBusinesses()]).then(([ed, biz]) => {
      if (!alive) return;
      setEdition(ed);
      setBusinesses(biz);
    });
    return () => { alive = false; };
  }, [id]);

  const runPreview = useCallback((ed: Edition) => {
    const showBleed = view.showBleed;
    const reqId = ++previewReq.current;
    setPreviewing(true);
    api.preview(ed.id, ed, showBleed)
      .then((res) => { if (reqId === previewReq.current) setPreview(res); })
      .catch(() => {})
      .finally(() => { if (reqId === previewReq.current) setPreviewing(false); });
  }, [view.showBleed]);

  // first preview once loaded
  useEffect(() => { if (edition) runPreview(edition); /* eslint-disable-next-line */ }, [edition !== null, view.showBleed]);

  const update = useCallback((mutate: (e: Edition) => void) => {
    setEdition((prev) => {
      if (!prev) return prev;
      const next: Edition = structuredClone(prev);
      mutate(next);
      revRef.current++;
      // debounce preview + save
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => runPreview(next), 320);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState('saving');
      saveTimer.current = setTimeout(() => save(next), 850);
      return next;
    });
  }, [runPreview]);

  const save = useCallback(async (ed: Edition) => {
    try {
      const saved = await api.updateEdition(ed.id, ed);
      // adopt server's bookkeeping without clobbering in-flight edits
      setEdition((cur) => (cur ? { ...cur, updatedAt: saved.updatedAt, listingOrder: saved.listingOrder } : cur));
      setSaveState('saved');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === 'object' && 'current' in e.body) {
        setEdition((e.body as { current: Edition }).current);
      }
      setSaveState('error');
    }
  }, []);

  const setView = useCallback((v: Partial<ViewState>) => setViewState((s) => ({ ...s, ...v })), []);

  if (!edition) {
    return <div className="editor"><div className="ed-topbar" /><div style={{ display: 'grid', placeItems: 'center' }}><Icon name="logo" size={26} /></div></div>;
  }

  const ctx: EditorCtx = {
    edition, update, businesses,
    reloadBusinesses: () => api.listBusinesses().then(setBusinesses),
    preview, previewing, selection, select: setSelection, view, setView,
  };

  return (
    <div className="editor">
      <TopBar edition={edition} saveState={saveState} previewing={previewing} view={view} setView={setView} onExit={onExit}
        onRename={(name) => update((e) => { e.name = name; })} />
      <div className="ed-body">
        <Structure ctx={ctx} />
        <Canvas ctx={ctx} />
        <Inspector ctx={ctx} />
      </div>
    </div>
  );
}

function TopBar({ edition, saveState, previewing, view, setView, onExit, onRename }: {
  edition: Edition; saveState: SaveState; previewing: boolean; view: ViewState;
  setView: (v: Partial<ViewState>) => void; onExit: () => void; onRename: (n: string) => void;
}) {
  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : 'Up to date';
  return (
    <div className="ed-topbar">
      <div className="group">
        <button className="iconbtn" onClick={onExit} title="Back to editions"><Icon name="back" /></button>
        <div className="ed-title">
          <input value={edition.name} onChange={(e) => onRename(e.target.value)} spellCheck={false} />
          <small>{edition.hotel.name}</small>
        </div>
      </div>
      <div className={`save-chip ${saveState}`}><span className="pip" />{saveLabel}</div>
      <div className="spacer" />
      <div className="group">
        <div className="seg">
          <button className={view.mode === 'page' ? 'on' : ''} onClick={() => setView({ mode: 'page' })}><Icon name="page" size={13} /></button>
          <button className={view.mode === 'spread' ? 'on' : ''} onClick={() => setView({ mode: 'spread' })}><Icon name="spread" size={13} /></button>
        </div>
        <button className={`iconbtn ${view.showBleed ? 'on' : ''}`} title="Show bleed & marks" onClick={() => setView({ showBleed: !view.showBleed })}><Icon name="bleed" /></button>
        {previewing && <span className="faint" style={{ fontSize: 11, width: 56 }}>Rendering…</span>}
      </div>
      <div className="spacer" />
      <ExportButton editionId={edition.id} />
    </div>
  );
}
