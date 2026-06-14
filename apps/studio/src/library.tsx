import { useEffect, useMemo, useState } from 'react';
import { api, type EditionSummary, type User } from './api.js';
import type { Edition } from '@guide/shared';
import { Icon } from './icons.js';

const BRANDS = [
  { primary: '#1B423B', secondary: '#B65C3F', accent: '#C99B5F' },
  { primary: '#2A2E45', secondary: '#C2604A', accent: '#D6A95C' },
  { primary: '#3C3A34', secondary: '#7E8A6B', accent: '#C58A4E' },
  { primary: '#4A2B33', secondary: '#A6655A', accent: '#D8B27C' },
  { primary: '#1F3A44', secondary: '#3E7C7B', accent: '#E0B25C' },
];

/** Deterministic warm field colour for a card cover. */
function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BRANDS[h % BRANDS.length]!.primary;
}

export function Library({ user, onOpen, onSignOut }: { user: User; onOpen: (id: string) => void; onSignOut: () => void }) {
  const [editions, setEditions] = useState<EditionSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => api.listEditions().then(setEditions).catch(() => setEditions([]));
  useEffect(() => { reload(); }, []);

  return (
    <div className="lib">
      <header className="lib-top">
        <div className="brandmark"><Icon name="logo" size={22} strokeWidth={1.3} /><span>Guide Studio</span></div>
        <div className="lib-acct">
          <div className="who"><b>{user.name}</b><small>{user.role === 'owner' ? 'Studio owner' : 'Member'}</small></div>
          <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <button className="btn ghost sm" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <div className="lib-hero">
        <div className="eyebrow">The Workshop</div>
        <h1 className="serif">Editions</h1>
        <p>Every guide you’re building lives here. Open one to assemble pages, place businesses, and export press-ready files.</p>
      </div>

      <div className="lib-grid-wrap">
        <div className="lib-grid-head">
          <h2>{editions ? `${editions.length} edition${editions.length === 1 ? '' : 's'}` : 'Loading'}</h2>
        </div>
        <div className="lib-grid">
          <button className="ed-new" onClick={() => setCreating(true)}>
            <div className="inner"><div className="ring"><Icon name="plus" size={18} /></div><span>New edition</span></div>
          </button>
          {editions?.map((e) => (
            <button key={e.id} className="ed-card pop" onClick={() => onOpen(e.id)}>
              <div className="ed-card-cover" style={{ background: hashColor(e.id) }}>
                <span className="mono">{e.hotel}</span>
              </div>
              <div className="ed-card-body">
                <h3>{e.name}</h3>
                <div className="sub">{e.hotel}</div>
                <div className="meta"><Icon name="layout" size={13} /> Edited {relTime(e.updatedAt)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />}
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('Summer 2026');
  const [hotel, setHotel] = useState('');
  const [brandIdx, setBrandIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!hotel.trim()) return;
    setBusy(true);
    try {
      const doc = starterEdition(name.trim() || 'New Edition', hotel.trim(), BRANDS[brandIdx]!);
      const created = await api.createEdition(doc);
      onCreated(created.id);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>New edition</h2>
          <p>Name the guide and its hotel. You can refine everything later.</p>
        </div>
        <div className="modal-body">
          <div className="field"><label>Hotel</label><input className="input" autoFocus value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="The Sandling Hotel" /></div>
          <div className="field"><label>Edition</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer 2026" /></div>
          <div className="field">
            <label>Brand palette</label>
            <div className="swatch-row">
              {BRANDS.map((b, i) => (
                <button key={i} className="swatch" onClick={() => setBrandIdx(i)}
                  style={{ background: b.primary, outline: i === brandIdx ? `2px solid var(--accent)` : 'none', outlineOffset: 2 }} aria-label={`Palette ${i + 1}`} />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn accent" disabled={busy || !hotel.trim()} onClick={create}>{busy ? 'Creating…' : 'Create edition'}</button>
        </div>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const d = Date.now() - Date.parse(iso);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** A fresh edition that already reads as a real guide skeleton. */
function starterEdition(name: string, hotelName: string, brand: { primary: string; secondary: string; accent: string }): Partial<Edition> & { name: string; hotel: { name: string } } {
  const wordmark = hotelName.replace(/^The\s+/i, '');
  const sections = [
    { id: 's-eat', title: 'Eat & Drink', short: 'Eat' },
    { id: 's-do', title: 'Things to Do', short: 'Do' },
    { id: 's-shop', title: 'Shop & Keep', short: 'Shop' },
  ];
  return {
    name,
    hotel: {
      name: hotelName,
      wordmark,
      tagline: 'A considered stay by the water.',
      url: 'hotel.example',
      brand,
      stayEssentials: [
        { label: 'Check-out', value: '11:00' },
        { label: 'Wi-Fi', value: 'sandling-guest' },
        { label: 'Front desk', value: 'Dial 0' },
      ],
      welcome: {
        heading: 'It’s good to have you here.',
        intro: 'Make yourself at home. This little book gathers the places we love within a short walk of the door — the ones we’d send a good friend to.',
        guideIntro: 'Numbers on each listing match the neighbourhood map at the back. Scan a code to open its page online.',
      },
      infoBlocks: [
        { id: 'ib-pool', title: 'The Pool Club', kicker: 'Level 3 · 6am – 10pm', body: 'A sheltered lap pool and a row of sun loungers that catch the afternoon light. Towels are stocked; order a cold drink from the bar without leaving the water.' },
        { id: 'ib-bistro', title: 'The Bistro', kicker: 'Ground floor · All day', body: 'Our kitchen leans on the same growers and fishers as the guide. Breakfast runs late, and the wine list is short, local and good.' },
      ],
      keysNote: 'Slip your room cards into the holders below. They carry the hotel mark, so they’re easy to find at the bottom of a bag.',
    },
    settings: {
      trimWidthMm: 101.5, trimHeightMm: 185, bleedMm: 3,
      margins: { top: 5, bottom: 5, inner: 5, outer: 5 },
      baselineGridPt: 12,
      iccProfile: 'builtin:guide-cmyk', spotColor: null, inkLimit: 300,
      digitalBaseUrl: '', publisher: 'Atelier North',
    },
    sections,
    listings: [],
    listingOrder: [],
    pages: [
      { id: 'p-cover', kind: 'cover' },
      { id: 'p-welcome', kind: 'welcome' },
      { id: 'p-info', kind: 'hotel-info', blockIds: ['ib-pool', 'ib-bistro'] },
      { id: 'p-list-eat', kind: 'listings', sectionId: 's-eat' },
      { id: 'p-list-do', kind: 'listings', sectionId: 's-do' },
      { id: 'p-list-shop', kind: 'listings', sectionId: 's-shop' },
      { id: 'p-map', kind: 'map', spread: false },
      { id: 'p-keys', kind: 'keys' },
      { id: 'p-back', kind: 'back-cover' },
    ],
    map: { source: 'fixture:pelican-point', tint: 1, bbox: { minLat: -33.8466, minLng: 151.2762, maxLat: -33.8374, maxLng: 151.2878 } },
    overrides: [],
  } as Partial<Edition> & { name: string; hotel: { name: string } };
}
