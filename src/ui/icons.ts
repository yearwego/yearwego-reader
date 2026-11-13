const SVG = 'http://www.w3.org/2000/svg';

type Shape = [tag: string, attributes: Record<string, string>];

// Lucide icons (ISC license, lucide.dev), drawn on a 24 × 24 grid with a 2px stroke.
const ICONS = {
  lock: [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  laptop: [
    [
      'path',
      {
        d: 'M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z',
      },
    ],
    ['path', { d: 'M20.054 15.987H3.946' }],
  ],
  upload: [
    ['path', { d: 'M12 3v12' }],
    ['path', { d: 'm17 8-5-5-5 5' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
  ],
  archive: [
    ['path', { d: 'M10 12v-1' }],
    ['path', { d: 'M10 18v-2' }],
    ['path', { d: 'M10 7V6' }],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
    ['path', { d: 'M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01' }],
    ['circle', { cx: '10', cy: '20', r: '2' }],
  ],
  eye: [
    ['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  eyeOff: [
    ['path', { d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' }],
    ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }],
    ['path', { d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' }],
    ['path', { d: 'm2 2 20 20' }],
  ],
  alert: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 8v4' }],
    ['path', { d: 'M12 16h.01' }],
  ],
  warning: [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  spinner: [['path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' }]],
  sprout: [
    ['path', { d: 'M7 20h10' }],
    ['path', { d: 'M10 20c5.5-2.5.8-6.4 3-10' }],
    ['path', { d: 'M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z' }],
    ['path', { d: 'M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z' }],
  ],
  navigation: [['polygon', { points: '3 11 22 2 13 21 11 13 3 11' }]],
  download: [
    ['path', { d: 'M12 15V3' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['path', { d: 'm7 10 5 5 5-5' }],
  ],
  close: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  sun: [
    ['circle', { cx: '12', cy: '12', r: '4' }],
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'M12 20v2' }],
    ['path', { d: 'm4.93 4.93 1.41 1.41' }],
    ['path', { d: 'm17.66 17.66 1.41 1.41' }],
    ['path', { d: 'M2 12h2' }],
    ['path', { d: 'M20 12h2' }],
    ['path', { d: 'm6.34 17.66-1.41 1.41' }],
    ['path', { d: 'm19.07 4.93-1.41 1.41' }],
  ],
  moon: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]],
  monitor: [
    ['rect', { width: '20', height: '14', x: '2', y: '3', rx: '2' }],
    ['line', { x1: '8', x2: '16', y1: '21', y2: '21' }],
    ['line', { x1: '12', x2: '12', y1: '17', y2: '21' }],
  ],
} satisfies Record<string, Shape[]>;

const FILLED = {
  play: [['polygon', { points: '6 3 20 12 6 21 6 3' }]],
  pause: [
    ['rect', { x: '14', y: '4', width: '4', height: '16', rx: '1' }],
    ['rect', { x: '6', y: '4', width: '4', height: '16', rx: '1' }],
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS | keyof typeof FILLED;

function build(viewBox: string, shapes: Shape[], attributes: Record<string, string>): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', viewBox);
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  for (const [tag, shapeAttributes] of shapes) {
    const shape = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(shapeAttributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

/** A decorative icon, hidden from assistive technology. */
export function icon(name: IconName): SVGSVGElement {
  const hidden = { 'aria-hidden': 'true', class: 'icon', focusable: 'false' };
  if (name in FILLED) {
    return build('0 0 24 24', FILLED[name as keyof typeof FILLED], { ...hidden, fill: 'currentColor' });
  }
  return build('0 0 24 24', ICONS[name as keyof typeof ICONS], {
    ...hidden,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
}

// The YearWeGo wordmark, the same artwork as yearwego.com's Logo.astro.
const WORDMARK: Shape[] = [
  [
    'polygon',
    {
      points:
        '15.63 40.69 18.71 40.69 18.71 24.65 34.4 0.63 34.4 0.57 30.79 0.57 17.17 21.66 3.61 0.57 0 0.57 0 0.63 15.63 24.65 15.63 40.69',
    },
  ],
  ['path', { d: 'M94.87,28,105.62,3.56,116.38,28Zm30.44,12.7L107.34.57H104L86,40.69h3.32l4.35-9.84h23.93l4.4,9.84Z' }],
  [
    'path',
    {
      d: 'M156.11,25.35c8.75,0,13-5.73,13-12.27C169,6.82,164.63.57,155.93.57H138.31V3.43h17.62c6.64,0,9.85,4.88,9.79,9.59-.06,5.63-3.15,9.59-10.13,9.59H138.31V40.69h3.09V25.53h10.93l13.85,15.16h4.06Z',
    },
  ],
  [
    'polygon',
    {
      points:
        '198.86 37.25 186.5 0.57 183.24 0.57 197.26 40.81 200.58 40.81 206.99 21.89 212.02 6.13 217.06 22.01 223.41 40.81 226.73 40.81 240.87 0.57 237.55 0.57 225.13 37.25 212.88 0.57 211.16 0.57 198.86 37.25',
    },
  ],
  [
    'path',
    {
      d: 'M327.46,6.07a20.82,20.82,0,0,0-14.65-6c-12.19,0-20.72,8.18-20.66,20.72,0,10.93,7,20.43,20.66,20.43a20.69,20.69,0,0,0,15.11-6.47v-15H311v2.69h14V33.65a18.05,18.05,0,0,1-12.19,4.64c-11.67,0-17.68-8.13-17.68-17.57-.06-9.27,5.95-17.86,17.68-17.86A18.64,18.64,0,0,1,325.69,8Z',
    },
  ],
  [
    'path',
    {
      d: 'M344.64,7.94a22.14,22.14,0,0,0-3.73,12.66c0,10.59,6.76,20.78,20.21,20.78a20,20,0,0,0,12.8-4.16L371.8,35.1a17,17,0,0,1-10.68,3.42C349.73,38.52,344,29.7,344,20.66a19.29,19.29,0,0,1,2.84-10.56ZM361.12,0c-6.35,0-11.19,2.17-14.54,5.59l2.1,2.11c2.86-3,7-4.84,12.44-4.84,11.5,0,17.22,8.53,17.22,17.8A18.87,18.87,0,0,1,374,33l2.12,2.12a21.8,21.8,0,0,0,5.2-14.41C381.38,9.9,374.62,0,361.12,0Z',
    },
  ],
  ['path', { d: 'M47.39,21.92H70.86v-2.8H47.39Zm0,18.77h25.3v-3H47.39Zm0-37.2H72V.57H47.39Z' }],
  ['path', { d: 'M253.86,21.92h23.47v-2.8H253.86Zm0,18.77h25.3v-3h-25.3Zm0-37.2h24.61V.57H253.86Z' }],
];

export function wordmark(): SVGSVGElement {
  return build('0 0 381.32 41.38', WORDMARK, {
    role: 'img',
    'aria-label': 'YearWeGo',
    class: 'wordmark',
    fill: 'currentColor',
  });
}
