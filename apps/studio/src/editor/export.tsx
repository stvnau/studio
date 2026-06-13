import { useEffect, useRef, useState } from 'react';
import { api, type ExportJob } from '../api.js';
import { Icon } from '../icons.js';

type Kind = 'press' | 'proof' | 'digital';
const KINDS: { kind: Kind; title: string; sub: string; icon: string }[] = [
  { kind: 'press', title: 'Press PDF/X-4', sub: 'CMYK · bleed · marks · embedded fonts', icon: 'download' },
  { kind: 'proof', title: 'Screen proof', sub: 'RGB PDF for review', icon: 'eye' },
  { kind: 'digital', title: 'Digital edition', sub: 'The web guide your QR codes open', icon: 'map' },
];

export function ExportButton({ editionId }: { editionId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="exp-wrap" ref={ref}>
      <button className="btn accent" onClick={() => setOpen((v) => !v)}>
        <Icon name="download" size={14} /> Export
      </button>
      {open && (
        <div className="exp-pop pop">
          <div className="exp-pop-head">Generate from one source</div>
          {KINDS.map((k) => <ExportItem key={k.kind} editionId={editionId} spec={k} />)}
          <div className="exp-pop-foot faint">Every file is rendered from the same layout — what you see prints.</div>
        </div>
      )}
    </div>
  );
}

function ExportItem({ editionId, spec }: { editionId: string; spec: { kind: Kind; title: string; sub: string; icon: string } }) {
  const [job, setJob] = useState<ExportJob | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const start = async () => {
    setJob({ id: 'pending', editionId, kind: spec.kind, status: 'running', createdAt: '' });
    try {
      const created = await api.startExport(editionId, spec.kind);
      poll(created.id);
    } catch {
      setJob((j) => (j ? { ...j, status: 'failed', error: 'could not start' } : j));
    }
  };
  const poll = (id: string) => {
    api.getExport(id).then((j) => {
      setJob(j);
      if (j.status === 'running') timer.current = setTimeout(() => poll(id), 700);
    }).catch(() => {});
  };

  const errors = job?.diagnostics?.filter((d) => d.severity === 'error').length ?? 0;
  const warns = job?.diagnostics?.filter((d) => d.severity === 'warning').length ?? 0;

  return (
    <div className="exp-item">
      <div className="exp-item-main">
        <div className="exp-ic"><Icon name={spec.icon} size={16} /></div>
        <div className="exp-item-text">
          <b>{spec.title}</b>
          <small>{spec.sub}</small>
        </div>
      </div>
      <div className="exp-item-action">
        {!job && <button className="btn sm" onClick={start}>Generate</button>}
        {job?.status === 'running' && <span className="chip"><span className="dot" style={{ animation: 'breathe 1s infinite' }} />Rendering</span>}
        {job?.status === 'failed' && <span className="chip bad">Failed</span>}
        {job?.status === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {errors > 0 ? <span className="chip bad">{errors} err</span> : warns > 0 ? <span className="chip warn">{warns} warn</span> : <span className="chip good"><Icon name="check" size={12} /> ready</span>}
            <a className="btn sm primary" href={api.exportFileUrl(job.id)} download><Icon name="download" size={13} /></a>
          </div>
        )}
      </div>
    </div>
  );
}
