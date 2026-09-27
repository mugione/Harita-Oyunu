// Natural Earth (public domain) verisinden Türkiye'nin nehir ve göllerini ayıklar -> data/tr-physical.geojson
// Ham dosyalar depoda tutulmaz. İndirmek için:
//   B=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
//   for f in ne_10m_rivers_lake_centerlines ne_10m_rivers_europe ne_10m_lakes ne_10m_lakes_europe; do curl -sLO $B/$f.geojson; done
// Kullanım: node scripts/extract-physical.mjs <ham-dosyaların-klasörü>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('Kullanım: node scripts/extract-physical.mjs <klasör>'); process.exit(1); }

// Natural Earth adı (düzenli ifade) -> katman kimliği
const RIVERS = {
  kizilirmak: /^K(ı|i|\?)z(ı|i|\?)l(ı|i)rmak$/i,
  firat: /^F(ı|i)rat$/i,
  sakarya: /^Sakarya$/,
  murat: /^Murat$/,
  seyhan: /^Seyhan$/,
  buyukmenderes: /^(B.?y.?k|Byk) Menderes$/,
  dicle: /^(Dicle|Tigris)$/,
  yesilirmak: /^Ye(ş|s)il(ı|i)rmak$/,
  ceyhan: /^Ceyhan$/,
  coruh: /^(Ç|C)oruh$/,
  gediz: /^Gediz$/,
  aras: /^Aras$/,
  meric: /^(Evros|Maritsa|Meriç)$/,
};
const LAKES = {
  van: /^Lake Van$/, tuz: /^Lake Tuz$/, ataturk: /^Ataturk Baraj/, keban: /^Keban Baraj/,
  beysehir: /^Beyşehir$/, egirdir: /^Eğirdir$/, aksehir: /^Akşehir Gölü$/, iznik: /^İznik Gölü$/,
  burdur: /^Burdur Gölü$/, kus: /^Kuş Gölü$/, uluabat: /^Ulubat Gölü$/, cildir: /^Çıldır$/,
  hazar: /^Hazar Da/, sapanca: /^Sapanca Gölü$/, salda: /^Salda Gölü$/, bafa: /^Bafa Gölü$/,
  koycegiz: /^K.?yceiz Gölü$/,
};

const inBox = ([x, y]) => x > 25.3 && x < 45.2 && y > 35.6 && y < 42.4;
const out = [];
const found = new Set();
function take(file, table) {
  const d = JSON.parse(readFileSync(join(dir, file + '.geojson')));
  for (const f of d.features) {
    const name = f.properties.name || '';
    const fid = Object.keys(table).find(k => table[k].test(name));
    if (!fid) continue;
    const flat = JSON.stringify(f.geometry.coordinates).match(/-?\d+\.?\d*,-?\d+\.?\d*/g) || [];
    if (!flat.some(s => inBox(s.split(',').map(Number)))) continue;
    found.add(fid);
    out.push({ type: 'Feature', properties: { fid, source: file }, geometry: f.geometry });
  }
}
take('ne_10m_rivers_lake_centerlines', RIVERS);
take('ne_10m_rivers_europe', RIVERS);
take('ne_10m_lakes', LAKES);
take('ne_10m_lakes_europe', LAKES);

const missing = [...Object.keys(RIVERS), ...Object.keys(LAKES)].filter(k => !found.has(k));
writeFileSync(new URL('../data/tr-physical.geojson', import.meta.url), JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log('özellik:', out.length, 'eksik:', missing.join(', ') || 'yok');
