// Coğrafi katmanlar -> public/js/maps/tr-layers.js
// Girdi: data/tr-physical.geojson (scripts/extract-physical.mjs) + public/js/maps/tr-layers-info.js
// Kullanım: node scripts/build-layers.mjs   (önce build-map.mjs çalışmış olmalı)
import { readFileSync, writeFileSync } from 'node:fs';
import { PROJ } from '../public/js/maps/tr-geo.js';
import { PROVINCES, NAME_ALIASES } from '../public/js/maps/tr-info.js';
import { FEATURES } from '../public/js/maps/tr-layers-info.js';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const cities = read('../data/tr-cities.geojson');
const physical = read('../data/tr-physical.geojson');
const plateOf = Object.fromEntries(PROVINCES.map(p => [p.name, p.plate]));

const proj = ([lon, lat]) => [PROJ.pad + (lon - PROJ.minLon) * PROJ.cos * PROJ.k, PROJ.pad + (PROJ.maxLat - lat) * PROJ.k];
const polys = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];

function inRing([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// İl poligonları (sınır kutusu ile hızlandırılmış)
const provs = cities.features.map(f => {
  const plate = plateOf[NAME_ALIASES[f.properties.name] || f.properties.name];
  const ps = polys(f.geometry);
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of ps) for (const [x, y] of p[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return { plate, ps, b };
});
function provinceAt(pt) {
  for (const p of provs) {
    if (pt[0] < p.b[0] || pt[0] > p.b[2] || pt[1] < p.b[1] || pt[1] > p.b[3]) continue;
    for (const poly of p.ps) if (inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h))) return p.plate;
  }
  return null;
}
// Sınıra yakınlık (sınır nehirleri için): il köşe noktalarına ızgara araması
const CELL = 0.1, grid = new Map();
for (const p of provs) for (const poly of p.ps) for (const [x, y] of poly[0]) {
  const k = Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
  (grid.get(k) || grid.set(k, []).get(k)).push([x, y]);
}
function nearTurkey([x, y], d = 0.06) {
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
    for (const [px, py] of grid.get((gx + i) + ',' + (gy + j)) || []) if (Math.hypot(px - x, py - y) < d) return true;
  return false;
}

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const f1 = n => +n.toFixed(1);
const pathOf = (pts, close) => 'M' + pts.map(([x, y]) => f1(x) + ' ' + f1(y)).join('L') + (close ? 'Z' : '');

const byFid = new Map();
for (const f of physical.features) (byFid.get(f.properties.fid) || byFid.set(f.properties.fid, []).get(f.properties.fid)).push(f);

const out = {};
const warn = [];
for (const feat of FEATURES) {
  const o = { type: feat.type };
  if (feat.type === 'river') {
    const counts = {};
    let d = '', best = [];
    for (const f of byFid.get(feat.id) || []) for (const line of lines(f.geometry)) {
      // Türkiye dışında kalan kısımları kes
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const pr = dp(run.map(proj), 0.4);
          d += pathOf(pr, false);
          if (run.length > best.length) best = run;
        }
        run = [];
      };
      for (const pt of line) {
        const pl = provinceAt(pt);
        if (pl) counts[pl] = (counts[pl] || 0) + 1;
        if (pl || nearTurkey(pt)) run.push(pt); else flush();
      }
      flush();
    }
    o.d = d;
    o.provinces = Object.entries(counts).filter(([, c]) => c >= 3).map(([p]) => +p);
    const mid = proj(best[Math.floor(best.length / 2)]);
    [o.x, o.y] = mid.map(f1);
    o.lr = 9;
  } else if (feat.type === 'lake') {
    const counts = {};
    let d = '', total = 0, bestA = 0, cx = 0, cy = 0;
    for (const f of byFid.get(feat.id) || []) for (const poly of polys(f.geometry)) {
      const ring = poly[0];
      for (const pt of ring) { const pl = provinceAt(pt) ?? null; if (pl) { counts[pl] = (counts[pl] || 0) + 1; total++; } }
      const pr = ring.map(proj);
      let a = 0, sx = 0, sy = 0;
      for (let i = 0, j = pr.length - 1; i < pr.length; j = i++) {
        const cr = pr[j][0] * pr[i][1] - pr[i][0] * pr[j][1];
        a += cr; sx += (pr[j][0] + pr[i][0]) * cr; sy += (pr[j][1] + pr[i][1]) * cr;
      }
      a /= 2;
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); cx = sx / (6 * a); cy = sy / (6 * a); }
      const s = dp(pr.slice(0, -1), 0.3);
      if (s.length >= 3) d += pathOf(s, true);
    }
    o.d = d;
    // Göl kıyısı noktalarının en az %8'i o ilin içindeyse göl o ile aittir
    o.provinces = Object.entries(counts).filter(([, c]) => c / total >= 0.08).sort((a, b) => b[1] - a[1]).map(([p]) => +p);
    const centerProv = provinceAt([(cx - PROJ.pad) / (PROJ.cos * PROJ.k) + PROJ.minLon, PROJ.maxLat - (cy - PROJ.pad) / PROJ.k]);
    if (centerProv && !o.provinces.includes(centerProv)) o.provinces.unshift(centerProv);
    [o.x, o.y] = [f1(cx), f1(cy)];
    o.lr = +Math.sqrt(bestA).toFixed(1);
  } else {
    [o.x, o.y] = proj([feat.lon, feat.lat]).map(f1);
    const at = provinceAt([feat.lon, feat.lat]);
    o.provinces = feat.provinces || (at ? [at] : []);
    if (feat.type === 'mountain' && at && !o.provinces.includes(at)) warn.push(`${feat.name}: koordinat ${at} ilinde, listede yok`);
    o.lr = feat.type === 'mountain' ? +(4 + feat.elev / 800).toFixed(1) : 12;
  }
  // Kaynak verideki eksiklikler için elle eklenen iller
  for (const p of feat.extraProvinces || []) if (!o.provinces.includes(p)) o.provinces.push(p);
  if (feat.type !== 'sea' && !o.provinces.length) warn.push(`${feat.name}: il bulunamadı`);
  if ((feat.type === 'river' || feat.type === 'lake') && !o.d) warn.push(`${feat.name}: şekil yok`);
  out[feat.id] = o;
}

writeFileSync(new URL('../public/js/maps/tr-layers.js', import.meta.url),
  `// Otomatik üretildi: node scripts/build-layers.mjs\n// Nehir ve göl şekilleri: Natural Earth (public domain)\nexport const LAYER_SHAPES = ${JSON.stringify(out)};\n`);

const name = Object.fromEntries(PROVINCES.map(p => [p.plate, p.name]));
for (const f of FEATURES) console.log(f.name.padEnd(26), (out[f.id].provinces || []).map(p => name[p]).join(', '));
console.log('bayt:', JSON.stringify(out).length);
if (warn.length) console.log('UYARI:\n' + warn.join('\n'));
