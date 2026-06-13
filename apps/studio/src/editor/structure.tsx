import { useMemo, useState } from 'react';
import type { EditorCtx } from './editor.js';
import type { Business, PageSpec, Tier } from '@guide/shared';
import { numberedListings, TIER_LABELS } from '@guide/shared';
import { Icon } from '../icons.js';

const TIER_COLOR: Record<Tier, string> = { full: '#1f6f54', half: '#bd5b36', quarter: '#b08327', list: '#7a766c' };
const TIER_ORDER: Tier[] = ['full', 'half', 'quarter', 'list'];

const PAGE_ICON: Record<string, string> = {
  cover: 'cover', welcome: 'welcome', 'hotel-info': 'image', divider: 'divider',
  listings: 'list', map: 'map', keys: 'key', 'back-cover': 'cover',
};

export function Structure({ ctx }: { ctx: EditorCtx }) {
  const { edition, update, preview, selection, select } = ctx;
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [overPage, setOverPage] = useState<number | null>(null);

  const sectionTitle = (id: string) => edition.sections.find((s) => s.id === id)?.title ?? 'Section';
  const pageLabel = (p: PageSpec): string => {
    switch (p.kind) {
      case 'cover': return 'Cover';
      case 'back-cover': return 'Back cover';
      case 'welcome': return 'Welcome';
      case 'hotel-info': return 'Hotel information';
      case 'keys': return 'Your keys';
      case 'map': return p.spread ? 'Map — spread' : 'Neighbourhood map';
      case 'divider': return sectionTitle(p.sectionId);
      case 'listings': return `${sectionTitle(p.sectionId)} — places`;
    }
  };

  // Map a page spec to its first physical page index (for selection & folio).
  const physIndexOf = useMemo(() => {
    const m = new Map<string, number>();
    if (preview) {
      preview.pages.forEach((pg, i) => {
        const spec = pg.pageId.split(':')[0]!;
        if (!m.has(spec)) m.set(spec, i);
      });
    }
    return m;
  }, [preview]);

  const selectedSpec = selection.pageId ? selection.pageId.split(':')[0] : undefined;

  const movePage = (from: number, to: number) => {
    if (to < 0 || to >= edition.pages.length || from === to) return;
    update((e) => {
      const [m] = e.pages.splice(from, 1);
      e.pages.splice(to, 0, m!);
    });
  };

  const numbered = numberedListings(edition);
  const bizById = new Map(ctx.businesses.map((b) => [b.id, b]));

  return (
    <div className="pane pane-left">
      <div className="pane-scroll">
        {/* Pages */}
        <div className="pane-sec">
          <div className="pane-sec-head"><h3>Pages</h3><span className="faint" style={{ fontSize: 11 }}>{edition.pages.length}</span></div>
          {edition.pages.map((p, i) => {
            const physIdx = physIndexOf.get(p.id);
            const on = selectedSpec === p.id;
            return (
              <div key={p.id}
                className={`page-row ${on ? 'on' : ''} ${dragPage === i ? 'dragging' : ''} ${overPage === i && dragPage !== null ? 'dropbefore' : ''}`}
                draggable
                onDragStart={() => setDragPage(i)}
                onDragOver={(e) => { e.preventDefault(); setOverPage(i); }}
                onDragEnd={() => { if (dragPage !== null && overPage !== null) movePage(dragPage, overPage); setDragPage(null); setOverPage(null); }}
                onClick={() => {
                  if (physIdx === undefined) return;
                  ctx.setView({ pageIndex: physIdx });
                  select({ pageId: preview?.pages[physIdx]?.pageId });
                }}
              >
                <span className="phandle"><Icon name="drag" size={14} /></span>
                <span className="pico"><Icon name={PAGE_ICON[p.kind] ?? 'page'} size={14} /></span>
                <span className="pname">{pageLabel(p)}</span>
                <span className="pnum">{physIdx !== undefined ? physIdx + 1 : ''}</span>
              </div>
            );
          })}
        </div>

        {/* Listings by section */}
        <div className="pane-sec">
          <div className="pane-sec-head"><h3>Places</h3><span className="faint" style={{ fontSize: 11 }}>{numbered.length}</span></div>
          {edition.sections.map((sec) => {
            const rows = numbered.filter((n) => n.listing.sectionId === sec.id);
            return (
              <SectionGroup key={sec.id} ctx={ctx} sectionId={sec.id} title={sec.title} rows={rows} bizById={bizById}
                tierColor={TIER_COLOR} selection={selection} select={select} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SectionGroup({ ctx, sectionId, title, rows, bizById, tierColor, selection, select }: {
  ctx: EditorCtx; sectionId: string; title: string;
  rows: { listing: import('@guide/shared').Listing; number: number }[];
  bizById: Map<string, Business>; tierColor: Record<Tier, string>;
  selection: { frameId?: string; pageId?: string }; select: (s: { frameId?: string; pageId?: string }) => void;
}) {
  const { edition, update } = ctx;
  const [picking, setPicking] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const setTier = (lid: string, tier: Tier) => update((e) => { const l = e.listings.find((x) => x.id === lid); if (l) l.tier = tier; });
  const remove = (lid: string) => update((e) => { e.listings = e.listings.filter((x) => x.id !== lid); e.listingOrder = e.listingOrder.filter((x) => x !== lid); });

  const reorder = (dragLid: string, overLid: string) => {
    if (dragLid === overLid) return;
    update((e) => {
      const order = [...e.listingOrder];
      const from = order.indexOf(dragLid); const to = order.indexOf(overLid);
      if (from < 0 || to < 0) return;
      order.splice(from, 1); order.splice(to, 0, dragLid);
      e.listingOrder = order;
    });
  };

  return (
    <div className="sec-group">
      <div className="sec-group-head"><span className="stitle serif">{title}</span><span className="scount">{rows.length}</span></div>
      {rows.map(({ listing, number }) => {
        const biz = bizById.get(listing.businessId);
        const name = listing.copy?.name ?? biz?.name ?? 'Untitled';
        const sel = selection.frameId?.startsWith(`listing:${listing.id}`);
        return (
          <div key={listing.id} className={`listing-row ${sel ? 'on' : ''}`}
            draggable onDragStart={() => setDragId(listing.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId) reorder(dragId, listing.id); setDragId(null); }}
            onClick={() => select({ frameId: `listing:${listing.id}:name` })}
          >
            <span className="lhandle"><Icon name="drag" size={13} /></span>
            <span className="lnum" style={{ background: tierColor[listing.tier] }}>{number}</span>
            <span className="lname">{name}</span>
            <div className="tier-pop">
              {TIER_ORDER.map((t) => (
                <button key={t} className={`tierbtn ${listing.tier === t ? 'on' : ''}`} title={TIER_LABELS[t]}
                  onClick={(ev) => { ev.stopPropagation(); setTier(listing.id, t); }}>{t[0]!.toUpperCase()}</button>
              ))}
              <button className="tierbtn" title="Remove" onClick={(ev) => { ev.stopPropagation(); remove(listing.id); }}><Icon name="x" size={11} /></button>
            </div>
          </div>
        );
      })}
      <button className="add-row" onClick={() => setPicking(true)}><Icon name="plus" size={14} /> Add a place</button>
      {picking && <BizPicker ctx={ctx} sectionId={sectionId} onClose={() => setPicking(false)} />}
    </div>
  );
}

function BizPicker({ ctx, sectionId, onClose }: { ctx: EditorCtx; sectionId: string; onClose: () => void }) {
  const { edition, update, businesses } = ctx;
  const [q, setQ] = useState('');
  const placed = new Set(edition.listings.map((l) => l.businessId));
  const list = businesses.filter((b) => !placed.has(b.id) && b.name.toLowerCase().includes(q.toLowerCase()));

  const add = (b: Business) => {
    update((e) => {
      const id = crypto.randomUUID();
      e.listings.push({ id, businessId: b.id, sectionId, tier: 'quarter' });
      e.listingOrder.push(id);
    });
    onClose();
  };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Add a place</h2><p>Pick from your directory. Tier and copy can be refined after.</p></div>
        <div className="modal-body" style={{ maxHeight: '52vh', overflow: 'auto' }}>
          <div className="biz-search"><input className="input" autoFocus placeholder="Search directory…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {list.length === 0 && <div className="faint" style={{ textAlign: 'center', padding: 24 }}>No places left to add.</div>}
          {list.map((b) => (
            <div className="biz-item" key={b.id} onClick={() => add(b)}>
              {b.images?.[0] ? <img className="biz-thumb" src={`/api/assets/${b.images[0]}/thumb?w=96`} alt="" /> : <div className="biz-thumb" />}
              <div className="biz-meta"><b>{b.name}</b><small>{b.category} · {b.suburb}</small></div>
              <Icon name="plus" size={15} />
            </div>
          ))}
        </div>
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
