/**
 * Builds fixtures/demo/seed.json — the demo workspace: The Sandling hotel,
 * Pelican Point, with 18 listed businesses. Asset metadata is merged from
 * images/manifest.json (written by apps/server/scripts/gen-demo-images.mts).
 * Run: cd apps/server && pnpm tsx ../../fixtures/demo/gen-seed.mts
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const C = { lat: -33.842, lng: 151.282 }; // Pelican Point centre

interface Biz {
  id: string;
  name: string;
  category: string;
  oneLiner: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  website?: string;
  instagram?: string;
  phone?: string;
  images: string[];
  tier: 'full' | 'half' | 'quarter' | 'list';
  section: string;
}

const at = (dlat: number, dlng: number) => ({ lat: C.lat + dlat, lng: C.lng + dlng });

const BIZ: Biz[] = [
  // ---- Eat & Drink -------------------------------------------------------
  {
    id: 'b-luma', name: 'Lúma', category: 'Dining room', tier: 'full', section: 'eat',
    oneLiner: 'Harbour-side dining room where the day’s catch sets the menu.',
    description:
      'Lúma keeps things close: fish from the co-op two doors down, vegetables from growers up the river, a wine list that rarely leaves the state. The room is all pale timber and low evening light, with the harbour going gold outside. Book the early sitting and stay for the last ferry.',
    address: '2 Marine Parade', ...at(-0.0021, -0.0042),
    website: 'https://luma.example.com', instagram: '@luma.pelicanpoint', phone: '(02) 9301 4410',
    images: ['biz-luma'],
  },
  {
    id: 'b-tidal', name: 'Tidal', category: 'Modern Australian', tier: 'half', section: 'eat',
    oneLiner: 'Season-led plates in a converted boat shed.',
    description:
      'A small kitchen with serious intent — short menu, open fire, and a shifting cast of local seafood. The shed doors roll up in summer and the whole room becomes a deck.',
    address: '18 Wharf Road', ...at(-0.0034, -0.0019),
    website: 'https://tidal.example.com', instagram: '@tidal.shed',
    images: ['biz-tidal'],
  },
  {
    id: 'b-curlew', name: 'The Curlew', category: 'Café', tier: 'half', section: 'eat',
    oneLiner: 'The neighbourhood’s morning room — pastry first, then the papers.',
    description:
      'Named for the street and loud with regulars by eight. House-laminated croissants, a single-origin rotation, and window seats made for slow starts.',
    address: '41 Curlew Street', ...at(0.0009, 0.0014),
    instagram: '@thecurlew', images: ['biz-curlew'],
  },
  {
    id: 'b-saltbird', name: 'Saltbird', category: 'Wine bar', tier: 'quarter', section: 'eat',
    oneLiner: 'Forty wines by the glass, anchovies to match.',
    address: '7 Pelican Parade', ...at(0.0002, -0.0008),
    description: 'A slip of a bar with a long marble counter and a list that rewards curiosity.',
    instagram: '@saltbird.bar', images: ['biz-saltbird'],
  },
  {
    id: 'b-noon', name: 'Noon', category: 'Bakery', tier: 'quarter', section: 'eat',
    oneLiner: 'Wood-fired sourdough until it sells out — usually by noon.',
    address: '12 Banksia Avenue', ...at(0.0021, 0.0006),
    description: 'Two ovens, one bench, no compromises. Saturday’s fig loaf is a local event.',
    images: ['biz-noon'],
  },
  {
    id: 'b-hearth', name: 'Hearth', category: 'Wood-fired', tier: 'quarter', section: 'eat',
    oneLiner: 'Everything through the coals, even dessert.',
    address: '88 Harbour View Road', ...at(0.0033, -0.0014),
    description: 'A hillside room built around a four-metre fireplace. Come hungry.',
    phone: '(02) 9301 7782', images: ['biz-hearth'],
  },
  {
    id: 'b-jetty', name: 'Jetty Provedore', category: 'Provedore', tier: 'list', section: 'eat',
    oneLiner: 'Picnic supplies, harbour-front — ask for the smoked trout.',
    address: '1 Wharf Road', ...at(-0.0029, -0.0026),
    description: '', images: ['biz-jetty'],
  },
  {
    id: 'b-corner', name: 'Corner Green', category: 'Kiosk', tier: 'list', section: 'eat',
    oneLiner: 'Espresso and juices at the reserve gates.',
    address: '2A Seagrass Lane', ...at(0.0014, -0.0031),
    description: '', images: ['biz-corner'],
  },
  // ---- Things to Do ------------------------------------------------------
  {
    id: 'b-seabaths', name: 'Pelican Sea Baths', category: 'Ocean baths', tier: 'full', section: 'do',
    oneLiner: 'Saltwater laps in a 1923 pavilion, sunrise to dusk.',
    description:
      'The point’s great civic luxury: a fifty-metre tidal pool held off the harbour by a century of sandstone. Swim at dawn when the surface is glass, or come at golden hour with everyone else and call it culture. Towels and a very good kiosk on the deck.',
    address: 'Marine Parade, south end', ...at(-0.0041, 0.0011),
    website: 'https://seabaths.example.com', images: ['biz-seabaths'],
  },
  {
    id: 'b-gallery', name: 'Gallery Q', category: 'Gallery', tier: 'half', section: 'do',
    oneLiner: 'Contemporary work in a former chandlery; new hang monthly.',
    description:
      'Three rooms of mostly local, mostly fearless work, with a sculpture yard out the back. The opening nights — first Friday of the month — are the neighbourhood at its best.',
    address: '5 Norfolk Street', ...at(-0.0006, 0.0024),
    website: 'https://galleryq.example.com', instagram: '@gallery.q', images: ['biz-gallery'],
  },
  {
    id: 'b-cinema', name: 'The Odeon', category: 'Cinema', tier: 'half', section: 'do',
    oneLiner: 'Single screen, red curtains, choc-tops — since 1948.',
    description:
      'A lovingly kept picture palace running new releases, restorations and a Sunday matinee of someone’s favourite film. Arrive early for the organ.',
    address: '60 Pelican Parade', ...at(0.0018, 0.0021),
    phone: '(02) 9301 2236', images: ['biz-cinema'],
  },
  {
    id: 'b-sail', name: 'Windward Sailing', category: 'Sailing', tier: 'quarter', section: 'do',
    oneLiner: 'Twilight sails on a classic gaff cutter, BYO nerve.',
    address: 'Pelican Point Wharf', ...at(-0.0036, -0.0033),
    description: 'Two hours on the harbour with a crew who grew up on it.',
    website: 'https://windward.example.com', images: ['biz-sail'],
  },
  {
    id: 'b-walk', name: 'Headland Loop', category: 'Walk', tier: 'quarter', section: 'do',
    oneLiner: 'Forty minutes of harbour, heath and white cockatoos.',
    address: 'Starts at Pelican Point Reserve', ...at(0.0027, -0.0036),
    description: 'The classic circuit: reserve, clifftop, beach, flat white.',
    images: ['biz-reserve'],
  },
  {
    id: 'b-studio', name: 'Marlowe Studio', category: 'Workshop', tier: 'list', section: 'do',
    oneLiner: 'Drop-in printmaking, Thursdays and Saturdays.',
    address: '3 Fig Tree Lane', ...at(0.0006, 0.0033),
    description: '', images: ['biz-studio'],
  },
  // ---- Shop & Keep -------------------------------------------------------
  {
    id: 'b-mercer', name: 'Mercer & Co', category: 'Homewares', tier: 'half', section: 'shop',
    oneLiner: 'Considered objects for considered homes.',
    description:
      'Ceramics thrown two suburbs away, linen in colours the harbour wears, and a backroom of vintage Danish lighting that rewards a slow look.',
    address: '22 Pelican Parade', ...at(0.001, 0.0004),
    instagram: '@mercerandco', images: ['biz-mercer'],
  },
  {
    id: 'b-pages', name: 'Pages of Pelican', category: 'Bookshop', tier: 'quarter', section: 'shop',
    oneLiner: 'Small, sharp bookshop with a ferocious fiction wall.',
    address: '39 Curlew Street', ...at(0.0013, 0.0017),
    description: 'Staff picks you can trust and a poetry shelf that fights above its weight.',
    images: ['biz-pages'],
  },
  {
    id: 'b-grocer', name: 'The Common Grocer', category: 'Grocer', tier: 'list', section: 'shop',
    oneLiner: 'Local growers’ produce and the point’s best cheese counter.',
    address: '15 Banksia Avenue', ...at(0.0024, 0.001),
    description: '', images: ['biz-grocer'],
  },
  {
    id: 'b-forage', name: 'Forage', category: 'Florist', tier: 'list', section: 'shop',
    oneLiner: 'Natives and sea-heath, bunched while you wait.',
    address: '4 Tern Alley', ...at(-0.0011, -0.0017),
    description: '', images: ['biz-forage'],
  },
];

async function main() {
  const manifest = JSON.parse(
    await readFile(join(HERE, 'images/manifest.json'), 'utf8'),
  ) as Record<string, { width: number; height: number; focal: { x: number; y: number }; luma: { top: number; bottom: number; overall: number } }>;

  const assets = Object.entries(manifest).map(([id, m]) => ({
    id,
    file: `images/${id}.jpg`,
    meta: { id, filename: `${id}.jpg`, ...m },
  }));

  const businesses = BIZ.map(({ tier: _t, section: _s, ...b }) => ({
    ...b,
    suburb: 'Pelican Point',
    qrTarget: b.website,
  }));

  const listings = BIZ.map((b) => ({
    id: `l-${b.id.slice(2)}`,
    businessId: b.id,
    sectionId: b.section,
    tier: b.tier,
  }));

  const edition = {
    id: 'ed-sandling',
    name: 'Pelican Point · No. 1',
    hotel: {
      name: 'The Sandling Hotel',
      wordmark: 'The Sandling',
      tagline: 'Pelican Point, Sydney',
      url: 'thesandling.example.com',
      phone: '(02) 9301 4000',
      address: '1 Marine Parade, Pelican Point',
      brand: { primary: '#1B423B', secondary: '#B65C3F', accent: '#C99B5F' },
      stayEssentials: [
        { label: 'Wi-Fi', value: 'Sandling Guest · no password' },
        { label: 'Breakfast', value: 'Sable, 6.30–10.30 daily' },
        { label: 'Pool Club', value: 'Level 3 · 6am–10pm' },
        { label: 'Front desk', value: 'Dial 9 · staffed all hours' },
        { label: 'Checkout', value: '11am, late by arrangement' },
        { label: 'Parking', value: 'Valet from the Wharf Road door' },
      ],
      welcome: {
        heading: 'It’s good to have you here.',
        intro:
          'The Sandling sits where the point meets the harbour, and this little book is how we share the neighbourhood we love. Everything in it is somewhere we actually go.',
        guideIntro:
          'Numbers beside each place match the pins on the map at the back. Distances are short — almost everything here is a walk.',
      },
      infoBlocks: [
        {
          id: 'ib-pool',
          title: 'The Pool Club',
          kicker: 'Level 3 · 6am–10pm',
          body:
            'Twenty-five metres of warm saltwater above the rooftops, with the harbour for a horizon. Towels, cold things, and shade that moves with the afternoon. Guests only, always quiet.',
          imageId: 'hotel-pool',
        },
        {
          id: 'ib-bistro',
          title: 'Sable, our bistro',
          kicker: 'Ground floor · lunch & dinner',
          body:
            'A short, confident menu built on the same growers and fishers our neighbours use. The bar keeps a Sandling-only vermouth; ask for it over ice with a twist.',
          imageId: 'hotel-bistro',
        },
        {
          id: 'ib-rooms',
          title: 'Your room',
          kicker: 'The small print, kindly',
          body:
            'The windows open — properly. Blackout blinds are behind the sheers, the minibar is stocked from the grocer on Banksia Avenue, and the phone by the bed reaches a person, not a menu.',
          imageId: 'hotel-rooms',
        },
        {
          id: 'ib-lobby',
          title: 'The lobby & beyond',
          kicker: 'Always open',
          body:
            'Papers and strong coffee from six, a record player with the good speakers after dark. Umbrellas, beach towels and bicycles live by the Wharf Road door — take what you need.',
          imageId: 'hotel-lobby',
        },
        {
          id: 'ib-pier',
          title: 'The pier shuttle',
          kicker: 'Hourly · from the wharf',
          body:
            'Our skiff runs guests across to the city side on the hour through the evening. It’s slower than the ferry and better in every other way.',
          imageId: 'hotel-pier',
        },
      ],
      keysNote:
        'Two cards live in this pocket. They open your room, the Pool Club, and the Wharf Road door after dark. Keep the book; we’d love the cards back.',
      heroImageId: 'hotel-hero',
    },
    settings: {
      trimWidthMm: 100,
      trimHeightMm: 200,
      bleedMm: 3,
      baselineGridPt: 11.5,
      iccProfile: 'builtin:guide-cmyk',
      spotColor: { name: 'Sandling Deep', altHex: '#1B423B' },
      inkLimit: 300,
      digitalBaseUrl: 'http://localhost:5170/g/ed-sandling',
      publisher: 'Atelier North',
    },
    sections: [
      { id: 'eat', title: 'Eat & Drink', short: 'Eat' },
      { id: 'do', title: 'Things to Do', short: 'Do' },
      { id: 'shop', title: 'Shop & Keep', short: 'Shop' },
    ],
    listings,
    listingOrder: listings.map((l) => l.id),
    pages: [
      { id: 'p-cover', kind: 'cover' },
      { id: 'p-welcome', kind: 'welcome' },
      { id: 'p-info-1', kind: 'hotel-info', blockIds: ['ib-pool'] },
      { id: 'p-info-2', kind: 'hotel-info', blockIds: ['ib-bistro', 'ib-rooms'] },
      { id: 'p-info-3', kind: 'hotel-info', blockIds: ['ib-lobby', 'ib-pier'] },
      { id: 'p-div-eat', kind: 'divider', sectionId: 'eat' },
      { id: 'p-list-eat', kind: 'listings', sectionId: 'eat' },
      { id: 'p-div-do', kind: 'divider', sectionId: 'do' },
      { id: 'p-list-do', kind: 'listings', sectionId: 'do' },
      { id: 'p-div-shop', kind: 'divider', sectionId: 'shop' },
      { id: 'p-list-shop', kind: 'listings', sectionId: 'shop' },
      { id: 'p-map', kind: 'map', spread: true },
      { id: 'p-keys', kind: 'keys' },
      { id: 'p-back', kind: 'back-cover' },
    ],
    map: {
      bbox: { minLat: -33.8466, minLng: 151.2762, maxLat: -33.8374, maxLng: 151.2878 },
      source: 'fixture:pelican-point',
      tint: 1,
    },
    overrides: [],
    updatedAt: new Date('2026-06-01T00:00:00Z').toISOString(),
  };

  const seed = { businesses, editions: [edition], assets };
  await writeFile(join(HERE, 'seed.json'), JSON.stringify(seed, null, 2));
  console.log(
    `seed.json: ${businesses.length} businesses, ${listings.length} listings, ${assets.length} assets`,
  );
}

main();
