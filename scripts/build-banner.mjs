// README kapak görseli (docs/banner.svg) üretir: node scripts/build-banner.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { VIEWBOX, SHAPES } from '../public/js/maps/tr-geo.js';

const RAINBOW = ['#FF6B6B', '#FFB020', '#3DBE6E', '#4F8CFF', '#A66CFF', '#FF5CA8', '#22C1C3', '#F57C3A'];
const ids = Object.keys(SHAPES).map(Number).sort((a, b) => SHAPES[b].neighbors.length - SHAPES[a].neighbors.length);
const color = new Map();
for (const id of ids) {
  const used = new Set(SHAPES[id].neighbors.map(n => color.get(n)));
  const free = RAINBOW.map((_, i) => i).filter(i => !used.has(i));
  color.set(id, free[(id * 7) % free.length] ?? 0);
}

const W = 1280, H = 640;
const mapW = 920, k = mapW / VIEWBOX[2], mapX = (W - mapW) / 2, mapY = 232;
const paths = ids.map(id => `<path d="${SHAPES[id].d}" fill="${RAINBOW[color.get(id)]}"/>`).join('');
const pins = [[34, '34'], [6, '06'], [35, '35'], [65, '65'], [61, '61'], [7, '07'], [21, '21']]
  .map(([id, code]) => {
    const s = SHAPES[id];
    return `<g transform="translate(${s.cx} ${s.cy})"><rect x="-17" y="-11" width="34" height="22" rx="4" fill="#fff" stroke="#10204a" stroke-width="2"/><rect x="-17" y="-11" width="8" height="22" rx="3" fill="#1E4FD8"/><text x="4" y="1" font-size="14" font-weight="800" fill="#10204a" text-anchor="middle" dominant-baseline="central">${code}</text></g>`;
  }).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Baloo 2','Nunito','Segoe UI',system-ui,sans-serif">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A3FD6"/><stop offset=".55" stop-color="#5B4BFF"/><stop offset="1" stop-color="#B14BFF"/></linearGradient>
    <linearGradient id="title" x1="0" x2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#FFE27A"/></linearGradient>
    <filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#0b1040" flood-opacity=".45"/></filter>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#fff" opacity=".12"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" rx="36" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" rx="36" fill="url(#dots)"/>
  <circle cx="1150" cy="90" r="160" fill="#fff" opacity=".07"/>
  <circle cx="110" cy="600" r="200" fill="#fff" opacity=".06"/>
  <g transform="translate(${W / 2 - 330} 38)">
    <rect width="96" height="96" rx="26" fill="#fff" opacity=".16"/>
    <circle cx="48" cy="48" r="34" fill="#fff"/><circle cx="48" cy="48" r="34" fill="none" stroke="#FFD400" stroke-width="5"/>
    <path d="M48 20 L56 48 L40 48 Z" fill="#FF5C5C"/><path d="M48 76 L40 48 L56 48 Z" fill="#3B5BFD"/>
    <circle cx="48" cy="48" r="5" fill="#1B2559"/>
  </g>
  <text x="${W / 2 + 60}" y="118" text-anchor="middle" font-size="92" font-weight="800" fill="url(#title)" letter-spacing="1">Harita Kaşifi</text>
  <text x="${W / 2}" y="190" text-anchor="middle" font-size="32" font-weight="700" fill="#E7E9FF">Oyna · Keşfet · Öğren — 81 ili eğlenerek tanı!</text>
  <g transform="translate(${mapX} ${mapY}) scale(${k})" filter="url(#sh)">
    <g stroke="#fff" stroke-width="${(1.4 / k).toFixed(2)}" stroke-linejoin="round">${paths}</g>
    ${pins}
  </g>
</svg>
`;
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/banner.svg', import.meta.url), svg);
console.log('docs/banner.svg', svg.length, 'bytes');
