// GeoJSON -> SVG path verisi (public/js/maps/tr-geo.js)
// Kullanım: node scripts/build-map.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { PROVINCES, NAME_ALIASES } from '../public/js/maps/tr-info.js';

const geo = JSON.parse(readFileSync(new URL('../data/tr-cities.geojson', import.meta.url)));
const byName = Object.fromEntries(PROVINCES.map(p => [p.name, p]));

const WIDTH = 1000;
const PAD = 10;
const LAT0 = 39 * Math.PI / 180;
const TOLERANCE = 0.35; // px, Douglas-Peucker
const MIN_AREA = 4;     // px², bundan küçük adacıkları at

// Sınırlar
let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const f of geo.features) for (const poly of polys(f)) for (const ring of poly) for (const [lon, lat] of ring) {
  minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
}
const k = (WIDTH - 2 * PAD) / ((maxLon - minLon) * Math.cos(LAT0));
const HEIGHT = Math.ceil((maxLat - minLat) * k + 2 * PAD);
const proj = ([lon, lat]) => [PAD + (lon - minLon) * Math.cos(LAT0) * k, PAD + (maxLat - lat) * k];

function polys(f) {
  return f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
}

function dp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };

// Küresel alan (km²)
function sphericalArea(ring) {
  const R = 6371.0088, rad = Math.PI / 180;
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, p1] = ring[i], [l2, p2] = ring[i + 1];
    s += (l2 - l1) * rad * (2 + Math.sin(p1 * rad) + Math.sin(p2 * rad));
  }
  return Math.abs(s * R * R / 2);
}

function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
// Etiket noktası: poligonun içinde kenarlara en uzak nokta (kaba ızgara araması)
function labelPoint(ring) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let best = null, bestD = -1;
  const N = 40;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const p = [x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N];
    if (!inside(p, ring)) continue;
    let d = Infinity;
    for (let m = 0, n = ring.length - 1; m < ring.length; n = m++) d = Math.min(d, segDist(p, ring[n], ring[m]));
    if (d > bestD) { bestD = d; best = p; }
  }
  return { pt: best || [(x0 + x1) / 2, (y0 + y1) / 2], r: bestD };
}

const out = {};
const pointOwners = new Map();

for (const f of geo.features) {
  const name = NAME_ALIASES[f.properties.name] || f.properties.name;
  const info = byName[name];
  if (!info) throw new Error('Bilinmeyen il: ' + name);
  const id = info.plate;

  let d = '', area = 0, largest = null, largestA = 0;
  for (const poly of polys(f)) {
    area += sphericalArea(poly[0]) - poly.slice(1).reduce((s, r) => s + sphericalArea(r), 0);
    poly.forEach(ring => ring.forEach(([lon, lat]) => {
      const key = lon.toFixed(3) + ',' + lat.toFixed(3);
      if (!pointOwners.has(key)) pointOwners.set(key, new Set());
      pointOwners.get(key).add(id);
    }));
    poly.forEach((ring, ri) => {
      const pr = ring.map(proj);
      const a = Math.abs(ringArea(pr));
      if (a < MIN_AREA) return;
      if (ri === 0 && a > largestA) { largestA = a; largest = pr; }
      // Kapalı halkayı ikiye bölerek sadeleştir (ilk nokta = son nokta)
      const mid = Math.floor(pr.length / 2);
      const s = [...dp(pr.slice(0, mid + 1), TOLERANCE).slice(0, -1), ...dp(pr.slice(mid), TOLERANCE)];
      if (s.length < 4) return;
      d += 'M' + s.slice(0, -1).map(([x, y]) => x.toFixed(1) + ' ' + y.toFixed(1)).join('L') + 'Z';
    });
  }
  const lp = labelPoint(largest);
  out[id] = { d, cx: +lp.pt[0].toFixed(1), cy: +lp.pt[1].toFixed(1), lr: +lp.r.toFixed(1), area: Math.round(area / 10) * 10, neighbors: new Set() };
}

// Komşuluk: iki ilin sınır noktaları birbirine çok yakınsa (≈1,5 km) komşudur.
// Kaynak veride ortak sınırların köşe noktaları her zaman birebir örtüşmediği için mesafe kullanılır.
const CELL = 0.04, NEAR = 0.03;
const grid = new Map();
for (const f of geo.features) {
  const id = byName[NAME_ALIASES[f.properties.name] || f.properties.name].plate;
  for (const poly of polys(f)) for (const ring of poly) for (const [lon, lat] of ring) {
    const key = Math.floor(lon / CELL) + ',' + Math.floor(lat / CELL);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([lon, lat, id]);
  }
}
const pairCount = new Map();
for (const [key, pts] of grid) {
  const [gx, gy] = key.split(',').map(Number);
  const near = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.push(...(grid.get((gx + dx) + ',' + (gy + dy)) || []));
  for (const [lon, lat, id] of pts) {
    const seen = new Set();
    for (const [lo2, la2, id2] of near) {
      if (id2 === id || seen.has(id2)) continue;
      if (Math.hypot(lon - lo2, lat - la2) < NEAR) {
        seen.add(id2);
        const k2 = Math.min(id, id2) + '-' + Math.max(id, id2);
        pairCount.set(k2, (pairCount.get(k2) || 0) + 1);
      }
    }
  }
}
for (const [key, c] of pairCount) {
  if (c < 6) continue;
  const [a, b] = key.split('-').map(Number);
  out[a].neighbors.add(b); out[b].neighbors.add(a);
}
// Kaynak verideki küçük boşluklar nedeniyle yakalanamayan bilinen komşuluklar
const EXTRA_NEIGHBORS = [[77, 41]]; // Yalova – Kocaeli
for (const [a, b] of EXTRA_NEIGHBORS) { out[a].neighbors.add(b); out[b].neighbors.add(a); }

const result = {};
for (const [id, v] of Object.entries(out)) result[id] = { ...v, neighbors: [...v.neighbors].sort((a, b) => a - b) };

writeFileSync(new URL('../public/js/maps/tr-geo.js', import.meta.url),
  `// Otomatik üretildi: node scripts/build-map.mjs\nexport const VIEWBOX = [0, 0, ${WIDTH}, ${HEIGHT}];\n// Boylam/enlem -> harita koordinatı: x = pad + (lon - minLon) * cos * k, y = pad + (maxLat - lat) * k\nexport const PROJ = ${JSON.stringify({ minLon, maxLat, cos: Math.cos(LAT0), k, pad: PAD })};\nexport const SHAPES = ${JSON.stringify(result)};\n`);

const sizes = Object.entries(result).sort((a, b) => b[1].area - a[1].area);
console.log('viewBox', WIDTH, HEIGHT, 'bytes', JSON.stringify(result).length);
console.log('en büyük', sizes.slice(0, 3).map(([id, v]) => id + ':' + v.area));
console.log('en küçük', sizes.slice(-3).map(([id, v]) => id + ':' + v.area));
console.log('komşusuz', Object.entries(result).filter(([, v]) => !v.neighbors.length).map(([id]) => id));
for (const id of [6, 34, 42, 16, 65, 44]) console.log(id, result[id].neighbors.join(','));
const total = Object.values(result).reduce((s, v) => s + v.neighbors.length, 0) / 2;
console.log('toplam komşuluk', total);
