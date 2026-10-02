// Natural Earth ülke sınırları -> SVG path verisi (public/js/maps/world-geo.js)
// Kullanım: node scripts/build-world.mjs
// Kaynak: data/ne_50m_admin_0_countries.geojson (Natural Earth, public domain)
import { readFileSync, writeFileSync } from 'node:fs';
import { COUNTRIES } from '../public/js/maps/world-info.js';

const geo = JSON.parse(readFileSync(new URL('../data/ne_50m_admin_0_countries.geojson', import.meta.url)));
const byIso = Object.fromEntries(COUNTRIES.map(c => [c.iso, c]));
const dn = new Intl.DisplayNames('tr', { type: 'region' });

const WIDTH = 1000;
const PAD = 10;
const TOLERANCE = 0.16; // harita birimi, Douglas-Peucker
const MIN_AREA = 0.2;   // harita birimi², bundan küçük adacıkları at (ülkenin en büyük parçası hep kalır)
const TINY_LR = 1.3;    // etiket yarıçapı bundan küçük ülkelere dokunma noktası eklenir
const CLUSTER_GAP = 25; // ana parçaya bu kadar yakın parçalar odak kutusuna ve komşuluk hesabına girer

// Bir ülkenin parçası sayılan bölgeler (ayrı çizilmez, ülkeyle birlikte boyanır)
const MERGE = { SOL: 'SOM', ALD: 'FIN', HKG: 'CHN', MAC: 'CHN' };
// Ülke olmayan, gri çizilen bölgelerin adları (Intl'de karşılığı olmayanlar)
const BACK_NAME = { IOA: 'Hint Okyanusu Toprakları', ATC: 'Ashmore ve Cartier Adaları', KAS: 'Siachen Buzulu', ATA: 'Antarktika' };
const BACK_NOTE = { ATA: 'Hiçbir ülkeye ait değildir; bilim insanları araştırma için gider.', KAS: 'Hindistan ile Pakistan arasında tartışmalı bir bölgedir.' };

// Kıta odak kutuları [batı, güney, doğu, kuzey] (Pasifik adaları 180°'nin doğusuna taşındığı için Okyanusya 215°'ye uzanır)
const REGION_BOX = {
  avrupa: [-25, 34, 45, 71], asya: [25, -11, 148, 56], afrika: [-26, -36, 58, 38],
  kamerika: [-170, 7, -52, 72], gamerika: [-82, -56, -34, 13], okyanusya: [110, -48, 212, 16],
};

// ---- Equal Earth izdüşümü (alanları korur, kıtalar doğal görünür)
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function ee(lon, lat) {
  const l = lon * Math.PI / 180, t = Math.asin(M * Math.sin(lat * Math.PI / 180));
  const t2 = t * t, t6 = t2 * t2 * t2;
  return [l * Math.cos(t) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))), -t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
}

const polys = f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
const ringArea = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return s / 2; };
const centroidLon = ring => ring.reduce((s, p) => s + p[0], 0) / ring.length;
function sphericalArea(ring) {
  const R = 6371.0088, rad = Math.PI / 180;
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, p1] = ring[i], [l2, p2] = ring[i + 1];
    s += (l2 - l1) * rad * (2 + Math.sin(p1 * rad) + Math.sin(p2 * rad));
  }
  return Math.abs(s * R * R / 2);
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
// Etiket noktası: poligonun içinde kenarlara en uzak nokta (kaba ızgara + ince arama)
function labelPoint(ring) {
  let [x0, y0, x1, y1] = bbox(ring);
  const dist = p => { let d = Infinity; for (let m = 0, n = ring.length - 1; m < ring.length; n = m++) d = Math.min(d, segDist(p, ring[n], ring[m])); return d; };
  let best = null, bestD = -1;
  for (let pass = 0, N = 30; pass < 2; pass++) {
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const p = [x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N];
      if (!inside(p, ring)) continue;
      const d = dist(p);
      if (d > bestD) { bestD = d; best = p; }
    }
    if (!best) break;
    const w = (x1 - x0) / N * 2, h = (y1 - y0) / N * 2;
    [x0, y0, x1, y1] = [best[0] - w, best[1] - h, best[0] + w, best[1] + h];
  }
  if (!best) { const b = bbox(ring); return { pt: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], r: 0.3 }; }
  return { pt: best, r: bestD };
}
function chord(ring, x, y) {
  const xs = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  // Ad noktaya ortalanarak yazıldığı için iki yandaki en dar boşluğun iki katı alınır
  for (let i = 0; i + 1 < xs.length; i += 2) if (x >= xs[i] && x <= xs[i + 1]) return 2 * Math.min(x - xs[i], xs[i + 1] - x);
  return 0;
}
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
const gap = (a, b) => Math.max(Math.max(a[0], b[0]) - Math.min(a[2], b[2]), Math.max(a[1], b[1]) - Math.min(a[3], b[3]), 0);
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

// ---- 1) Her ülkenin ve gri bölgenin poligonlarını topla
const owners = new Map(); // key -> { id, kind, polys: [[ring...]], name?, oceania }
for (const f of geo.features) {
  const p = f.properties, a3 = MERGE[p.ADM0_A3] || p.ADM0_A3;
  const country = byIso[a3];
  const key = country ? 'c' + country.id : 'b' + a3;
  if (!owners.has(key)) {
    let name = null;
    if (!country) {
      const base = BACK_NAME[a3] || (p.ISO_A2_EH !== '-99' ? dn.of(p.ISO_A2_EH) : p.ADMIN);
      const sov = COUNTRIES.find(c => c.iso === geo.features.find(g => g.properties.ADMIN === p.SOVEREIGNT)?.properties.ADM0_A3);
      name = { name: base, note: BACK_NOTE[a3] || (sov ? `Bir ülke değildir; bağlı olduğu ülke: ${sov.name}` : 'Bir ülke değildir.') };
    }
    owners.set(key, { key, id: country?.id, a3, country, polys: [], ...name, oceania: (country?.region || '') === 'okyanusya' || p.REGION_UN === 'Oceania' });
  }
  owners.get(key).polys.push(...polys(f));
}

// ---- 2) 180. boylamı aşan parçaları ülkenin ana parçasının yanına taşı (Rusya'nın doğusu, Fiji, Pasifik adaları)
for (const o of owners.values()) {
  if (o.a3 === 'ATA') continue;
  const largest = o.polys.reduce((a, b) => Math.abs(ringArea(b[0])) > Math.abs(ringArea(a[0])) ? b : a);
  let home = centroidLon(largest[0]);
  if (o.oceania && home < 0) home += 360;
  o.polys = o.polys.map(poly => {
    let c = centroidLon(poly[0]), shift = 0;
    while (c + shift - home > 180) shift -= 360;
    while (c + shift - home < -180) shift += 360;
    return shift ? poly.map(r => r.map(([lon, lat]) => [lon + shift, lat])) : poly;
  });
}

// ---- 3) İzdüşüm ve ölçek
let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
for (const o of owners.values()) for (const poly of o.polys) for (const [lon, lat] of poly[0]) {
  const [x, y] = ee(lon, lat);
  mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); my0 = Math.min(my0, y); my1 = Math.max(my1, y);
}
const k = (WIDTH - 2 * PAD) / (mx1 - mx0);
const HEIGHT = Math.ceil((my1 - my0) * k + 2 * PAD);
const proj = ([lon, lat]) => { const [x, y] = ee(lon, lat); return [PAD + (x - mx0) * k, PAD + (y - my0) * k]; };

// ---- 4) Şekiller
const SHAPES = {}, BACKDROP = [], cluster = new Map();
for (const o of owners.values()) {
  const parts = o.polys.map(poly => ({ poly, pr: poly.map(r => r.map(proj)) }));
  parts.forEach(p => { p.a = Math.abs(ringArea(p.pr[0])); p.bb = bbox(p.pr[0]); });
  parts.sort((a, b) => b.a - a.a);
  const main = parts[0];
  const prec = main.a < 4 ? 2 : 1;
  let d = '';
  for (const [pi, part] of parts.entries()) {
    part.pr.forEach((pr, ri) => {
      if (part.a < MIN_AREA && pi > 0) return;
      if (ri > 0 && Math.abs(ringArea(pr)) < MIN_AREA) return;
      const mid = Math.floor(pr.length / 2);
      let s = [...dp(pr.slice(0, mid + 1), TOLERANCE).slice(0, -1), ...dp(pr.slice(mid), TOLERANCE)];
      if (s.length < 4) s = pr;
      if (s.length < 4) return;
      d += 'M' + s.slice(0, -1).map(([x, y]) => x.toFixed(prec) + ' ' + y.toFixed(prec)).join('L') + 'Z';
      if (pi === 0 && ri === 0) main.simple = s;
    });
  }
  if (!o.country) { BACKDROP.push({ id: o.a3, d, name: o.name, note: o.note }); continue; }

  // Ana parçaya yakın parçalar (ör. Kaliningrad Rusya'ya dahil, Fransız Guyanası değil)
  let bb = main.bb;
  const inCluster = new Set([main]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of parts) if (!inCluster.has(p) && p.a >= MIN_AREA && gap(bb, p.bb) < CLUSTER_GAP) { inCluster.add(p); bb = union(bb, p.bb); grew = true; }
  }
  cluster.set(o.id, [...inCluster].map(p => p.poly));

  let area = 0;
  for (const poly of o.polys) area += sphericalArea(poly[0]) - poly.slice(1).reduce((s, r) => s + sphericalArea(r), 0);
  const ring = main.simple || main.pr[0];
  const lp = labelPoint(ring);
  const cw = Math.min(...[-0.35, 0, 0.35].map(t => chord(ring, lp.pt[0], lp.pt[1] + t * lp.r))) || lp.r * 2;
  SHAPES[o.id] = {
    d, cx: +lp.pt[0].toFixed(2), cy: +lp.pt[1].toFixed(2), lr: +lp.r.toFixed(2), cw: +cw.toFixed(2),
    area: area > 1000 ? Math.round(area / 100) * 100 : Math.max(1, Math.round(area)),
    bb: [bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]].map(v => +v.toFixed(1)),
    neighbors: new Set(), ...(lp.r < TINY_LR ? { tiny: 1 } : {}),
  };
}

// ---- 5) Komşuluk: iki ülkenin sınır noktaları çok yakınsa komşudur (yalnızca ana parçalar)
const CELL = 0.05, NEAR = 0.02;
const grid = new Map();
for (const [id, list] of cluster) for (const poly of list) for (const ring of poly) for (const [lon, lat] of ring) {
  const key = Math.floor(lon / CELL) + ',' + Math.floor(lat / CELL);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push([lon, lat, id]);
}
const pairCount = new Map();
for (const [key, pts] of grid) {
  const [gx, gy] = key.split(',').map(Number);
  const near = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.push(...(grid.get((gx + dx) + ',' + (gy + dy)) || []));
  for (const [lon, lat, id] of pts) {
    const seen = new Set();
    for (const [lo2, la2, id2] of near) {
      if (id2 === id || seen.has(id2) || Math.hypot(lon - lo2, lat - la2) >= NEAR) continue;
      seen.add(id2);
      const k2 = Math.min(id, id2) + '-' + Math.max(id, id2);
      pairCount.set(k2, (pairCount.get(k2) || 0) + 1);
    }
  }
}
for (const [key, c] of pairCount) {
  if (c < 2) continue;
  const [a, b] = key.split('-').map(Number);
  SHAPES[a].neighbors.add(b); SHAPES[b].neighbors.add(a);
}
for (const s of Object.values(SHAPES)) s.neighbors = [...s.neighbors].sort((a, b) => a - b);

// ---- 6) Kıta odak kutuları (harita birimi)
const REGION_BB = {};
for (const [id, [w, s, e, n]] of Object.entries(REGION_BOX)) {
  const pts = [];
  for (let i = 0; i <= 20; i++) { const lon = w + (e - w) * i / 20, lat = s + (n - s) * i / 20; pts.push(proj([lon, s]), proj([lon, n]), proj([w, lat]), proj([e, lat])); }
  const b = bbox(pts);
  REGION_BB[id] = [b[0], b[1], b[2] - b[0], b[3] - b[1]].map(v => +v.toFixed(1));
}

writeFileSync(new URL('../public/js/maps/world-geo.js', import.meta.url),
  `// Otomatik üretildi: node scripts/build-world.mjs\n// Ülke sınırları: Natural Earth (public domain), Equal Earth izdüşümü\n` +
  `export const VIEWBOX = [0, 0, ${WIDTH}, ${HEIGHT}];\nexport const SHAPES = ${JSON.stringify(SHAPES)};\n` +
  `export const BACKDROP = ${JSON.stringify(BACKDROP)};\nexport const REGION_BB = ${JSON.stringify(REGION_BB)};\n`);

const name = id => COUNTRIES.find(c => c.id === +id).name;
console.log('viewBox', WIDTH, HEIGHT, 'bytes', JSON.stringify(SHAPES).length + JSON.stringify(BACKDROP).length);
console.log('küçük ülkeler', Object.entries(SHAPES).filter(([, s]) => s.tiny).length + ':', Object.entries(SHAPES).filter(([, s]) => s.tiny).map(([id]) => name(id)).join(', '));
console.log('komşusuz', Object.entries(SHAPES).filter(([, s]) => !s.neighbors.length).length);
for (const iso of ['TUR', 'FRA', 'RUS', 'CHN', 'USA', 'ESP', 'CYN', 'BRA', 'DEU', 'ISR', 'KOS'])
  console.log(iso, SHAPES[byIso[iso].id].neighbors.map(name).join(', '));
