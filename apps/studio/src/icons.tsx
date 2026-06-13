/** Minimal stroke icon set — 1.5px, currentColor, 16px grid. */
import type { CSSProperties } from 'react';

const P = ({ d }: { d: string }) => <path d={d} />;

const PATHS: Record<string, JSX.Element> = {
  plus: <P d="M8 3.2v9.6M3.2 8h9.6" />,
  back: <P d="M10 3.5 5.5 8l4.5 4.5" />,
  chevron: <P d="M6 4l4 4-4 4" />,
  chevronDown: <P d="M4 6l4 4 4-4" />,
  page: <rect x="4" y="2.5" width="8" height="11" rx="1.2" />,
  spread: <><rect x="1.5" y="3" width="6" height="10" rx="1" /><rect x="8.5" y="3" width="6" height="10" rx="1" /></>,
  zoomIn: <><circle cx="7" cy="7" r="4.2" /><P d="M10.2 10.2 14 14M7 5.2v3.6M5.2 7h3.6" /></>,
  zoomOut: <><circle cx="7" cy="7" r="4.2" /><P d="M10.2 10.2 14 14M5.2 7h3.6" /></>,
  bleed: <><rect x="2.5" y="2.5" width="11" height="11" rx="1" strokeDasharray="2 1.6" /><rect x="4.8" y="4.8" width="6.4" height="6.4" rx="0.6" /></>,
  download: <P d="M8 2.5v7.5M5 7l3 3 3-3M3.5 13h9" />,
  check: <P d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  alert: <><P d="M8 2.6 14.5 13.4H1.5z" /><P d="M8 6.5v3.2M8 11.3v.2" /></>,
  info: <><circle cx="8" cy="8" r="5.6" /><P d="M8 7.2v3.4M8 5.3v.2" /></>,
  x: <P d="M4 4l8 8M12 4l-8 8" />,
  drag: <><circle cx="6" cy="4" r="0.9" fill="currentColor" stroke="none" /><circle cx="10" cy="4" r="0.9" fill="currentColor" stroke="none" /><circle cx="6" cy="8" r="0.9" fill="currentColor" stroke="none" /><circle cx="10" cy="8" r="0.9" fill="currentColor" stroke="none" /><circle cx="6" cy="12" r="0.9" fill="currentColor" stroke="none" /><circle cx="10" cy="12" r="0.9" fill="currentColor" stroke="none" /></>,
  eye: <><P d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.8" /></>,
  eyeOff: <P d="M3 3l10 10M6.3 6.4A1.8 1.8 0 0 0 8 9.8M2 8s2.5-4.5 6-4.5c1 0 1.9.3 2.7.8M13.6 9.4c.6-.7.9-1.4.9-1.4S12 3.5 8 3.5" />,
  trash: <P d="M3.5 4.5h9M6 4.5V3.2h4v1.3M4.6 4.5l.6 8.3h5.6l.6-8.3" />,
  map: <P d="M5.8 3 2.5 4.3v8.7L5.8 11.7l4.4 1.3 3.3-1.3V3l-3.3 1.3L5.8 3zM5.8 3v8.7M10.2 4.3V13" />,
  cover: <><rect x="3.5" y="2.5" width="9" height="11" rx="1" /><P d="M6 6.5h4M7 9h2" /></>,
  list: <P d="M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.6 4.5h.01M2.6 8h.01M2.6 11.5h.01" />,
  layout: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.2" /><P d="M2.5 6.5h11M6.5 6.5v7" /></>,
  type: <P d="M3.5 4.5V3.4h9v1.1M8 3.6v9M6.2 12.6h3.6" />,
  image: <><rect x="2.5" y="3" width="11" height="10" rx="1.2" /><circle cx="6" cy="6.4" r="1.1" /><P d="M3 11.5 6.4 8.5l2.3 2 2-1.7 2.8 2.7" /></>,
  divider: <P d="M2.5 8h11M8 3v10" />,
  key: <><circle cx="5" cy="8" r="2.6" /><P d="M7.4 7.4h6M11.5 7.4v2.2M13 7.4v1.6" /></>,
  welcome: <P d="M2.6 5.2 8 9l5.4-3.8M2.6 5.2h10.8v6H2.6z" />,
  sparkle: <P d="M8 2.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z" />,
  logo: <><circle cx="8" cy="8" r="6" /><P d="M8 2.2c2.2 2.4 2.2 9.2 0 11.6M8 2.2C5.8 4.6 5.8 11.4 8 13.8M2.4 6.4h11.2M2.4 9.6h11.2" /></>,
};

export function Icon({ name, size = 16, style, strokeWidth = 1.5 }: { name: keyof typeof PATHS | string; size?: number; style?: CSSProperties; strokeWidth?: number }) {
  const node = PATHS[name] ?? PATHS.info;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={style} aria-hidden>
      {node}
    </svg>
  );
}
