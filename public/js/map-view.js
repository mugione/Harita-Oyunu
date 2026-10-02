// Dokunma, sürükleme ve yakınlaştırma destekli SVG harita bileşeni.
// Haritadan bağımsızdır: Türkiye ya da ileride Dünya haritası aynı bileşeni kullanır.
const NS = 'http://www.w3.org/2000/svg';
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export class MapView {
  constructor(svg, { viewBox, shapes, items, features = [], backdrop = [], maxZoom = 14, labelMin = 4.5, colorOf, onTap, onFeatureTap, onBackdropTap, onHover }) {
    this.svg = svg;
    this.bounds = { x: viewBox[0], y: viewBox[1], w: viewBox[2], h: viewBox[3] };
    this.vb = { ...this.bounds };
    this.shapes = shapes;
    this.items = items;
    this.colorOf = colorOf;
    this.onTap = onTap;
    this.onFeatureTap = onFeatureTap;
    this.onBackdropTap = onBackdropTap;
    this.backdrop = backdrop;
    this.maxZoom = maxZoom;
    this.labelMin = labelMin;
    this.dots = new Map();
    this.features = features;
    this.featureEls = new Map();
    this.onHover = onHover;
    this.paths = new Map();
    this.labels = new Map();
    this.pointers = new Map();
    this.render();
    this.bind();
    this._ro = new ResizeObserver(() => this.onResize());
    this._ro.observe(svg);
  }

  render() {
    this.svg.innerHTML = '';
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = `<filter id="shadow" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#0b1a3a" flood-opacity=".22"/></filter>`;
    this.svg.append(defs);
    this.gShapes = document.createElementNS(NS, 'g');
    this.gShapes.setAttribute('class', 'shapes');
    this.gLabels = document.createElementNS(NS, 'g');
    this.gLabels.setAttribute('class', 'labels');
    for (const item of this.items) {
      const s = this.shapes[item.id];
      if (!s) continue;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', s.d);
      p.dataset.id = item.id;
      p.style.setProperty('--c', this.colorOf(item));
      p.classList.add('shape');
      this.gShapes.append(p);
      this.paths.set(item.id, p);
      if (s.tiny) this.dots.set(item.id, this.renderDot(item, s));

      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', s.cx);
      t.setAttribute('y', s.cy);
      t.dataset.name = item.short || item.name;
      t.dataset.code = item.code ?? '';
      t.style.setProperty('--lr', s.lr);
      t.dataset.cw = s.cw ?? s.lr * 2;
      this.gLabels.append(t);
      this.labels.set(item.id, t);
    }
    const shadowWrap = document.createElementNS(NS, 'g');
    shadowWrap.setAttribute('filter', 'url(#shadow)');
    // Ülke olmayan bölgeler (Grönland, Antarktika…) gri çizilir; dokununca ne olduklarını söyler
    if (this.backdrop.length) {
      const gb = document.createElementNS(NS, 'g');
      gb.setAttribute('class', 'backdrop');
      for (const b of this.backdrop) {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', b.d);
        p.dataset.bid = b.id;
        gb.append(p);
      }
      shadowWrap.append(gb);
    }
    shadowWrap.append(this.gShapes);
    this.gMarkers = document.createElementNS(NS, 'g');
    this.gMarkers.setAttribute('class', 'markers');
    this.gDots = document.createElementNS(NS, 'g');
    this.gDots.setAttribute('class', 'dots');
    this.gDots.append(...this.dots.values());
    this.svg.append(shadowWrap, this.renderLayers(), this.gDots, this.gMarkers, this.gLabels);
  }

  // Parmakla seçilemeyecek kadar küçük ülkeler için ekranda sabit boyutlu dokunma noktası
  renderDot(item, s) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${s.cx} ${s.cy})`);
    g.setAttribute('class', 'dot');
    g.dataset.id = item.id;
    g.style.setProperty('--c', this.colorOf(item));
    g.style.setProperty('--lr', s.lr);
    g.innerHTML = '<g class="pin"><circle class="dot-hit" r="11"/><circle class="dot-mark" r="4.5"/></g>';
    return g;
  }

  // Coğrafi katmanlar: göller, nehirler, dağlar, denizler (il şekillerinin üstünde, il etiketlerinin altında)
  renderLayers() {
    const root = document.createElementNS(NS, 'g');
    root.setAttribute('class', 'layers');
    const groups = {};
    for (const t of ['sea', 'lake', 'river', 'mountain']) {
      groups[t] = document.createElementNS(NS, 'g');
      groups[t].setAttribute('class', 'layer layer-' + t);
      root.append(groups[t]);
    }
    const mk = (tag, attrs, parent) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.append(e);
      return e;
    };
    for (const f of this.features) {
      const g = mk('g', { class: 'feature ' + f.type + (f.kind === 'Boğaz' ? ' strait' : ''), 'data-fid': f.id }, groups[f.type]);
      g.style.setProperty('--lr', f.lr);
      if (f.type === 'lake') {
        mk('path', { d: f.d, class: 'lake-shape' }, g);
        mk('text', { x: f.x, y: f.y, class: 'flabel' }, g).textContent = f.name.replace(/ (Gölü|Baraj Gölü)$/, '');
      } else if (f.type === 'river') {
        mk('path', { d: f.d, class: 'river-hit' }, g);
        mk('path', { d: f.d, class: 'river-line' }, g);
        mk('text', { x: f.x, y: f.y, class: 'flabel' }, g).textContent = f.name;
      } else {
        // Nokta işaretleri ekranda sabit boyutta çizilir (1 / ölçek)
        const at = mk('g', { transform: `translate(${f.x} ${f.y})` }, g);
        const pin = mk('g', { class: 'pin' }, at);
        if (f.type === 'mountain') {
          mk('path', { d: 'M0 -12L11 7H-11Z', class: 'peak-body' }, pin);
          mk('path', { d: 'M0 -12L4.6 -4L2 -5.5L0 -3L-2 -5.5L-4.6 -4Z', class: 'peak-snow' }, pin);
          mk('circle', { r: 16, class: 'pin-hit' }, pin);
          mk('text', { y: 20, class: 'flabel' }, pin).textContent = f.name.replace(/ \(.*\)$/, '');
        } else if (f.kind === 'Boğaz') {
          mk('circle', { r: 5, class: 'strait-dot' }, pin);
          mk('circle', { r: 14, class: 'pin-hit' }, pin);
          mk('text', { y: 17, class: 'flabel' }, pin).textContent = f.name;
        } else {
          const t = mk('text', { class: 'sea-label' }, pin);
          t.textContent = f.name;
          if (f.rotate) t.setAttribute('transform', `rotate(${f.rotate})`);
        }
      }
      this.featureEls.set(f.id, g);
    }
    return root;
  }

  // İllerin üzerine simge koy (ör. 🌰 fındık üreten iller). list: [{ id, text, cls? }]
  setMarkers(list = []) {
    this.gMarkers.innerHTML = '';
    for (const { id, text, cls } of list) {
      const s = this.shapes[id]; if (!s) continue;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('transform', `translate(${s.cx} ${s.cy})`);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('class', 'marker' + (cls ? ' ' + cls : ''));
      t.textContent = text;
      g.append(t);
      this.gMarkers.append(g);
    }
  }
  // İli belirli bir renge boya (vurgulama ve bitki örtüsü haritası için)
  paint(id, color) {
    const p = this.paths.get(id); if (!p) return;
    if (color) { p.style.setProperty('--hl', color); p.classList.add('painted'); }
    else { p.style.removeProperty('--hl'); p.classList.remove('painted'); }
  }
  unpaintAll() { for (const id of this.paths.keys()) this.paint(id, null); }

  // Görünür katman türleri: ör. ['lake', 'river']
  setLayers(types) {
    for (const t of ['mountain', 'lake', 'river', 'sea']) this.svg.classList.toggle('show-' + t, types.includes(t));
  }
  setFeature(fid, cls, on = true) { this.featureEls.get(fid)?.classList.toggle(cls, on); }
  clearFeatures(...classes) { for (const e of this.featureEls.values()) e.classList.remove(...classes); }
  fitFeature(fid, padRatio = 0.6, minW = 180) {
    const e = this.featureEls.get(fid); if (!e) return;
    const f = this.features.find(x => x.id === fid);
    if (f.type === 'lake' || f.type === 'river') {
      const b = e.querySelector('path').getBBox();
      this.fitRect({ x: b.x, y: b.y, w: b.width, h: b.height }, padRatio, minW);
    } else this.fitRect({ x: f.x - 1, y: f.y - 1, w: 2, h: 2 }, 0, minW * 1.4);
  }

  destroy() { this._ro?.disconnect(); cancelAnimationFrame(this._raf); }

  recolor() {
    for (const item of this.items) {
      this.paths.get(item.id)?.style.setProperty('--c', this.colorOf(item));
      this.dots.get(item.id)?.style.setProperty('--c', this.colorOf(item));
    }
  }

  // ---- durum sınıfları ----
  // Küçük ülkelerin dokunma noktası da ülkeyle aynı durum sınıflarını taşır
  set(id, cls, on = true) { this.paths.get(id)?.classList.toggle(cls, on); this.dots.get(id)?.classList.toggle(cls, on); }
  clear(...classes) { for (const p of this.paths.values()) p.classList.remove(...classes); for (const d of this.dots.values()) d.classList.remove(...classes); }
  flash(id, cls, ms = 900) {
    for (const p of [this.paths.get(id), this.dots.get(id)]) {
      if (!p) continue;
      p.classList.remove(cls); void p.getBBox(); p.classList.add(cls);
      clearTimeout(p['_t' + cls]);
      p['_t' + cls] = setTimeout(() => p.classList.remove(cls), ms);
    }
  }
  bringToFront(id) {
    const p = this.paths.get(id); if (p) this.gShapes.append(p);
    const d = this.dots.get(id); if (d) this.gDots.append(d);
  }

  // mode: 'none' | 'name' | 'code' | 'found' | 'all' (bütün adlar, ilin içine sığdırılmış)
  setLabels(mode, foundSet) {
    for (const [id, t] of this.labels) {
      let txt = '';
      if (mode === 'name' || mode === 'all') txt = t.dataset.name;
      else if (mode === 'code') txt = t.dataset.code;
      else if (mode === 'found' && foundSet?.has(id)) txt = t.dataset.name;
      t.textContent = txt;
    }
    if (mode === 'all') this.fitLabels();
  }
  // Her adı kendi ilinin genişliğine sığacak boyutta yaz (harita birimi cinsinden; yakınlaştıkça büyür)
  fitLabels() {
    for (const [id, t] of this.labels) {
      t.style.setProperty('--fs', 10);
      const w = t.getComputedTextLength() || t.textContent.length * 5.5;
      const lr = +t.style.getPropertyValue('--lr'), cw = +t.dataset.cw;
      const fs = Math.max(this.labelMin, Math.min(10 * cw * 1.1 / w, lr * 1.3, 13));
      t.style.setProperty('--fs', fs.toFixed(2));
    }
  }

  // ---- görünüm (viewBox her zaman öğenin en-boy oranında tutulur) ----
  size() { const r = this.svg.getBoundingClientRect(); return { w: r.width || 1, h: r.height || 1, r }; }
  aspect() { const { w, h } = this.size(); return h / w; }
  contain(rect) {
    const a = this.aspect();
    let w = rect.w, h = rect.h;
    if (h / w < a) h = w * a; else w = h / a;
    return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
  }
  homeVb() { return this.contain(this.bounds); }
  // Dar/dikey ekranlarda haritayı başlangıçta biraz yakın göster ki iller parmakla seçilebilsin
  startVb() {
    const home = this.homeVb();
    const { w, h } = this.size();
    const mapPxH = h * (this.bounds.h / home.h);
    const boost = clampN((h * 0.55) / mapPxH, 1, w < 560 ? (this.startBoost || 1.7) : 1);
    return this.scaled(home, 1 / boost);
  }
  scaled(v, k) {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const w = v.w * k, h = v.h * k;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  clamp(v) {
    const home = this.homeVb(), a = this.aspect(), b = this.bounds;
    v.w = clampN(v.w, home.w / this.maxZoom, home.w * 1.05);
    v.h = v.w * a;
    // Harita görünümden büyükse kenarlarda en fazla %8 boşluk kalsın; küçükse haritayı ortala
    const axis = (pos, size, start, len) => {
      if (size >= len * 1.16) return start + len / 2 - size / 2;
      return clampN(pos, start - size * 0.08, start + len - size * 0.92);
    };
    v.x = axis(v.x, v.w, b.x, b.w);
    v.y = axis(v.y, v.h, b.y, b.h);
    return v;
  }
  set view(v) {
    this.vb = v;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    const { w } = this.size();
    this.svg.style.setProperty('--s', (w / v.w).toFixed(4));
  }
  animateTo(target, ms = 450) {
    const from = { ...this.vb }, start = performance.now();
    cancelAnimationFrame(this._raf);
    const step = now => {
      const t = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - t, 3);
      const v = {};
      for (const k of ['x', 'y', 'w', 'h']) v[k] = from[k] + (target[k] - from[k]) * e;
      this.view = v;
      if (t < 1) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }
  onResize() {
    const { w } = this.size();
    if (w < 2) return;
    if (!this._sized) { this._sized = true; this.view = this.clamp(this.startVb()); return; }
    const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2;
    const v = { w: this.vb.w, h: this.vb.w * this.aspect() };
    v.x = cx - v.w / 2; v.y = cy - v.h / 2;
    this.view = this.clamp(v);
  }
  clientToSvg(cx, cy) {
    const { r } = this.size();
    const scale = r.width / this.vb.w;
    return { x: this.vb.x + (cx - r.left) / scale, y: this.vb.y + (cy - r.top) / scale, scale };
  }
  zoomAt(factor, cx, cy) {
    cancelAnimationFrame(this._raf);
    const p = this.clientToSvg(cx, cy), v = { ...this.vb };
    const home = this.homeVb();
    const nw = clampN(v.w / factor, home.w / this.maxZoom, home.w * 1.05);
    const k = nw / v.w;
    v.x = p.x - (p.x - v.x) * k; v.y = p.y - (p.y - v.y) * k; v.w = nw;
    this.view = this.clamp(v);
  }
  zoomBy(factor) { this.animateTo(this.clamp(this.scaled(this.vb, 1 / factor)), 250); }
  reset() { this.animateTo(this.clamp(this.homeVb())); }
  fitIds(ids, padRatio = 0.25, minW = 160) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      // Uzak denizaşırı parçalar (ör. Fransız Guyanası) yakınlaştırmayı bozmasın diye varsa odak kutusu kullanılır
      const bb = this.shapes[id]?.bb;
      const b = bb ? { x: bb[0], y: bb[1], width: bb[2], height: bb[3] } : this.paths.get(id)?.getBBox(); if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
    if (!isFinite(x0)) return this.reset();
    this.fitRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, padRatio, minW);
  }
  fitRect(r, padRatio, minW) {
    const pw = r.w * padRatio, ph = r.h * padRatio;
    const rect = { x: r.x - pw, y: r.y - ph, w: r.w + 2 * pw, h: r.h + 2 * ph };
    if (rect.w < minW) { rect.x -= (minW - rect.w) / 2; rect.w = minW; }
    this.animateTo(this.clamp(this.contain(rect)));
  }

  // ---- etkileşim ----
  bind() {
    const svg = this.svg;
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX, e.clientY);
    }, { passive: false });

    svg.addEventListener('pointerdown', e => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 1) this.moved = false;
      if (this.pointers.size === 2) { this.pinch = this.pinchState(); this.moved = true; }
    });
    svg.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse' && this.onHover) this.onHover(this.idAt(e.clientX, e.clientY), e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (!this.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) {
        this.moved = true;
        try { svg.setPointerCapture(e.pointerId); } catch {}
      }
      if (this.pointers.size === 1 && this.moved) {
        cancelAnimationFrame(this._raf);
        const s = this.clientToSvg(0, 0).scale;
        const v = { ...this.vb }; v.x -= dx / s; v.y -= dy / s;
        this.view = this.clamp(v);
        svg.classList.add('dragging');
      } else if (this.pointers.size === 2 && this.pinch) {
        const now = this.pinchState();
        this.zoomAt(now.d / this.pinch.d, now.cx, now.cy);
        const s = this.clientToSvg(0, 0).scale;
        const v = { ...this.vb }; v.x -= (now.cx - this.pinch.cx) / s; v.y -= (now.cy - this.pinch.cy) / s;
        this.view = this.clamp(v);
        this.pinch = now;
      }
    });
    const end = e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) svg.classList.remove('dragging');
      if (e.type === 'pointerup' && !this.moved && this.pointers.size === 0) {
        const hit = this.hitAt(e.clientX, e.clientY);
        if (hit?.fid) this.onFeatureTap?.(hit.fid);
        else if (hit?.id != null) this.onTap?.(hit.id);
        else if (hit?.bid) this.onBackdropTap?.(hit.bid);
      }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.pointers.size) this.onHover?.(null); });
  }
  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
  hitAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const f = el?.closest?.('[data-fid]');
    if (f) return { fid: f.dataset.fid };
    const dot = el?.closest?.('.dot');
    if (dot && !dot.classList.contains('off')) return { id: Number(dot.dataset.id) };
    if (el?.classList?.contains('shape') && !el.classList.contains('off')) return { id: Number(el.dataset.id) };
    if (el?.dataset?.bid) return { bid: el.dataset.bid };
    return null;
  }
  idAt(x, y) { return this.hitAt(x, y)?.id ?? null; }
}
