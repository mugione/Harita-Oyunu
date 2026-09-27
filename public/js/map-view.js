// Dokunma, sürükleme ve yakınlaştırma destekli SVG harita bileşeni.
// Haritadan bağımsızdır: Türkiye ya da ileride Dünya haritası aynı bileşeni kullanır.
const NS = 'http://www.w3.org/2000/svg';
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

export class MapView {
  constructor(svg, { viewBox, shapes, items, colorOf, onTap, onHover }) {
    this.svg = svg;
    this.bounds = { x: viewBox[0], y: viewBox[1], w: viewBox[2], h: viewBox[3] };
    this.vb = { ...this.bounds };
    this.shapes = shapes;
    this.items = items;
    this.colorOf = colorOf;
    this.onTap = onTap;
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

      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', s.cx);
      t.setAttribute('y', s.cy);
      t.dataset.name = item.name;
      t.dataset.code = item.code ?? '';
      t.style.setProperty('--lr', s.lr);
      this.gLabels.append(t);
      this.labels.set(item.id, t);
    }
    const shadowWrap = document.createElementNS(NS, 'g');
    shadowWrap.setAttribute('filter', 'url(#shadow)');
    shadowWrap.append(this.gShapes);
    this.svg.append(shadowWrap, this.gLabels);
  }

  destroy() { this._ro?.disconnect(); cancelAnimationFrame(this._raf); }

  recolor() {
    for (const item of this.items) this.paths.get(item.id)?.style.setProperty('--c', this.colorOf(item));
  }

  // ---- durum sınıfları ----
  set(id, cls, on = true) { this.paths.get(id)?.classList.toggle(cls, on); }
  clear(...classes) { for (const p of this.paths.values()) p.classList.remove(...classes); }
  flash(id, cls, ms = 900) {
    const p = this.paths.get(id); if (!p) return;
    p.classList.remove(cls); void p.getBBox(); p.classList.add(cls);
    clearTimeout(p['_t' + cls]);
    p['_t' + cls] = setTimeout(() => p.classList.remove(cls), ms);
  }
  bringToFront(id) { const p = this.paths.get(id); if (p) this.gShapes.append(p); }

  // mode: 'none' | 'name' | 'code' | 'found'
  setLabels(mode, foundSet) {
    for (const [id, t] of this.labels) {
      let txt = '';
      if (mode === 'name') txt = t.dataset.name;
      else if (mode === 'code') txt = t.dataset.code;
      else if (mode === 'found' && foundSet?.has(id)) txt = t.dataset.name;
      t.textContent = txt;
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
    const boost = clampN((h * 0.55) / mapPxH, 1, w < 560 ? 1.7 : 1);
    return this.scaled(home, 1 / boost);
  }
  scaled(v, k) {
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const w = v.w * k, h = v.h * k;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  clamp(v) {
    const home = this.homeVb(), a = this.aspect(), b = this.bounds;
    v.w = clampN(v.w, home.w / 14, home.w * 1.05);
    v.h = v.w * a;
    // Görünümün merkezi harita sınırları içinde kalsın
    const minX = Math.min(b.x - v.w / 2 + v.w * 0.2, home.x), maxX = Math.max(b.x + b.w - v.w / 2 - v.w * 0.2, home.x);
    const minY = Math.min(b.y - v.h / 2 + v.h * 0.2, home.y), maxY = Math.max(b.y + b.h - v.h / 2 - v.h * 0.2, home.y);
    v.x = clampN(v.x, Math.min(minX, maxX), Math.max(minX, maxX));
    v.y = clampN(v.y, Math.min(minY, maxY), Math.max(minY, maxY));
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
    const nw = clampN(v.w / factor, home.w / 14, home.w * 1.05);
    const k = nw / v.w;
    v.x = p.x - (p.x - v.x) * k; v.y = p.y - (p.y - v.y) * k; v.w = nw;
    this.view = this.clamp(v);
  }
  zoomBy(factor) { this.animateTo(this.clamp(this.scaled(this.vb, 1 / factor)), 250); }
  reset() { this.animateTo(this.clamp(this.homeVb())); }
  fitIds(ids, padRatio = 0.25, minW = 160) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const b = this.paths.get(id)?.getBBox(); if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
    if (!isFinite(x0)) return this.reset();
    const pw = (x1 - x0) * padRatio, ph = (y1 - y0) * padRatio;
    let rect = { x: x0 - pw, y: y0 - ph, w: x1 - x0 + 2 * pw, h: y1 - y0 + 2 * ph };
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
        const id = this.idAt(e.clientX, e.clientY);
        if (id != null) this.onTap?.(id);
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
  idAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (el?.classList?.contains('shape') && !el.classList.contains('off')) return Number(el.dataset.id);
    return null;
  }
}
