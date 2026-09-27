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
  settings: { infoExplore: true, infoQuiz: false, voice: true, sfx: true, colors: 'rainbow', level: 'normal', roundLen: '10', region: 'all', map: 'tr' },
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
  { id: 'find',      icon: '🎯', title: 'İli Bul',        desc: 'Söylenen ili haritada bul.',                  color: '#4F8CFF' },
  { id: 'identify',  icon: '❓', title: 'Bu Hangi İl?',   desc: 'Parlayan ilin adını seç.',                    color: '#A66CFF' },
  { id: 'plate',     icon: '🚗', title: 'Plaka Avı',      desc: 'Plaka numarasından ili bul.',                 color: '#FF8A3D', needs: 'codeLabel' },
  { id: 'neighbors', icon: '🤝', title: 'Komşular',       desc: 'Bir ilin bütün komşularını bul.',             color: '#22C1C3' },
  { id: 'timed',     icon: '⏱️', title: 'Zamana Karşı',   desc: '60 saniyede kaç il bulabilirsin?',            color: '#FF5C8A' },
];
const LEVEL_HELP = {
  easy: 'Kolay: 1 yanlıştan sonra bölge, 2 yanlıştan sonra doğru il gösterilir. 3 seçenek.',
  normal: 'Normal: 2 yanlıştan sonra bölge, 3 yanlıştan sonra doğru il gösterilir. 4 seçenek.',
  hard: 'Zor: Otomatik ipucu yok, harita renksiz başlar, seçenekler komşu illerden gelir.',
};
const RAINBOW = ['#FF6B6B', '#FFB020', '#3DBE6E', '#4F8CFF', '#A66CFF', '#FF5CA8', '#22C1C3', '#F57C3A'];

// ---------------------------------------------------------------- uygulama durumu
let mapDef, data, view, byId, colorMap = new Map();
let game = null;
let labelMode = 'none';

async function loadMap(id) {
  mapDef = MAPS[id];
  data = await mapDef.load();
  byId = new Map(data.items.map(i => [i.id, i]));
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
    if (m.needs && !mapDef[m.needs]) continue;
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
  if (modeId !== 'timed' && modeId !== 'explore') queue = queue.slice(0, len);

  game = {
    mode, items, poolIds: new Set(items.map(i => i.id)), queue, index: -1, current: null,
    score: 0, streak: 0, bestStreak: 0, correct: 0, asked: 0, wrongTries: 0, hintLevel: 0,
    found: new Set(), missed: new Set(), startedAt: Date.now(), timeLeft: 60, locked: false,
  };

  show('game');
  $('#hudTitle').innerHTML = `<span>${mode.icon}</span> ${mode.title}`;
  $('#hudStreakWrap').classList.toggle('hidden', modeId === 'explore');
  $('#btnHint').classList.toggle('hidden', modeId === 'explore' || modeId === 'identify');
  $('#btnSkip').classList.toggle('hidden', modeId === 'explore');
  $('#choices').classList.toggle('hidden', modeId !== 'identify');
  document.body.dataset.mode = modeId;
  document.body.dataset.level = store.settings.level;
  closeInfo();

  // Her oyunda temiz bir <svg> ile başla (eski dinleyiciler birikmesin)
  const oldSvg = $('#map'), svg = oldSvg.cloneNode(false);
  oldSvg.replaceWith(svg);
  view?.destroy();
  view = new MapView(svg, {
    viewBox: data.viewBox, shapes: data.shapes, items: data.items, colorOf,
    onTap: handleTap, onHover: handleHover,
  });
  if (modeId !== 'neighbors') for (const it of data.items) if (!game.poolIds.has(it.id)) view.set(it.id, 'off');
  if (modeId === 'explore') for (const id of prog().discovered) if (game.poolIds.has(id)) { view.set(id, 'found'); game.found.add(id); }
  if (store.settings.region !== 'all') setTimeout(() => view.fitIds([...game.poolIds], 0.08, 100), 60);

  labelMode = modeId === 'explore' ? 'none' : (store.settings.level === 'hard' ? 'none' : 'found');
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

function refreshLabels() { view.setLabels(labelMode, game.found); $('#map').dataset.labels = labelMode; }

function renderLegend() {
  const lg = $('#legend');
  if (store.settings.colors !== 'region') { lg.innerHTML = ''; return; }
  lg.innerHTML = Object.values(data.regions).map(r => `<span><i style="background:${r.color}"></i>${r.name}</span>`).join('');
}

function next() {
  const g = game;
  view.clear('target', 'hint', 'region-hint', 'selected', 'wrong', 'center');
  $('#feedback').className = 'feedback';
  g.wrongTries = 0; g.hintLevel = 0; g.locked = false; g.neighborFound = new Set();

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
  if (!g.poolIds.has(id) && g.mode.id !== 'neighbors') return;

  if (g.mode.id === 'explore') return exploreTap(item);
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

// ---------------------------------------------------------------- bilgi kartı
function openInfo(item, { resume = false } = {}) {
  const r = data.regions[item.region];
  const pop = item.pop >= 1000 ? `${(item.pop / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon` : `${fmt(item.pop)} bin`;
  const neighbors = item.neighbors.map(n => byId.get(n)).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  $('#infoBody').innerHTML = `
    <div class="info-head" style="--c:${colorOf(item)}">
      <span class="plate big">${item.code}</span>
      <div><h3>${item.name}</h3><span class="chip region"><i style="background:${r.color}"></i>${r.name} Bölgesi</span></div>
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
    <div class="info-row"><h4>🗺️ Komşuları</h4><div class="chips small">${neighbors.map(nb => `<button class="chip" data-nb="${nb.id}">${nb.name}</button>`).join('')}</div></div>
    ${resume ? '<button class="primary-btn wide" id="infoContinue">Devam et →</button>' : ''}`;
  $('#infoSpeak').onclick = () => voice.say(`${item.name}. ${r.name} Bölgesinde. Plaka kodu ${item.plate}. ${item.fact} Meşhur lezzetleri: ${item.food}.`, { force: true });
  $('#infoBody').querySelectorAll('[data-nb]').forEach(b => b.onclick = () => {
    const nb = byId.get(+b.dataset.nb);
    if (game?.mode.id === 'explore') exploreTap(nb);
    else { view.flash(nb.id, 'peek', 1400); openInfo(nb, { resume }); }
  });
  if (resume) $('#infoContinue').onclick = () => { closeInfo(); next(); };
  const sheet = $('#info');
  sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false');
  sheet.dataset.resume = resume ? '1' : '';
  sheet.scrollTop = 0;
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
  const missed = [...g.missed].map(id => byId.get(id));
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
    ${missed.length ? `<h4>📚 Tekrar çalışalım</h4><div class="chips small center">${missed.map(m => `<button class="chip" data-learn="${m.id}">${m.name}</button>`).join('')}</div>` : '<p>Hiç hata yapmadın! 👏</p>'}
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
    const it = byId.get(+b.dataset.learn);
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
    reveal(g.current, `⏭️ Geçtin. Burası <b>${g.current.name}</b>.`);
  };
  $('#zIn').onclick = () => view.zoomBy(1.5);
  $('#zOut').onclick = () => view.zoomBy(1 / 1.5);
  $('#zReset').onclick = () => view.reset();
  $('#zLabels').onclick = () => {
    const cycle = game.mode.id === 'explore' ? ['none', 'name', 'code'] : ['found', 'none'];
    labelMode = cycle[(cycle.indexOf(labelMode) + 1) % cycle.length];
    refreshLabels();
  };
  $('#infoClose').onclick = () => { if (closeInfo()) next(); };
  $('#feedback').addEventListener('click', e => {
    const b = e.target.closest('.fb-info'); if (!b) return;
    const it = byId.get(+b.dataset.id);
    openInfo(it);
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
