import { MAPS } from './maps/index.js';
import { MapView } from './map-view.js';
import { sfx, voice } from './sound.js';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, html = '') => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = n => n.toLocaleString('tr-TR');

// ---------------------------------------------------------------- kalıcı durum
const STORE_KEY = 'harita-kasifi-v1';
const DEFAULTS = {
  settings: { infoExplore: true, infoQuiz: false, voice: true, sfx: true, colors: 'rainbow', level: 'normal', roundLen: '10', region: 'all', map: 'tr', layers: ['mountain', 'lake', 'river', 'sea'] },
  progress: {},
};
let store;
try { store = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { store = structuredClone(DEFAULTS); }
store.settings = { ...DEFAULTS.settings, ...store.settings };
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} };
const prog = () => (store.progress[store.settings.map] ||= { discovered: [], mastery: {}, best: {}, stars: 0, played: 0 });

// ---------------------------------------------------------------- modlar
const MODES = [
  { id: 'explore',   icon: '🔍', title: 'Keşfet',        desc: 'İllere dokun, adını duy, bilgi kartını oku.', color: '#3DBE6E' },
  { id: 'names',     icon: '🏷️', title: 'İsimli Harita',  desc: 'Bütün il adları haritada; dokun, bilgisini oku.', color: '#FF8A3D' },
  { id: 'find',      icon: '🎯', title: 'İli Bul',        desc: 'Söylenen ili haritada bul.',                  color: '#4F8CFF' },
  { id: 'identify',  icon: '❓', title: 'Bu Hangi İl?',   desc: 'Parlayan ilin adını seç.',                    color: '#A66CFF' },
  { id: 'plate',     icon: '🚗', title: 'Plaka Avı',      desc: 'Plaka numarasından ili bul.',                 color: '#FF8A3D', needs: 'codeLabel' },
  { id: 'neighbors', icon: '🤝', title: 'Komşular',       desc: 'Bir ilin bütün komşularını bul.',             color: '#22C1C3' },
  { id: 'nature',    icon: '🏞️', title: 'Doğa Avı',       desc: 'Dağları, gölleri ve nehirleri tanı.',         color: '#2BA84A', needs: 'features' },
  { id: 'atlas',     icon: '🧺', title: 'Zenginlikler Atlası', desc: 'Madenler, tarım ürünleri, bitki örtüsü nerede?', color: '#E0A020', needs: 'resources' },
  { id: 'resources', icon: '⛏️', title: 'Kaynak Avı',     desc: 'Hangi ürün nerede yetişir, maden nerede çıkar?', color: '#C0622B', needs: 'resources' },
  { id: 'mines',     icon: '💎', title: 'Kaynak Oyunu',   desc: 'Maden nerede çıkarılır? Şıklardan ili seç.',  color: '#8E5CF7', needs: 'resources' },
  { id: 'timed',     icon: '⏱️', title: 'Zamana Karşı',   desc: '60 saniyede kaç il bulabilirsin?',            color: '#FF5C8A' },
];
const LEVEL_HELP = {
  easy: 'Kolay: 1 yanlıştan sonra bölge, 2 yanlıştan sonra doğru il gösterilir. 3 seçenek.',
  normal: 'Normal: 2 yanlıştan sonra bölge, 3 yanlıştan sonra doğru il gösterilir. 4 seçenek.',
  hard: 'Zor: Otomatik ipucu yok, harita renksiz başlar, seçenekler komşu illerden gelir.',
};
const CAT_COLORS = { maden: '#8E5CF7', enerji: '#FF7A1A', tarim: '#2EAA4A', hayvan: '#1E9BE0' };
const RAINBOW = ['#FF6B6B', '#FFB020', '#3DBE6E', '#4F8CFF', '#A66CFF', '#FF5CA8', '#22C1C3', '#F57C3A'];

// ---------------------------------------------------------------- uygulama durumu
let mapDef, data, view, byId, byFid = new Map(), byRid = new Map(), colorMap = new Map();
let game = null;
let labelMode = 'none';

async function loadMap(id) {
  mapDef = MAPS[id];
  data = await mapDef.load();
  byId = new Map(data.items.map(i => [i.id, i]));
  byFid = new Map((data.features || []).map(f => [f.id, f]));
  byRid = new Map((data.resources || []).map(r => [r.id, r]));
  // Komşu iller farklı renk alsın diye açgözlü (greedy) graf boyama
  const order = [...data.items].sort((a, b) => b.neighbors.length - a.neighbors.length);
  const rainbow = new Map();
  for (const it of order) {
    const used = new Set(it.neighbors.map(n => rainbow.get(n)));
    const free = RAINBOW.map((_, i) => i).filter(i => !used.has(i));
    rainbow.set(it.id, free[(it.id * 7) % free.length] ?? it.id % RAINBOW.length);
  }
  colorMap = rainbow;
  const areaRank = [...data.items].sort((a, b) => b.area - a.area).map(i => i.id);
  const popRank = [...data.items].sort((a, b) => b.pop - a.pop).map(i => i.id);
  for (const it of data.items) { it.areaRank = areaRank.indexOf(it.id) + 1; it.popRank = popRank.indexOf(it.id) + 1; }
}

function colorOf(item) {
  if (store.settings.colors === 'region') return shade(data.regions[item.region].color, ((item.id * 37) % 5 - 2) * 6);
  return RAINBOW[colorMap.get(item.id)];
}
function shade(hex, dl) {
  let [r, g, b] = hex.match(/\w\w/g).map(h => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  }
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${Math.max(20, Math.min(80, l * 100 + dl)).toFixed(0)}%)`;
}

// ---------------------------------------------------------------- ana menü
function renderHome() {
  const s = store.settings;
  const picker = $('#mapPicker'); picker.innerHTML = '';
  for (const m of Object.values(MAPS)) {
    const b = el('button', { className: 'map-tab' + (m.id === s.map ? ' active' : ''), disabled: !!m.comingSoon },
      `<span>${m.flag}</span> ${m.title}${m.comingSoon ? ' <small>yakında</small>' : ''}`);
    b.onclick = async () => { s.map = m.id; save(); await loadMap(m.id); renderHome(); };
    picker.append(b);
  }

  const p = prog(), total = data.items.length;
  const mastered = Object.values(p.mastery).filter(v => v >= 3).length;
  $('#homeStats').innerHTML = `
    <div class="stat"><b>⭐ ${fmt(p.stars)}</b><span>Toplam yıldız</span></div>
    <div class="stat"><b>🔍 ${p.discovered.length}/${total}</b><span>Keşfedilen ${mapDef.itemNoun}</span></div>
    <div class="stat"><b>🎓 ${mastered}/${total}</b><span>Öğrenilen ${mapDef.itemNoun}</span></div>`;

  const modes = $('#modes'); modes.innerHTML = '';
  for (const m of MODES) {
    if (m.needs && !mapDef[m.needs] && !data[m.needs]?.length) continue;
    const best = p.best[m.id];
    const b = el('button', { className: 'mode-card' }, `
      <span class="mode-icon" style="--mc:${m.color}">${m.icon}</span>
      <span class="mode-text"><b>${m.title}</b><small>${m.desc}</small></span>
      ${best ? `<span class="mode-best">🏆 ${best}</span>` : ''}`);
    b.onclick = () => startGame(m.id);
    modes.append(b);
  }

  const chips = $('#regionChips'); chips.innerHTML = '';
  const regionEntries = [['all', { name: 'Tümü', color: '#8892b0' }], ...Object.entries(data.regions)];
  for (const [id, r] of regionEntries) {
    const c = el('button', { className: 'chip' + (s.region === id ? ' active' : '') }, `<i style="background:${r.color}"></i>${r.name}`);
    c.onclick = () => { s.region = id; save(); renderHome(); };
    chips.append(c);
  }
  segSetup('#roundLen', s.roundLen, v => { s.roundLen = v; save(); });
}

function segSetup(sel, value, onChange) {
  const root = $(sel);
  root.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.v === value);
    b.onclick = () => { root.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); onChange(b.dataset.v); };
  });
}

function show(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === screen));
}

// ---------------------------------------------------------------- oyun
function pool() {
  const r = store.settings.region;
  return data.items.filter(i => r === 'all' || i.region === r);
}

function startGame(modeId) {
  const mode = MODES.find(m => m.id === modeId);
  const items = pool();
  const len = store.settings.roundLen === 'all' ? items.length : Math.min(items.length, +store.settings.roundLen);
  let queue = shuffle(items);
  if (modeId === 'neighbors') queue = queue.filter(i => i.neighbors.length > 0);
  if (modeId === 'resources') {
    const ids = new Set(items.map(i => i.id));
    queue = shuffle(data.resources.filter(r => r.provinces.some(p => ids.has(p)))).slice(0, len);
  }
  if (modeId === 'mines') {
    const ids = new Set(items.map(i => i.id));
    queue = shuffle(data.resources.filter(r => isMineral(r) && r.provinces.some(p => ids.has(p))));
  }
  if (modeId === 'nature') {
    const ids = new Set(items.map(i => i.id));
    queue = shuffle(data.features.filter(f => f.provinces?.some(p => ids.has(p))));
  }
  if (modeId !== 'timed' && modeId !== 'explore' && modeId !== 'atlas') queue = queue.slice(0, len);

  game = {
    mode, items, poolIds: new Set(items.map(i => i.id)), queue, index: -1, current: null,
    score: 0, streak: 0, bestStreak: 0, correct: 0, asked: 0, wrongTries: 0, hintLevel: 0,
    found: new Set(), missed: new Set(), startedAt: Date.now(), timeLeft: 60, locked: false,
  };

  show('game');
  $('#hudTitle').innerHTML = `<span>${mode.icon}</span> ${mode.title}`;
  const free = modeId === 'explore' || modeId === 'atlas' || modeId === 'names';
  $('#hudStreakWrap').classList.toggle('hidden', free);
  const noScore = modeId === 'atlas' || modeId === 'names';
  $('#hudScore').parentElement.classList.toggle('hidden', noScore);
  $('#hudProgress').classList.toggle('hidden', noScore);
  document.querySelector('.progress-bar').classList.toggle('hidden', noScore);
  $('#zLabels').classList.toggle('hidden', modeId === 'names');
  $('#btnHint').classList.toggle('hidden', free || modeId === 'identify');
  $('#btnSkip').classList.toggle('hidden', free);
  $('#atlas').classList.toggle('hidden', modeId !== 'atlas');
  $('#zLayers').classList.toggle('hidden', !data.features?.length || modeId === 'names');
  $('#layerMenu').classList.add('hidden');
  $('#choices').classList.toggle('hidden', modeId !== 'identify');
  document.body.dataset.mode = modeId;
  document.body.dataset.level = store.settings.level;
  closeInfo();

  // Her oyunda temiz bir <svg> ile başla (eski dinleyiciler birikmesin)
  const oldSvg = $('#map'), svg = oldSvg.cloneNode(false);
  oldSvg.replaceWith(svg);
  view?.destroy();
  view = new MapView(svg, {
    viewBox: data.viewBox, shapes: data.shapes, items: data.items, features: data.features, colorOf,
    onTap: handleTap, onFeatureTap: handleFeatureTap, onHover: handleHover,
  });
  // İsimli haritada dikey telefonda adlar okunsun diye başlangıçta biraz daha yakın aç
  if (modeId === 'names') view.startBoost = 2.4;
  if (modeId !== 'neighbors') for (const it of data.items) if (!game.poolIds.has(it.id)) view.set(it.id, 'off');
  if (modeId === 'explore') for (const id of prog().discovered) if (game.poolIds.has(id)) { view.set(id, 'found'); game.found.add(id); }
  if (store.settings.region !== 'all') setTimeout(() => view.fitIds([...game.poolIds], 0.08, 100), 60);

  applyLayers();
  labelMode = modeId === 'names' ? 'all' : ['explore', 'nature', 'atlas', 'resources', 'mines'].includes(modeId) ? 'none' : (store.settings.level === 'hard' ? 'none' : 'found');
  refreshLabels();
  renderLegend();
  updateHud();

  clearInterval(game.timer);
  if (modeId === 'timed') {
    game.timer = setInterval(() => {
      if (!game || game.mode.id !== 'timed') return;
      game.timeLeft--; updateHud();
      if (game.timeLeft <= 10 && game.timeLeft > 0) sfx.play('tap');
      if (game.timeLeft <= 0) finish();
    }, 1000);
  }
  next();
}

function refreshLabels() {
  view.setLabels(labelMode, game.found); $('#map').dataset.labels = labelMode;
  // Yazı tipi geç yüklenirse ad genişlikleri değişir; yüklenince yeniden sığdır
  if (labelMode === 'all') document.fonts?.ready.then(() => { if (labelMode === 'all') view.fitLabels(); });
}

function renderLegend() {
  const lg = $('#legend');
  if (store.settings.colors !== 'region') { lg.innerHTML = ''; return; }
  lg.innerHTML = Object.values(data.regions).map(r => `<span><i style="background:${r.color}"></i>${r.name}</span>`).join('');
}

function next() {
  const g = game;
  view.clear('target', 'hint', 'region-hint', 'selected', 'wrong', 'center', 'peek');
  view.clearFeatures('target', 'selected');
  view.unpaintAll(); view.setMarkers([]); $('#map').classList.remove('atlas-focus');
  $('#choices').classList.toggle('hidden', g.mode.id !== 'identify');
  $('#feedback').className = 'feedback';
  g.wrongTries = 0; g.hintLevel = 0; g.locked = false; g.neighborFound = new Set();

  if (g.mode.id === 'atlas') return atlasStart();
  if (g.mode.id === 'names') return setPrompt('🏷️ Bir ile dokun, bilgi kartını aç! <small>Yakınlaştırınca adlar büyür.</small>');
  if (g.mode.id === 'explore') {
    setPrompt(`Bir ${mapDef.itemNoun}e dokun ve keşfet! <small>(${g.found.size}/${g.items.length})</small>`);
    return;
  }
  g.index++;
  if (g.mode.id === 'timed' && g.index >= g.queue.length) { g.queue.push(...shuffle(g.items)); }
  if (g.index >= g.queue.length) return finish();
  g.current = g.queue[g.index];
  g.asked++;
  const c = g.current;

  switch (g.mode.id) {
    case 'find':
    case 'timed':
      setPrompt(`<b>${c.name}</b> nerede?`, `${c.name} nerede?`);
      break;
    case 'plate':
      setPrompt(`<span class="plate big">${c.code}</span> plakalı il hangisi?`, `${Number(c.code)} plakalı il hangisi?`);
      break;
    case 'identify':
      view.set(c.id, 'target'); view.bringToFront(c.id);
      view.fitIds([c.id, ...c.neighbors], 0.35, 320);
      setPrompt('Parlayan il hangisi?', 'Parlayan il hangisi?');
      renderChoices();
      break;
    case 'nature':
      natureQuestion(c);
      break;
    case 'resources':
      resQuestion(c);
      break;
    case 'mines':
      mineQuestion(c);
      break;
    case 'neighbors':
      view.set(c.id, 'center'); view.bringToFront(c.id);
      view.fitIds([c.id, ...c.neighbors], 0.12, 220);
      setPrompt(`<b>${c.name}</b> ilinin komşularını bul <small id="nbCount">(0/${c.neighbors.length})</small>`, `${c.name} ilinin komşularını bul`);
      break;
  }
  updateHud();
}

function setPrompt(html, speech) {
  const p = $('#promptText');
  p.innerHTML = html;
  p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop');
  game.speech = speech;
  if (speech) voice.say(speech);
}

function updateHud() {
  const g = game;
  $('#hudScore').textContent = fmt(g.score);
  $('#hudStreak').textContent = g.streak;
  let txt = '', pct = 0;
  if (g.mode.id === 'atlas' || g.mode.id === 'names') return;
  if (g.mode.id === 'explore') { txt = `${g.found.size}/${g.items.length}`; pct = g.found.size / g.items.length; }
  else if (g.mode.id === 'timed') { txt = `⏳ ${g.timeLeft}s`; pct = g.timeLeft / 60; }
  else { txt = `${Math.min(g.index + 1, g.queue.length)}/${g.queue.length}`; pct = g.index / g.queue.length; }
  $('#hudProgress').textContent = txt;
  $('#hudProgress').classList.toggle('danger', g.mode.id === 'timed' && g.timeLeft <= 10);
  $('#progressBar').style.width = (Math.max(0, Math.min(1, pct)) * 100).toFixed(1) + '%';
}

function feedback(html, type) {
  const f = $('#feedback');
  f.innerHTML = html;
  f.className = 'feedback';
  void f.offsetWidth;
  f.className = `feedback show ${type}`;
  clearTimeout(f._t);
  f._t = setTimeout(() => f.classList.remove('show'), type === 'bad' ? 2600 : 2000);
}

function handleHover(id, x, y) {
  const tip = $('#tooltip');
  if (!game || game.mode.id !== 'explore' || id == null) { tip.classList.add('hidden'); return; }
  const it = byId.get(id), r = $('#mapWrap').getBoundingClientRect();
  tip.textContent = `${it.name} · ${it.code}`;
  tip.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 14}px)`;
  tip.classList.remove('hidden');
}

function handleTap(id) {
  const g = game;
  if (!g || g.locked) return;
  const item = byId.get(id);
  if (!g.poolIds.has(id) && !['neighbors', 'nature', 'resources'].includes(g.mode.id)) return;
  if (g.mode.id === 'nature') return natureTap(item);
  if (g.mode.id === 'resources') return resTap(item);
  if (g.mode.id === 'mines') return mineTap(item);
  if (g.mode.id === 'atlas') { sfx.play('tap'); voice.say(item.name); view.flash(item.id, 'peek', 1200); return openInfo(item); }

  if (g.mode.id === 'explore') return exploreTap(item);
  if (g.mode.id === 'names') return namesTap(item);
  if (g.mode.id === 'identify') {
    if (id === g.current.id) feedback('Evet, bu il! Adını aşağıdan seç 👇', 'info');
    else { view.flash(id, 'peek', 700); feedback(`Bu <b>${item.name}</b>. Aşağıdan parlayan ilin adını seç!`, 'info'); }
    return;
  }
  if (g.mode.id === 'neighbors') return neighborTap(item);

  const target = g.current;
  if (id === target.id) answerCorrect(target);
  else answerWrong(item, target);
}

function namesTap(item) {
  sfx.play('tap');
  voice.say(item.name);
  view.clear('selected');
  view.set(item.id, 'selected'); view.bringToFront(item.id);
  setPrompt(`📍 <b>${item.name}</b> <span class="plate">${item.code}</span> <small>${data.regions[item.region].name}</small>`);
  openInfo(item);
}

function exploreTap(item) {
  const g = game;
  sfx.play('tap');
  voice.say(item.name);
  view.clear('selected');
  view.set(item.id, 'selected'); view.bringToFront(item.id);
  const isNew = !g.found.has(item.id);
  if (isNew) {
    g.found.add(item.id); view.set(item.id, 'found');
    const p = prog(); p.discovered = [...new Set([...p.discovered, item.id])];
    g.score += 1; p.stars += 1; save();
    feedback(`✨ Yeni keşif: <b>${item.name}</b> +1 ⭐`, 'good');
    if (g.found.size === g.items.length) setTimeout(() => { confetti(); feedback('🎉 Hepsini keşfettin!', 'good'); }, 400);
  } else {
    feedback(`📍 <b>${item.name}</b> · ${item.code} · ${data.regions[item.region].name}`, 'info');
  }
  refreshLabels();
  setPrompt(`📍 <b>${item.name}</b> <span class="plate">${item.code}</span> <small>${data.regions[item.region].name}</small>`);
  updateHud();
  if (store.settings.infoExplore) openInfo(item);
  else showInfoButton(item);
}

function points() {
  const g = game;
  const base = g.mode.id === 'timed' ? 10 : [10, 6, 3, 1][Math.min(g.wrongTries, 3)];
  const hintCut = g.hintLevel ? Math.min(base, 3) : base;
  return hintCut + Math.min(10, g.streak * 2);
}

function answerCorrect(item) {
  const g = game;
  g.locked = true;
  const firstTry = g.wrongTries === 0 && g.hintLevel === 0;
  g.streak = firstTry ? g.streak + 1 : 0;
  g.bestStreak = Math.max(g.bestStreak, g.streak);
  const pts = points();
  g.score += pts;
  if (firstTry) g.correct++; else g.missed.add(item.id);
  g.found.add(item.id);
  const p = prog(); p.mastery[item.id] = Math.max(0, (p.mastery[item.id] || 0) + (firstTry ? 1 : -1)); save();

  view.clear('hint', 'region-hint', 'target');
  view.set(item.id, 'found'); view.flash(item.id, 'correct', 900); view.bringToFront(item.id);
  refreshLabels();
  sfx.play(g.streak > 0 && g.streak % 5 === 0 ? 'streak' : 'correct');
  const praise = ['Harika!', 'Süpersin!', 'Aferin!', 'Mükemmel!', 'Bravo!', 'Çok iyi!'][Math.random() * 6 | 0];
  const streakTxt = g.streak >= 3 ? ` <span class="fire">🔥 ${g.streak}'li seri</span>` : '';
  feedback(`✅ ${praise} <b>${item.name}</b> +${pts}${streakTxt} <button class="fb-info" data-id="${item.id}">ℹ️ Bilgi</button>`, 'good');
  voice.say(`${praise} ${item.name}`);
  updateHud();

  const delay = g.mode.id === 'timed' ? 450 : 1100;
  if (store.settings.infoQuiz && g.mode.id !== 'timed') { openInfo(item, { resume: true }); return; }
  setTimeout(() => { if (game === g) next(); }, delay);
}

function answerWrong(tapped, target) {
  const g = game;
  g.wrongTries++;
  g.streak = 0;
  sfx.play('wrong');
  view.flash(tapped.id, 'wrong', 900);
  if (navigator.vibrate) navigator.vibrate(60);
  const lvl = store.settings.level;
  const regionAt = lvl === 'easy' ? 1 : lvl === 'normal' ? 2 : 99;
  const revealAt = lvl === 'easy' ? 2 : 3;
  let msg = `❌ Bu <b>${tapped.name}</b>. Tekrar dene!`;
  if (g.mode.id === 'timed') { msg = `❌ Bu <b>${tapped.name}</b>`; }
  if (g.wrongTries >= regionAt && g.hintLevel < 1) { showHint(1); msg += ` <small>İpucu: ${data.regions[target.region].name} Bölgesi</small>`; }
  if (g.wrongTries >= revealAt) {
    if (lvl === 'hard' || g.mode.id === 'timed') return reveal(target, `❌ Bu <b>${tapped.name}</b>. Doğrusu <b>${target.name}</b>.`);
    showHint(2); msg = `❌ Bu <b>${tapped.name}</b>. Parlayan ile dokun!`;
  }
  feedback(msg, 'bad');
  updateHud();
}

function reveal(target, msg) {
  const g = game;
  g.locked = true; g.missed.add(target.id);
  const p = prog(); p.mastery[target.id] = Math.max(0, (p.mastery[target.id] || 0) - 1); save();
  view.set(target.id, 'hint'); view.bringToFront(target.id);
  feedback(msg + ` <button class="fb-info" data-id="${target.id}">ℹ️ Bilgi</button>`, 'bad');
  voice.say(`Doğrusu ${target.name}`);
  setTimeout(() => { if (game === g) { view.set(target.id, 'hint', false); next(); } }, 1800);
}

function showHint(level) {
  const g = game, t = g.current;
  if (!t) return;
  g.hintLevel = Math.max(g.hintLevel, level);
  if (level === 1) {
    for (const it of data.items) if (it.region === t.region && g.poolIds.has(it.id)) view.set(it.id, 'region-hint');
  } else {
    view.set(t.id, 'hint'); view.bringToFront(t.id);
  }
}

function neighborTap(item) {
  const g = game, c = g.current;
  if (item.id === c.id) { feedback(`Bu <b>${c.name}</b>. Onun <b>komşularını</b> bul!`, 'info'); return; }
  if (g.neighborFound.has(item.id)) return;
  if (c.neighbors.includes(item.id)) {
    g.neighborFound.add(item.id); g.found.add(item.id);
    g.streak++; g.bestStreak = Math.max(g.bestStreak, g.streak);
    g.score += 5 + Math.min(10, g.streak);
    view.set(item.id, 'found'); view.flash(item.id, 'correct');
    refreshLabels();
    sfx.play('correct'); voice.say(item.name);
    $('#nbCount').textContent = `(${g.neighborFound.size}/${c.neighbors.length})`;
    if (g.neighborFound.size === c.neighbors.length) {
      g.locked = true;
      if (g.wrongTries === 0) g.correct++; else g.missed.add(c.id);
      feedback(`🎉 <b>${c.name}</b> ilinin bütün komşularını buldun!`, 'good');
      sfx.play('streak');
      setTimeout(() => { if (game === g) { for (const n of c.neighbors) { view.set(n, 'found', false); g.found.delete(n); } view.set(c.id, 'found'); g.found.add(c.id); refreshLabels(); next(); } }, 1500);
    } else feedback(`✅ <b>${item.name}</b> komşu!`, 'good');
  } else {
    g.wrongTries++; g.streak = 0;
    sfx.play('wrong'); view.flash(item.id, 'wrong');
    feedback(`❌ <b>${item.name}</b>, ${c.name} ile komşu değil.`, 'bad');
    if (store.settings.level !== 'hard' && g.wrongTries >= (store.settings.level === 'easy' ? 2 : 4)) {
      const left = c.neighbors.filter(n => !g.neighborFound.has(n));
      if (left.length) { view.set(left[0], 'hint'); g.hintLevel = 1; }
    }
  }
  updateHud();
}

function renderChoices() {
  const g = game, c = g.current, lvl = store.settings.level;
  const n = lvl === 'easy' ? 3 : 4;
  let candidates = lvl === 'hard' ? shuffle(c.neighbors.map(id => byId.get(id))) : [];
  candidates = [...candidates, ...shuffle(g.items.filter(i => i.id !== c.id))];
  const opts = shuffle([c, ...[...new Set(candidates)].filter(i => i.id !== c.id).slice(0, n - 1)]);
  const box = $('#choices'); box.innerHTML = '';
  for (const o of opts) {
    const b = el('button', { className: 'choice' }, o.name);
    b.onclick = () => {
      if (g.locked) return;
      if (o.id === c.id) { b.classList.add('ok'); answerCorrect(c); }
      else {
        b.classList.add('no'); b.disabled = true;
        g.wrongTries++; g.streak = 0; sfx.play('wrong');
        view.flash(o.id, 'wrong', 900);
        feedback(`❌ Hayır, kırmızı yanan <b>${o.name}</b>.`, 'bad');
        if (g.wrongTries >= n - 1) { box.querySelectorAll('.choice').forEach(x => { if (x.textContent === c.name) x.classList.add('ok'); }); reveal(c, `Doğrusu <b>${c.name}</b>.`); }
        updateHud();
      }
    };
    box.append(b);
  }
}

// ---------------------------------------------------------------- coğrafi katmanlar
function visibleLayers() {
  // Doğa Avı'nda bütün katmanlar açık; diğer modlarda kullanıcının seçimi geçerli
  if (game?.mode.id === 'nature') return Object.keys(data.layerTypes || {});
  // İsimli haritada dağ simgeleri il adlarının üstüne binmesin
  if (game?.mode.id === 'names') return ['lake', 'river', 'sea'];
  // Kaynak Oyunu'nda dağ simgeleri şık harflerinin üstüne binmesin
  if (game?.mode.id === 'mines') return store.settings.layers.filter(t => t !== 'mountain');
  return store.settings.layers;
}
function applyLayers() {
  if (!view) return;
  view.setLayers(visibleLayers());
  const svg = $('#map');
  // Yalnızca Keşfet modunda katmanlara dokunulabilir; oyunlarda dokunuşlar alttaki ile gider
  svg.classList.toggle('layers-passive', game?.mode.id !== 'explore');
  // Doğa Avı'nda cevabı vermesin, İsimli Harita'da il adlarıyla karışmasın diye katman adları gizlenir
  svg.classList.toggle('hide-flabels', game?.mode.id === 'nature' || game?.mode.id === 'names');
}
function renderLayerMenu() {
  const menu = $('#layerMenu');
  menu.innerHTML = '<b>Katmanlar</b>' + Object.entries(data.layerTypes).map(([t, lt]) =>
    `<label class="toggle"><input type="checkbox" data-layer="${t}" ${store.settings.layers.includes(t) ? 'checked' : ''} ${game?.mode.id === 'nature' ? 'disabled' : ''}><span>${lt.icon} ${lt.name}</span></label>`).join('')
    + (game?.mode.id === 'nature' ? '<small>Doğa Avı\'nda bütün katmanlar açıktır.</small>' : '');
  menu.querySelectorAll('[data-layer]').forEach(cb => cb.onchange = () => {
    const set = new Set(store.settings.layers);
    cb.checked ? set.add(cb.dataset.layer) : set.delete(cb.dataset.layer);
    store.settings.layers = [...set]; save(); applyLayers();
  });
}

const typeOne = f => f.kind || data.layerTypes[f.type].one;
const cap = s => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

function handleFeatureTap(fid) {
  const g = game, f = byFid.get(fid);
  if (!g || !f || g.mode.id !== 'explore') return;
  sfx.play('tap');
  voice.say(f.name);
  view.clearFeatures('selected'); view.clear('selected', 'peek');
  view.setFeature(fid, 'selected');
  for (const p of f.provinces || []) view.set(p, 'peek');
  const lt = data.layerTypes[f.type];
  setPrompt(`${lt.icon} <b>${f.name}</b> <small>${cap(typeOne(f))}</small>`);
  if (store.settings.infoExplore) openFeatureInfo(f);
  else feedback(`${lt.icon} <b>${f.name}</b> <button class="fb-info" data-fid="${f.id}">ℹ️ Bilgi</button>`, 'info');
}

function natureQuestion(f) {
  const g = game, lvl = store.settings.level;
  const sameType = data.features.filter(x => x.type === f.type && x.id !== f.id && (x.kind || '') === (f.kind || ''));
  // Soru tipi: "hangi ilde?" (haritaya dokun) ya da "bu hangisi?" (seçenekten seç)
  g.qType = sameType.length >= 3 && Math.random() < 0.5 ? 'name' : 'where';
  g.neighborFound = new Set();
  if (g.qType === 'where' && lvl !== 'hard') view.setFeature(f.id, 'target');
  if (g.qType === 'name') view.setFeature(f.id, 'target');
  view.fitFeature(f.id, 0.8, g.qType === 'name' ? 260 : 420);
  const one = typeOne(f), lt = data.layerTypes[f.type];
  if (g.qType === 'where') {
    const q = f.type === 'river' ? `<b>${f.name}</b> hangi illerden geçer? <small>Birine dokun!</small>`
      : `<b>${f.name}</b> hangi ilde?${f.provinces.length > 1 ? ' <small>Birine dokun!</small>' : ''}`;
    setPrompt(`${lt.icon} ${q}`, f.type === 'river' ? `${f.name} hangi illerden geçer?` : `${f.name} hangi ilde?`);
  } else {
    setPrompt(`${lt.icon} Parlayan ${one} hangisi?`, `Parlayan ${one} hangisi?`);
    const n = lvl === 'easy' ? 3 : 4;
    const opts = shuffle([f, ...shuffle(sameType).slice(0, n - 1)]);
    const box = $('#choices'); box.innerHTML = ''; box.classList.remove('hidden');
    for (const o of opts) {
      const b = el('button', { className: 'choice' }, o.name);
      b.onclick = () => {
        if (g.locked) return;
        if (o.id === f.id) { b.classList.add('ok'); natureCorrect(f); }
        else {
          b.classList.add('no'); b.disabled = true;
          g.wrongTries++; g.streak = 0; sfx.play('wrong');
          feedback(`❌ Hayır, bu <b>${o.name}</b> değil.`, 'bad');
          if (g.wrongTries >= n - 1) {
            box.querySelectorAll('.choice').forEach(x => { if (x.textContent === f.name) x.classList.add('ok'); });
            natureReveal(f, `Doğrusu <b>${f.name}</b>.`);
          }
          updateHud();
        }
      };
      box.append(b);
    }
  }
}

function natureTap(item) {
  const g = game, f = g.current;
  if (g.qType === 'name') { feedback('Aşağıdaki seçeneklerden birini seç 👇', 'info'); return; }
  if (f.provinces.includes(item.id)) return natureCorrect(f, item);
  g.wrongTries++; g.streak = 0;
  sfx.play('wrong'); view.flash(item.id, 'wrong', 900);
  if (navigator.vibrate) navigator.vibrate(60);
  const lvl = store.settings.level;
  const hintAt = lvl === 'easy' ? 1 : lvl === 'normal' ? 2 : 99, revealAt = lvl === 'easy' ? 2 : 3;
  let msg = `❌ Bu <b>${item.name}</b>. ${cap(typeOne(f))} burada değil.`;
  if (g.wrongTries >= hintAt) { view.setFeature(f.id, 'target'); g.hintLevel = Math.max(g.hintLevel, 1); msg += ' <small>İpucu: parlayan yere bak!</small>'; }
  if (g.wrongTries >= revealAt) return natureReveal(f, msg);
  feedback(msg, 'bad');
  updateHud();
}

function natureCorrect(f, tapped) {
  const g = game;
  g.locked = true;
  const firstTry = g.wrongTries === 0 && g.hintLevel === 0;
  g.streak = firstTry ? g.streak + 1 : 0;
  g.bestStreak = Math.max(g.bestStreak, g.streak);
  const pts = points();
  g.score += pts;
  if (firstTry) g.correct++; else g.missed.add('f:' + f.id);
  const p = prog(); p.fmastery ||= {}; p.fmastery[f.id] = Math.max(0, (p.fmastery[f.id] || 0) + (firstTry ? 1 : -1)); save();
  view.setFeature(f.id, 'target');
  for (const pid of f.provinces) view.set(pid, 'peek');
  if (tapped) view.flash(tapped.id, 'correct', 900);
  sfx.play(g.streak > 0 && g.streak % 5 === 0 ? 'streak' : 'correct');
  const where = f.provinces.map(pid => byId.get(pid).name).join(', ');
  feedback(`✅ <b>${f.name}</b> +${pts}${where ? ` <small>📍 ${where}</small>` : ''} <button class="fb-info" data-fid="${f.id}">ℹ️ Bilgi</button>`, 'good');
  voice.say(`Harika! ${f.name}`);
  updateHud();
  if (store.settings.infoQuiz) { openFeatureInfo(f, { resume: true }); return; }
  setTimeout(() => { if (game === g) next(); }, 2000);
}

function natureReveal(f, msg) {
  const g = game;
  g.locked = true; g.missed.add('f:' + f.id);
  const p = prog(); p.fmastery ||= {}; p.fmastery[f.id] = Math.max(0, (p.fmastery[f.id] || 0) - 1); save();
  view.setFeature(f.id, 'target');
  for (const pid of f.provinces) view.set(pid, 'hint');
  const where = f.provinces.map(pid => byId.get(pid).name).join(', ');
  feedback(`${msg} <small>${f.name}: ${where}</small> <button class="fb-info" data-fid="${f.id}">ℹ️ Bilgi</button>`, 'bad');
  voice.say(`${f.name}, ${where}`);
  setTimeout(() => { if (game === g) { view.clear('hint'); next(); } }, 2600);
}

function openFeatureInfo(f, { resume = false } = {}) {
  const lt = data.layerTypes[f.type];
  const tiles = [];
  if (f.elev) tiles.push(['⛰️', `${fmt(f.elev)} m`, 'Yükseklik']);
  if (f.area) tiles.push(['📐', `~${fmt(f.area)} km²`, 'Yüzölçümü']);
  if (f.length) tiles.push(['📏', `~${fmt(f.length)} km`, 'Uzunluk']);
  if (f.sea) tiles.push(['🌊', f.sea, 'Döküldüğü yer']);
  if (f.provinces?.length) tiles.push(['📍', f.provinces.length, f.type === 'river' ? 'Geçtiği il' : 'İl']);
  // Aynı türdeki sıralama (en yüksek dağ, en büyük göl, en uzun nehir)
  const key = f.elev ? 'elev' : f.area ? 'area' : f.length ? 'length' : null;
  if (key) {
    const rank = data.features.filter(x => x.type === f.type && x[key]).sort((a, b) => b[key] - a[key]).findIndex(x => x.id === f.id) + 1;
    const word = { elev: 'en yüksek', area: 'en büyük', length: 'en uzun' }[key];
    tiles.push(['🏅', `${rank}.`, `Listedeki ${word} ${lt.one}`]);
  }
  const provs = (f.provinces || []).map(pid => byId.get(pid)).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  $('#infoBody').innerHTML = `
    <div class="info-head feature-head">
      <span class="feature-icon">${lt.icon}</span>
      <div><h3>${f.name}</h3><span class="chip region">${cap(typeOne(f))}</span></div>
      <button class="small-btn" id="infoSpeak" aria-label="Kartı sesli oku">🔊</button>
    </div>
    <div class="info-grid">${tiles.slice(0, 3).map(([i, b, s]) => `<div class="fact-tile"><span>${i}</span><b>${b}</b><small>${s}</small></div>`).join('')}</div>
    ${tiles.length > 3 ? `<div class="info-grid">${tiles.slice(3, 6).map(([i, b, s]) => `<div class="fact-tile"><span>${i}</span><b>${b}</b><small>${s}</small></div>`).join('')}</div>` : ''}
    <div class="info-row did-you-know"><h4>💡 Biliyor muydun?</h4><p>${f.fact}</p></div>
    ${provs.length ? `<div class="info-row"><h4>🗺️ ${f.type === 'river' ? 'Geçtiği iller' : 'Bulunduğu il' + (provs.length > 1 ? 'ler' : '')}</h4><div class="chips small">${provs.map(p => `<button class="chip" data-prov="${p.id}">${p.name}</button>`).join('')}</div></div>` : ''}
    ${resume ? '<button class="primary-btn wide" id="infoContinue">Devam et →</button>' : ''}`;
  $('#infoSpeak').onclick = () => voice.say(`${f.name}. ${f.fact}`, { force: true });
  $('#infoBody').querySelectorAll('[data-prov]').forEach(b => b.onclick = () => {
    const it = byId.get(+b.dataset.prov);
    view.flash(it.id, 'peek', 1400);
    if (game?.mode.id === 'explore') exploreTap(it); else if (game?.mode.id === 'names') namesTap(it); else openInfo(it, { resume });
  });
  if (resume) $('#infoContinue').onclick = () => { closeInfo(); next(); };
  showSheet(resume);
}

function showSheet(resume) {
  const sheet = $('#info');
  sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false');
  sheet.dataset.resume = resume ? '1' : '';
  sheet.scrollTop = 0;
}

// ---------------------------------------------------------------- zenginlikler: ortak yardımcılar
const resOf = id => (data.resources || []).filter(r => r.provinces.includes(id));
const verbOf = r => r.verb || data.resourceCats[r.cat].verb;
const VERB_ADJ = { 'çıkarılır': 'çıkarıldığı', 'üretilir': 'üretildiği', 'yetişir': 'yetiştiği', 'yapılır': 'yapıldığı' };
const names = ids => ids.map(id => byId.get(id).name).join(', ');

function economyRow(item) {
  if (!data.resources) return '';
  const rs = resOf(item.id);
  const rows = Object.entries(data.resourceCats).map(([cat, c]) => {
    const list = rs.filter(r => r.cat === cat);
    return list.length ? `<div class="eco-line"><span>${c.icon} ${c.name}</span><div class="chips small">${list.map(r => `<button class="chip" data-res="${r.id}">${r.icon} ${r.name}</button>`).join('')}</div></div>` : '';
  }).join('');
  const vt = data.vegTypes[item.vegetation];
  return `<div class="info-row eco"><h4>🧺 Zenginlikleri</h4>${rows}
    ${item.industry ? `<div class="eco-line"><span>🏭 Sanayi</span><p>${item.industry}</p></div>` : ''}
    ${vt ? `<div class="eco-line"><span>🌳 Bitki örtüsü</span><div class="chips small"><button class="chip" data-veg="${item.vegetation}"><i style="background:${vt.color}"></i>${vt.name}</button></div>${item.vegetationNote ? `<p class="note">🌸 ${item.vegetationNote}</p>` : ''}</div>` : ''}
  </div>`;
}

// Kartlardaki bağlantılar: ürün, bitki örtüsü, bölge, il
function bindCardLinks(resume) {
  const body = $('#infoBody');
  body.querySelectorAll('[data-res]').forEach(b => b.onclick = () => {
    if (game?.mode.id === 'atlas') atlasSelect('res', b.dataset.res, { card: true });
    else openResourceInfo(byRid.get(b.dataset.res), { resume });
  });
  body.querySelectorAll('[data-veg]').forEach(b => b.onclick = () => {
    if (game?.mode.id === 'atlas') atlasSelect('veg', b.dataset.veg, { card: true }); else openVegInfo(b.dataset.veg, { resume });
  });
  body.querySelectorAll('[data-region]').forEach(b => b.onclick = () => {
    if (game?.mode.id === 'atlas') atlasSelect('region', b.dataset.region, { card: true }); else openRegionInfo(b.dataset.region, { resume });
  });
  body.querySelectorAll('[data-prov]').forEach(b => b.onclick = () => {
    const it = byId.get(+b.dataset.prov);
    view.flash(it.id, 'peek', 1400);
    if (game?.mode.id === 'explore') exploreTap(it); else if (game?.mode.id === 'names') namesTap(it); else openInfo(it, { resume });
  });
}
const provChips = ids => `<div class="chips small">${ids.map(id => byId.get(id)).sort((a, b) => a.name.localeCompare(b.name, 'tr')).map(p => `<button class="chip" data-prov="${p.id}">${p.name}</button>`).join('')}</div>`;
function card(html, resume) {
  $('#infoBody').innerHTML = html + (resume ? '<button class="primary-btn wide" id="infoContinue">Devam et →</button>' : '');
  bindCardLinks(resume);
  if (resume) $('#infoContinue').onclick = () => { closeInfo(); next(); };
  showSheet(resume);
}
const cardHead = (icon, bg, title, chip) => `
  <div class="info-head feature-head"><span class="feature-icon" style="background:${bg}">${icon}</span>
    <div><h3>${title}</h3>${chip}</div>
    <button class="small-btn" id="infoSpeak" aria-label="Kartı sesli oku">🔊</button></div>`;

function openResourceInfo(r, { resume = false } = {}) {
  const c = data.resourceCats[r.cat];
  const regionIds = [...new Set(r.provinces.map(p => byId.get(p).region))];
  card(`
    ${cardHead(r.icon, CAT_COLORS[r.cat] + '22', r.name, `<span class="chip region" style="box-shadow:inset 0 0 0 2px ${CAT_COLORS[r.cat]}">${c.icon} ${c.name}</span>`)}
    <div class="info-row did-you-know"><h4>💡 Biliyor muydun?</h4><p>${r.info}</p></div>
    <div class="info-row"><h4>📍 Başlıca ${VERB_ADJ[verbOf(r)] || ''} iller</h4>${provChips(r.provinces)}</div>
    <div class="info-row"><h4>🗺️ Bölgeler</h4><div class="chips small">${regionIds.map(id => `<button class="chip" data-region="${id}"><i style="background:${data.regions[id].color}"></i>${data.regions[id].name}</button>`).join('')}</div></div>
    <p class="note">Liste bütün illeri değil, en bilinen merkezleri gösterir.</p>`, resume);
  $('#infoSpeak').onclick = () => voice.say(`${r.name}. ${r.info}`, { force: true });
}

function openVegInfo(type, { resume = false } = {}) {
  const v = data.vegTypes[type];
  const provs = data.items.filter(i => i.vegetation === type);
  const notes = provs.filter(i => i.vegetationNote);
  card(`
    ${cardHead(v.icon, v.color + '33', v.name, `<span class="chip region"><i style="background:${v.color}"></i>Bitki örtüsü</span>`)}
    <div class="info-row did-you-know"><h4>💡 Nasıl bir yer?</h4><p>${v.info}</p></div>
    <div class="info-row"><h4>🌱 Tipik bitkiler</h4><p>${v.trees}</p></div>
    ${notes.length ? `<div class="info-row"><h4>🌸 Dikkat çeken bitkiler</h4><ul class="notes">${notes.map(i => `<li><b>${i.name}:</b> ${i.vegetationNote}</li>`).join('')}</ul></div>` : ''}
    <div class="info-row"><h4>📍 Baskın olduğu iller (${provs.length})</h4>${provChips(provs.map(p => p.id))}</div>`, resume);
  $('#infoSpeak').onclick = () => voice.say(`${v.name}. ${v.info}`, { force: true });
}

function openRegionInfo(rid, { resume = false } = {}) {
  const r = data.regions[rid];
  const provs = data.items.filter(i => i.region === rid);
  const pop = provs.reduce((s, i) => s + i.pop, 0), area = provs.reduce((s, i) => s + i.area, 0);
  const top = (data.resources || []).map(res => ({ res, n: res.provinces.filter(p => byId.get(p).region === rid).length }))
    .filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 14);
  card(`
    ${cardHead('🗺️', r.color + '33', r.name, `<span class="chip region"><i style="background:${r.color}"></i>Coğrafi bölge</span>`)}
    <div class="info-grid">
      <div class="fact-tile"><span>🏙️</span><b>${provs.length}</b><small>İl</small></div>
      <div class="fact-tile"><span>👥</span><b>~${(pop / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} mn</b><small>Nüfus</small></div>
      <div class="fact-tile"><span>📐</span><b>~${fmt(Math.round(area / 1000))} bin km²</b><small>Yüzölçümü</small></div>
    </div>
    ${r.climate ? `<div class="info-row"><h4>🌦️ İklim</h4><p>${r.climate}</p></div>` : ''}
    ${r.vegetation ? `<div class="info-row"><h4>🌳 Bitki örtüsü</h4><p>${r.vegetation}</p></div>` : ''}
    ${r.economy ? `<div class="info-row"><h4>🏭 Ekonomi</h4><p>${r.economy}</p></div>` : ''}
    ${r.fact ? `<div class="info-row did-you-know"><h4>💡 Biliyor muydun?</h4><p>${r.fact}</p></div>` : ''}
    ${top.length ? `<div class="info-row"><h4>🧺 Başlıca zenginlikleri</h4><div class="chips small">${top.map(({ res }) => `<button class="chip" data-res="${res.id}">${res.icon} ${res.name}</button>`).join('')}</div></div>` : ''}
    <div class="info-row"><h4>📍 İlleri</h4>${provChips(provs.map(p => p.id))}</div>`, resume);
  $('#infoSpeak').onclick = () => voice.say(`${r.name} Bölgesi. ${r.climate || ''} ${r.economy || ''}`, { force: true });
}

function showResourceOnMap(r, fit = true) {
  view.unpaintAll();
  for (const p of r.provinces) view.paint(p, CAT_COLORS[r.cat]);
  view.setMarkers(r.provinces.map(id => ({ id, text: r.icon })));
  $('#map').classList.add('atlas-focus');
  if (fit) view.fitIds(r.provinces, 0.2, 320);
}

// ---------------------------------------------------------------- 🧺 zenginlikler atlası
const atlasTabs = () => [
  ...Object.entries(data.resourceCats).map(([id, c]) => ({ id, name: c.name, icon: c.icon })),
  { id: 'veg', name: 'Bitki örtüsü', icon: '🌳' },
  { id: 'region', name: 'Bölgeler', icon: '🗺️' },
];
function atlasStart() {
  game.atlasTab ||= 'tarim';
  renderAtlasTabs();
  $('#atlasInfo').innerHTML = '<p>👆 Yukarıdan bir konu, sonra bir ürün seç. Haritada parlayan illere dokunarak ayrıntıları gör.</p>';
  setPrompt('🧺 Bir ürün, maden ya da bitki örtüsü seç; haritada nerede olduğunu gör!');
}
function renderAtlasTabs() {
  const tabs = $('#atlasTabs');
  tabs.innerHTML = atlasTabs().map(t => `<button class="${t.id === game.atlasTab ? 'active' : ''}" data-tab="${t.id}">${t.icon} ${t.name}</button>`).join('');
  tabs.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { game.atlasTab = b.dataset.tab; renderAtlasTabs(); sfx.play('tap'); });
  const t = game.atlasTab;
  let list;
  if (t === 'veg') list = [{ kind: 'veg', id: 'all', icon: '🎨', name: 'Hepsi', color: '#8892b0' }, ...Object.entries(data.vegTypes).map(([id, v]) => ({ kind: 'veg', id, icon: v.icon, name: v.name, color: v.color }))];
  else if (t === 'region') list = Object.entries(data.regions).map(([id, r]) => ({ kind: 'region', id, icon: '', name: r.name, color: r.color }));
  else list = data.resources.filter(r => r.cat === t).map(r => ({ kind: 'res', id: r.id, icon: r.icon, name: r.name, color: CAT_COLORS[r.cat] }));
  const chips = $('#atlasChips');
  chips.innerHTML = list.map(x => `<button class="chip ${game.atlasSel === x.kind + ':' + x.id ? 'active' : ''}" data-kind="${x.kind}" data-id="${x.id}" style="--cc:${x.color}">${x.icon ? `<span>${x.icon}</span>` : `<i style="background:${x.color}"></i>`}${x.name}</button>`).join('');
  chips.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => atlasSelect(b.dataset.kind, b.dataset.id));
}
function atlasSelect(kind, id, { card: openCard = false } = {}) {
  const g = game;
  g.atlasSel = kind + ':' + id;
  g.atlasTab = kind === 'res' ? byRid.get(id).cat : kind;
  renderAtlasTabs();
  // Seçili çipi yalnızca çip şeridi içinde ortala (scrollIntoView tüm sayfayı da kaydırıyordu)
  const strip = $('#atlasChips'), active = strip.querySelector('.chip.active');
  if (active) strip.scrollTo({ left: active.offsetLeft - strip.clientWidth / 2 + active.offsetWidth / 2, behavior: 'smooth' });
  sfx.play('tap');
  const svg = $('#map'), info = $('#atlasInfo');
  view.unpaintAll(); view.setMarkers([]); svg.classList.remove('atlas-focus');
  const more = fn => { info.querySelector('[data-more]').onclick = fn; if (openCard) fn(); };
  if (kind === 'res') {
    const r = byRid.get(id);
    showResourceOnMap(r);
    voice.say(r.name);
    setPrompt(`${r.icon} <b>${r.name}</b> <small>${r.provinces.length} il</small>`);
    info.innerHTML = `<p>${r.info}</p><button class="small-btn" data-more>ℹ️ Detay</button>`;
    more(() => openResourceInfo(r));
  } else if (kind === 'veg' && id === 'all') {
    for (const it of data.items) if (it.vegetation) view.paint(it.id, data.vegTypes[it.vegetation].color);
    view.animateTo(view.clamp(view.startVb()));
    voice.say('Türkiye\'nin bitki örtüsü');
    setPrompt('🌳 <b>Türkiye\'nin bitki örtüsü</b> <small>Her renk bir bitki örtüsü türü</small>');
    info.innerHTML = `<div class="veg-legend">${Object.entries(data.vegTypes).map(([k, v]) => `<button data-veg-pick="${k}"><i style="background:${v.color}"></i>${v.name}</button>`).join('')}</div>`;
    info.querySelectorAll('[data-veg-pick]').forEach(b => b.onclick = () => atlasSelect('veg', b.dataset.vegPick));
  } else if (kind === 'veg') {
    const v = data.vegTypes[id];
    const ids = data.items.filter(i => i.vegetation === id).map(i => i.id);
    for (const p of ids) view.paint(p, v.color);
    view.setMarkers(ids.map(p => ({ id: p, text: v.icon })));
    svg.classList.add('atlas-focus');
    view.fitIds(ids, 0.1, 320);
    voice.say(v.name);
    setPrompt(`${v.icon} <b>${v.name}</b> <small>${ids.length} ilde baskın</small>`);
    info.innerHTML = `<p>${v.info} <b>Tipik bitkiler:</b> ${v.trees}.</p><button class="small-btn" data-more>ℹ️ Detay</button>`;
    more(() => openVegInfo(id));
  } else if (kind === 'region') {
    const r = data.regions[id];
    const ids = data.items.filter(i => i.region === id).map(i => i.id);
    for (const p of ids) view.paint(p, r.color);
    svg.classList.add('atlas-focus');
    view.fitIds(ids, 0.08, 320);
    voice.say(`${r.name} Bölgesi`);
    setPrompt(`🗺️ <b>${r.name} Bölgesi</b> <small>${ids.length} il</small>`);
    info.innerHTML = `<p>${r.climate || ''} ${r.economy || ''}</p><button class="small-btn" data-more>ℹ️ Detay</button>`;
    more(() => openRegionInfo(id));
  }
}

// ---------------------------------------------------------------- ⛏️ kaynak avı
function resQuestion(r) {
  const g = game;
  g.valid = r.provinces.filter(p => g.poolIds.has(p));
  const pick = g.valid[Math.random() * g.valid.length | 0];
  const distractors = data.resources.filter(x => x.id !== r.id && !x.provinces.includes(pick));
  g.qType = distractors.length >= 3 && Math.random() < 0.45 ? 'which' : 'where';
  if (g.qType === 'where') {
    setPrompt(`${r.icon} <b>${r.q}</b> hangi illerde ${verbOf(r)}? <small>Birine dokun!</small>`, `${r.q} hangi illerde ${verbOf(r)}?`);
    if (store.settings.region !== 'all') view.fitIds([...g.poolIds], 0.08, 100); else view.reset();
    return;
  }
  // "Bu il hangisiyle ünlü?": il parlar, doğru ürün seçeneklerden seçilir
  g.pick = pick;
  const prov = byId.get(pick), lvl = store.settings.level;
  view.set(pick, 'target'); view.bringToFront(pick);
  view.fitIds([pick, ...prov.neighbors], 0.3, 320);
  setPrompt(`🎯 <b>${prov.name}</b> ili hangisiyle ünlü?`, `${prov.name} ili hangisiyle ünlü?`);
  const n = lvl === 'easy' ? 3 : 4;
  const same = shuffle(distractors.filter(x => x.cat === r.cat)), other = shuffle(distractors.filter(x => x.cat !== r.cat));
  // Kolayda farklı konulardan, zorda aynı konudan çeldiriciler
  const pool = lvl === 'easy' ? [...other, ...same] : lvl === 'hard' ? [...same, ...other] : shuffle([...same.slice(0, 2), ...other]);
  const opts = shuffle([r, ...pool.slice(0, n - 1)]);
  const box = $('#choices'); box.innerHTML = ''; box.classList.remove('hidden');
  for (const o of opts) {
    const b = el('button', { className: 'choice' }, `${o.icon} ${o.name}`);
    b.onclick = () => {
      if (g.locked) return;
      if (o.id === r.id) { b.classList.add('ok'); resCorrect(r); return; }
      b.classList.add('no'); b.disabled = true;
      g.wrongTries++; g.streak = 0; sfx.play('wrong');
      feedback(`❌ ${prov.name}, ${o.name.toLocaleLowerCase('tr')} ile bilinmez.`, 'bad');
      if (g.wrongTries >= n - 1) {
        box.querySelectorAll('.choice').forEach(x => { if (x.textContent.includes(r.name)) x.classList.add('ok'); });
        resReveal(r, `Doğrusu <b>${r.name}</b>.`);
      }
      updateHud();
    };
    box.append(b);
  }
}

function resTap(item) {
  const g = game, r = g.current;
  if (g.qType === 'which') {
    if (item.id === g.pick) feedback('Evet, bu il! Aşağıdan ünlü olduğu şeyi seç 👇', 'info');
    else { view.flash(item.id, 'peek', 700); feedback(`Bu <b>${item.name}</b>. Aşağıdan seçim yap 👇`, 'info'); }
    return;
  }
  if (r.provinces.includes(item.id)) return resCorrect(r, item);
  g.wrongTries++; g.streak = 0;
  sfx.play('wrong'); view.flash(item.id, 'wrong', 900);
  const lvl = store.settings.level;
  const famous = resOf(item.id).slice(0, 3).map(x => `${x.icon} ${x.name}`).join(', ');
  let msg = `❌ Bu <b>${item.name}</b>.${famous ? ` <small>${item.name} şunlarla bilinir: ${famous}</small>` : ''}`;
  if (g.wrongTries >= (lvl === 'easy' ? 1 : lvl === 'normal' ? 2 : 99) && g.hintLevel < 1) { resHint(true); msg += ' <small>💡 Turuncu çizgili bölgeye bak!</small>'; }
  if (g.wrongTries >= (lvl === 'easy' ? 2 : 3)) return resReveal(r, msg);
  feedback(msg, 'bad');
  updateHud();
}

function resHint(silent = false) {
  const g = game, r = g.current;
  if (!r || g.locked) return;
  g.streak = 0;
  if (g.qType === 'which') {
    g.hintLevel = 1;
    if (!silent) feedback(`💡 İpucu: ${data.resourceCats[r.cat].icon} ${data.resourceCats[r.cat].name} konusundan.`, 'info');
    return updateHud();
  }
  if (g.hintLevel < 1) {
    g.hintLevel = 1;
    // Üretim merkezlerinin en çok bulunduğu bölgeyi göster
    const counts = {};
    for (const p of g.valid) counts[byId.get(p).region] = (counts[byId.get(p).region] || 0) + 1;
    const reg = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    for (const it of data.items) if (it.region === reg) view.set(it.id, 'region-hint');
    if (!silent) feedback(`💡 ${data.regions[reg].name} Bölgesi'ne bak!`, 'info');
  } else {
    g.hintLevel = 2;
    view.set(g.valid[0], 'hint'); view.bringToFront(g.valid[0]);
    if (!silent) feedback('💡 Parlayan il doğru cevaplardan biri!', 'info');
  }
  updateHud();
}

function resCorrect(r, tapped) {
  const g = game;
  g.locked = true;
  const firstTry = g.wrongTries === 0 && g.hintLevel === 0;
  g.streak = firstTry ? g.streak + 1 : 0;
  g.bestStreak = Math.max(g.bestStreak, g.streak);
  const pts = points();
  g.score += pts;
  if (firstTry) g.correct++; else g.missed.add('r:' + r.id);
  const p = prog(); p.rmastery ||= {}; p.rmastery[r.id] = Math.max(0, (p.rmastery[r.id] || 0) + (firstTry ? 1 : -1)); save();
  view.clear('region-hint', 'hint', 'target');
  showResourceOnMap(r, false);
  if (tapped) view.flash(tapped.id, 'correct', 900);
  sfx.play(g.streak > 0 && g.streak % 5 === 0 ? 'streak' : 'correct');
  feedback(`✅ ${r.icon} <b>${r.name}</b> +${pts} <small>📍 ${names(r.provinces)}</small> <button class="fb-info" data-rid="${r.id}">ℹ️ Bilgi</button>`, 'good');
  voice.say(`Harika! ${r.name}`);
  updateHud();
  if (store.settings.infoQuiz) { openResourceInfo(r, { resume: true }); return; }
  setTimeout(() => { if (game === g) next(); }, 2400);
}

function resReveal(r, msg) {
  const g = game;
  g.locked = true; g.missed.add('r:' + r.id);
  const p = prog(); p.rmastery ||= {}; p.rmastery[r.id] = Math.max(0, (p.rmastery[r.id] || 0) - 1); save();
  view.clear('region-hint', 'hint');
  showResourceOnMap(r, false);
  feedback(`${msg} <small>${r.icon} ${r.name}: ${names(r.provinces)}</small> <button class="fb-info" data-rid="${r.id}">ℹ️ Bilgi</button>`, 'bad');
  voice.say(`${r.name}: ${names(r.provinces)}`);
  setTimeout(() => { if (game === g) next(); }, 3000);
}

// ---------------------------------------------------------------- 💎 kaynak oyunu
// "Demir hangi ilde çıkarılır?" sorusu; şıklar il adları, haritada da harflerle işaretli
const LETTERS = ['A', 'B', 'C', 'D'];
const isMineral = r => r.cat === 'maden' || (r.cat === 'enerji' && r.verb === 'çıkarılır');

function mineQuestion(r) {
  const g = game, lvl = store.settings.level, n = lvl === 'easy' ? 3 : 4;
  const answers = r.provinces.filter(p => g.poolIds.has(p));
  g.answer = byId.get(answers[Math.random() * answers.length | 0]);
  // Çeldiriciler bu madenin listesinde olmayan illerden gelir. Liste yalnızca başlıca merkezleri gösterdiği için
  // kolay/normalde madenin hiç geçmediği bölgelerden, zorda üretim illerinin komşularından seçilir.
  const not = i => !r.provinces.includes(i.id);
  const inPool = shuffle(g.items.filter(not));
  const regs = new Set(r.provinces.map(p => byId.get(p).region));
  const far = shuffle(inPool.filter(i => !regs.has(i.region)));
  const near = shuffle([...new Set(r.provinces.flatMap(p => byId.get(p).neighbors))].map(id => byId.get(id)).filter(i => not(i) && g.poolIds.has(i.id)));
  const cands = lvl === 'hard' ? [...near, ...inPool] : lvl === 'easy' ? [...far, ...inPool] : [...far.slice(0, 2), ...inPool];
  // Seçili bölge çok küçükse bütün Türkiye'den tamamla
  if (new Set(cands).size < n - 1) cands.push(...shuffle(data.items.filter(not)));
  g.opts = shuffle([g.answer, ...[...new Set(cands)].slice(0, n - 1)]);

  setPrompt(`${r.icon} <b>${r.q}</b> hangi ilde ${verbOf(r)}? <small>Şıklardan birini seç!</small>`, `${r.q} hangi ilde ${verbOf(r)}?`);
  g.opts.forEach(o => view.set(o.id, 'peek'));
  view.setMarkers(g.opts.map((o, i) => ({ id: o.id, text: LETTERS[i], cls: 'letter' })));
  view.fitIds(g.opts.map(o => o.id), 0.15, 320);

  const box = $('#choices'); box.innerHTML = ''; box.classList.remove('hidden');
  g.opts.forEach((o, i) => {
    const b = el('button', { className: 'choice' }, `<span class="opt-letter">${LETTERS[i]}</span>${o.name}`);
    b.dataset.id = o.id;
    b.onclick = () => mineChoose(o.id);
    box.append(b);
  });
}

function mineTap(item) {
  if (game.opts.some(o => o.id === item.id)) return mineChoose(item.id);
  view.flash(item.id, 'peek', 700);
  feedback(`Bu <b>${item.name}</b>. Harfli illerden birini ya da aşağıdaki şıkları seç 👇`, 'info');
}

function mineChoose(id) {
  const g = game, b = $(`#choices [data-id="${id}"]`);
  if (!g || g.locked || !b || b.disabled) return;
  if (id === g.answer.id) {
    b.classList.add('ok');
    resCorrect(g.current, g.answer);
    view.clear('peek'); view.set(g.answer.id, 'selected'); view.fitIds(g.current.provinces, 0.2, 320);
    return;
  }
  const it = byId.get(id);
  b.classList.add('no'); b.disabled = true;
  g.wrongTries++; g.streak = 0;
  sfx.play('wrong'); view.flash(id, 'wrong', 900);
  if (navigator.vibrate) navigator.vibrate(60);
  const famous = resOf(id).filter(isMineral).slice(0, 3).map(x => `${x.icon} ${x.name}`).join(', ');
  const msg = `❌ <b>${it.name}</b> değil.${famous ? ` <small>${it.name}: ${famous}</small>` : ''}`;
  if ($('#choices').querySelectorAll('.choice:not(:disabled)').length <= 1) return mineReveal(msg);
  feedback(msg, 'bad');
  updateHud();
}

// İpucu: yanlış bir şıkkı ele, tek yanlış kaldıysa bölgeyi söyle
function mineHint() {
  const g = game;
  if (!g.answer || g.locked) return;
  g.streak = 0; g.hintLevel = Math.max(g.hintLevel, 1);
  const wrong = [...$('#choices').querySelectorAll('.choice:not(:disabled)')].filter(b => +b.dataset.id !== g.answer.id);
  if (wrong.length > 1) {
    const b = wrong[Math.random() * wrong.length | 0];
    b.disabled = true; b.classList.add('gone');
    view.set(+b.dataset.id, 'peek', false);
    feedback(`💡 <b>${byId.get(+b.dataset.id).name}</b> değil, onu eledim.`, 'info');
  } else feedback(`💡 ${data.regions[g.answer.region].name} Bölgesi'nde`, 'info');
  updateHud();
}

function mineReveal(msg) {
  const g = game;
  $(`#choices [data-id="${g.answer.id}"]`)?.classList.add('ok');
  resReveal(g.current, msg);
  view.clear('peek'); view.set(g.answer.id, 'hint'); view.fitIds(g.current.provinces, 0.2, 320);
}

// ---------------------------------------------------------------- bilgi kartı
function openInfo(item, { resume = false } = {}) {
  const r = data.regions[item.region];
  const pop = item.pop >= 1000 ? `${(item.pop / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon` : `${fmt(item.pop)} bin`;
  const neighbors = item.neighbors.map(n => byId.get(n)).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  $('#infoBody').innerHTML = `
    <div class="info-head" style="--c:${colorOf(item)}">
      <span class="plate big">${item.code}</span>
      <div><h3>${item.name}</h3><button class="chip region" data-region="${item.region}"><i style="background:${r.color}"></i>${r.name} Bölgesi ›</button></div>
      <button class="small-btn" id="infoSpeak" aria-label="Kartı sesli oku">🔊</button>
    </div>
    <div class="info-grid">
      <div class="fact-tile"><span>👥</span><b>~${pop}</b><small>Nüfus · ${item.popRank}. sırada</small></div>
      <div class="fact-tile"><span>📐</span><b>~${fmt(item.area)} km²</b><small>Yüzölçümü · ${item.areaRank}. sırada</small></div>
      <div class="fact-tile"><span>🤝</span><b>${neighbors.length}</b><small>Komşu il</small></div>
    </div>
    <div class="info-row"><h4>🍽️ Meşhur lezzetler</h4><p>${item.food}</p></div>
    <div class="info-row"><h4>🏛️ Görülecek yerler</h4><p>${item.places}</p></div>
    <div class="info-row did-you-know"><h4>💡 Biliyor muydun?</h4><p>${item.fact}</p></div>
    ${economyRow(item)}
    ${natureRow(item)}
    <div class="info-row"><h4>🗺️ Komşuları</h4><div class="chips small">${neighbors.map(nb => `<button class="chip" data-nb="${nb.id}">${nb.name}</button>`).join('')}</div></div>
    ${resume ? '<button class="primary-btn wide" id="infoContinue">Devam et →</button>' : ''}`;
  $('#infoSpeak').onclick = () => voice.say(`${item.name}. ${r.name} Bölgesinde. Plaka kodu ${item.plate}. ${item.fact} Meşhur lezzetleri: ${item.food}.`, { force: true });
  $('#infoBody').querySelectorAll('[data-nb]').forEach(b => b.onclick = () => {
    const nb = byId.get(+b.dataset.nb);
    if (game?.mode.id === 'explore') exploreTap(nb); else if (game?.mode.id === 'names') namesTap(nb);
    else { view.flash(nb.id, 'peek', 1400); openInfo(nb, { resume }); }
  });
  $('#infoBody').querySelectorAll('[data-feat]').forEach(b => b.onclick = () => {
    const f = byFid.get(b.dataset.feat);
    if (game?.mode.id === 'explore') handleFeatureTap(f.id); else openFeatureInfo(f, { resume });
  });
  bindCardLinks(resume);
  if (resume) $('#infoContinue').onclick = () => { closeInfo(); next(); };
  showSheet(resume);
}
function natureRow(item) {
  const fs = (data.features || []).filter(f => f.provinces?.includes(item.id));
  if (!fs.length) return '';
  return `<div class="info-row"><h4>🏞️ Doğal güzellikleri</h4><div class="chips small">${fs.map(f => `<button class="chip" data-feat="${f.id}">${data.layerTypes[f.type].icon} ${f.name}</button>`).join('')}</div></div>`;
}
function closeInfo() {
  const sheet = $('#info');
  const wasResume = sheet.dataset.resume === '1' && sheet.classList.contains('open');
  sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); sheet.dataset.resume = '';
  return wasResume;
}
function showInfoButton(item) {
  const f = $('#feedback');
  f.insertAdjacentHTML('beforeend', ` <button class="fb-info" data-id="${item.id}">ℹ️ Bilgi</button>`);
}

// ---------------------------------------------------------------- bitiş
function finish() {
  const g = game;
  if (!g || g.finished) return;
  g.finished = true; g.locked = true;
  clearInterval(g.timer);
  const total = g.mode.id === 'timed' ? g.asked : g.queue.length;
  const answered = g.mode.id === 'timed' ? Math.max(1, g.asked - 1) : total;
  const acc = g.mode.id === 'timed' ? g.correct / Math.max(1, answered) : g.correct / Math.max(1, total);
  let stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.4 ? 1 : 0;
  if (g.mode.id === 'timed') stars = g.correct >= 20 ? 3 : g.correct >= 12 ? 2 : g.correct >= 5 ? 1 : 0;
  const p = prog();
  const prevBest = p.best[g.mode.id] || 0;
  const record = g.score > prevBest;
  if (record) p.best[g.mode.id] = g.score;
  p.stars += stars * 5; p.played++;
  save();
  sfx.play('finish');
  if (stars >= 2) confetti();
  const secs = Math.round((Date.now() - g.startedAt) / 1000);
  const missed = [...g.missed].map(id => typeof id === 'string' && id.startsWith('f:') ? { ...byFid.get(id.slice(2)), learnKey: id }
    : typeof id === 'string' && id.startsWith('r:') ? { ...byRid.get(id.slice(2)), learnKey: id } : { ...byId.get(id), learnKey: id });
  const title = stars === 3 ? 'Muhteşem!' : stars === 2 ? 'Çok iyi!' : stars === 1 ? 'Güzel başlangıç!' : 'Biraz daha pratik!';
  $('#resultBody').innerHTML = `
    <div class="result-stars">${[1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : ''}" style="--d:${i * 0.15}s">★</span>`).join('')}</div>
    <h2>${title}</h2>
    ${record ? '<p class="record">🏆 Yeni rekor!</p>' : ''}
    <div class="result-grid">
      <div><b>${fmt(g.score)}</b><small>Puan</small></div>
      <div><b>${g.correct}${g.mode.id === 'timed' ? '' : '/' + total}</b><small>İlk denemede doğru</small></div>
      <div><b>🔥 ${g.bestStreak}</b><small>En uzun seri</small></div>
      <div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b><small>Süre</small></div>
    </div>
    <p class="earned">+${stars * 5} ⭐ kazandın</p>
    ${missed.length ? `<h4>📚 Tekrar çalışalım</h4><div class="chips small center">${missed.map(m => `<button class="chip" data-learn="${m.learnKey}">${m.name}</button>`).join('')}</div>` : '<p>Hiç hata yapmadın! 👏</p>'}
    <div class="modal-actions">
      <button class="ghost-btn" id="rMenu">Menü</button>
      <button class="primary-btn" id="rAgain">Tekrar oyna</button>
    </div>`;
  const dlg = $('#result');
  dlg.showModal();
  $('#rMenu').onclick = () => { dlg.close(); goHome(); };
  $('#rAgain').onclick = () => { dlg.close(); startGame(g.mode.id); };
  dlg.querySelectorAll('[data-learn]').forEach(b => b.onclick = () => {
    dlg.close();
    const key = b.dataset.learn;
    if (key.startsWith('r:')) {
      const r = byRid.get(key.slice(2));
      view.clear('target', 'hint', 'region-hint', 'center', 'peek');
      showResourceOnMap(r);
      openResourceInfo(r);
      $('#promptText').innerHTML = `📚 ${r.icon} <b>${r.name}</b> <button class="small-btn" id="backToResult">← Sonuçlar</button>`;
      $('#backToResult').onclick = () => { closeInfo(); dlg.showModal(); };
      return;
    }
    if (key.startsWith('f:')) {
      const f = byFid.get(key.slice(2));
      view.clear('target', 'hint', 'region-hint', 'center', 'peek'); view.clearFeatures('target');
      view.setFeature(f.id, 'target'); f.provinces.forEach(p => view.set(p, 'peek'));
      view.fitFeature(f.id);
      openFeatureInfo(f);
      $('#promptText').innerHTML = `📚 <b>${f.name}</b> <button class="small-btn" id="backToResult">← Sonuçlar</button>`;
      $('#backToResult').onclick = () => { closeInfo(); dlg.showModal(); };
      return;
    }
    const it = byId.get(+key);
    view.clear('target', 'hint', 'region-hint', 'center');
    view.fitIds([it.id], 0.6, 260); view.set(it.id, 'hint'); view.bringToFront(it.id);
    openInfo(it);
    $('#promptText').innerHTML = `📚 <b>${it.name}</b> <button class="small-btn" id="backToResult">← Sonuçlar</button>`;
    $('#backToResult').onclick = () => { closeInfo(); dlg.showModal(); };
  });
}

function goHome() {
  if (game) clearInterval(game.timer);
  game = null; voice.stop(); closeInfo();
  renderHome(); show('home');
}

// ---------------------------------------------------------------- konfeti
function confetti() {
  const box = $('#confetti');
  const colors = RAINBOW;
  for (let i = 0; i < 80; i++) {
    const c = el('i');
    c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--dx:${(Math.random() - .5) * 200}px;--r:${Math.random() * 720}deg;animation-delay:${Math.random() * .4}s;animation-duration:${1.6 + Math.random() * 1.2}s`;
    box.append(c);
  }
  setTimeout(() => box.innerHTML = '', 3400);
}

// ---------------------------------------------------------------- ayarlar
function openSettings() {
  const s = store.settings;
  $('#sInfo').checked = s.infoExplore; $('#sInfoQuiz').checked = s.infoQuiz;
  $('#sVoice').checked = s.voice; $('#sSfx').checked = s.sfx;
  $('#sVoice').disabled = !voice.available;
  segSetup('#sColors', s.colors, v => { s.colors = v; save(); });
  segSetup('#sLevel', s.level, v => { s.level = v; save(); $('#levelHelp').textContent = LEVEL_HELP[v]; });
  $('#levelHelp').textContent = LEVEL_HELP[s.level];
  $('#settings').showModal();
}
function applySettings() {
  const s = store.settings;
  s.infoExplore = $('#sInfo').checked; s.infoQuiz = $('#sInfoQuiz').checked;
  s.voice = $('#sVoice').checked; s.sfx = $('#sSfx').checked;
  voice.enabled = s.voice; sfx.enabled = s.sfx;
  save();
  if (game) { view.recolor(); renderLegend(); }
}

// ---------------------------------------------------------------- olaylar
function bindUi() {
  $('#btnSettings').onclick = openSettings;
  $('#settings').addEventListener('close', applySettings);
  $('#btnResetProgress').onclick = () => {
    if (confirm('Tüm yıldızlar, rekorlar ve keşifler silinsin mi?')) { store.progress = {}; save(); renderHome(); $('#settings').close(); }
  };
  $('#btnBack').onclick = goHome;
  $('#btnSpeak').onclick = () => game?.speech && voice.say(game.speech, { force: true });
  $('#btnHint').onclick = () => {
    const g = game; if (!g?.current || g.locked) return;
    if (g.mode.id === 'resources') return resHint();
    if (g.mode.id === 'mines') return mineHint();
    if (g.mode.id === 'nature') {
      const f = g.current; g.streak = 0;
      if (g.hintLevel < 1) { g.hintLevel = 1; view.setFeature(f.id, 'target'); view.fitFeature(f.id); feedback('💡 Parlayan yere bak!', 'info'); }
      else if (g.qType === 'where') { g.hintLevel = 2; view.set(f.provinces[0], 'hint'); feedback('💡 Parlayan il doğru cevaplardan biri!', 'info'); }
      else { g.hintLevel = 2; feedback(`💡 İpucu: ${f.fact.split('.')[0].replace(f.name, '…')}.`, 'info'); }
      updateHud();
      return;
    }
    if (g.mode.id === 'neighbors') {
      const left = g.current.neighbors.filter(n => !g.neighborFound.has(n));
      if (left.length) { view.set(left[0], 'hint'); g.hintLevel = 1; g.streak = 0; }
    } else { showHint(g.hintLevel + 1 > 2 ? 2 : g.hintLevel + 1); g.streak = 0; }
    if (g.hintLevel === 1 && g.mode.id !== 'neighbors') feedback(`💡 ${data.regions[g.current.region].name} Bölgesi'nde`, 'info');
    updateHud();
  };
  $('#btnSkip').onclick = () => {
    const g = game; if (!g || g.locked) return;
    if (g.mode.id === 'explore') return;
    g.streak = 0;
    if (g.mode.id === 'neighbors') {
      g.locked = true; g.missed.add(g.current.id);
      g.current.neighbors.forEach(n => view.set(n, 'hint'));
      feedback(`Komşular: ${g.current.neighbors.map(n => byId.get(n).name).join(', ')}`, 'info');
      setTimeout(() => { if (game === g) next(); }, 2200);
      return;
    }
    if (g.mode.id === 'nature') return natureReveal(g.current, '⏭️ Geçtin.');
    if (g.mode.id === 'resources') return resReveal(g.current, '⏭️ Geçtin.');
    if (g.mode.id === 'mines') return mineReveal('⏭️ Geçtin.');
    reveal(g.current, `⏭️ Geçtin. Burası <b>${g.current.name}</b>.`);
  };
  $('#zIn').onclick = () => view.zoomBy(1.5);
  $('#zOut').onclick = () => view.zoomBy(1 / 1.5);
  $('#zReset').onclick = () => view.reset();
  $('#zLabels').onclick = () => {
    const cycle = game.mode.id === 'explore' ? ['none', 'name', 'code'] : ['nature', 'atlas', 'resources', 'mines'].includes(game.mode.id) ? ['none', 'name'] : ['found', 'none'];
    labelMode = cycle[(cycle.indexOf(labelMode) + 1) % cycle.length];
    refreshLabels();
  };
  $('#zLayers').onclick = e => {
    e.stopPropagation();
    const menu = $('#layerMenu');
    if (menu.classList.toggle('hidden')) return;
    renderLayerMenu();
  };
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#layerMenu, #zLayers')) $('#layerMenu').classList.add('hidden');
  });
  $('#infoClose').onclick = () => { if (closeInfo()) next(); };
  $('#feedback').addEventListener('click', e => {
    const b = e.target.closest('.fb-info'); if (!b) return;
    if (b.dataset.fid) return openFeatureInfo(byFid.get(b.dataset.fid));
    if (b.dataset.rid) return openResourceInfo(byRid.get(b.dataset.rid));
    openInfo(byId.get(+b.dataset.id));
  });
  // Bilgi kartını aşağı kaydırarak kapat (mobil)
  let sy = null;
  const sheet = $('#info');
  sheet.addEventListener('touchstart', e => { sy = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sheet.addEventListener('touchmove', e => { if (sy != null && e.touches[0].clientY - sy > 90) { sy = null; if (closeInfo()) next(); } }, { passive: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#info').classList.contains('open')) { if (closeInfo()) next(); }
  });

  // PWA kurulum düğmesi
  let deferred;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#btnInstall').classList.remove('hidden'); });
  $('#btnInstall').onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; $('#btnInstall').classList.add('hidden'); }
    else alert('iPhone/iPad: Safari\'de Paylaş ⬆️ düğmesine dokunup "Ana Ekrana Ekle"yi seç.');
  };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('#btnInstall').classList.remove('hidden');
}

// ---------------------------------------------------------------- başlat
(async function init() {
  voice.enabled = store.settings.voice; sfx.enabled = store.settings.sfx;
  if (MAPS[store.settings.map]?.comingSoon || !MAPS[store.settings.map]) store.settings.map = 'tr';
  await loadMap(store.settings.map);
  bindUi();
  renderHome();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
