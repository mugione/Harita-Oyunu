// Harita kataloğu. Yeni bir harita (ör. Dünya) eklemek için buraya bir kayıt ekleyip
// aynı biçimde { viewBox, shapes, items, regions, features?, layerTypes? } döndüren bir yükleyici yazmak yeterli.
export const MAPS = {
  tr: {
    id: 'tr',
    title: 'Türkiye',
    flag: '🇹🇷',
    itemNoun: 'il',
    codeLabel: 'plaka',         // kod tabanlı oyun modu (plaka) için
    // Oyun metinlerinde haritaya göre değişen kelimeler (Türkçe ekleriyle)
    text: {
      one: 'il', pl: 'iller', acc: 'ili', dat: 'ile', gen: 'ilin', regionWord: 'bölge', regionTitle: 'Hangi bölge?',
      region: n => `${n} Bölgesi`, regionLoc: n => `${n} Bölgesi'nde`,
      nbPrompt: n => `<b>${n}</b> ilinin komşularını bul`, nbSpeech: n => `${n} ilinin komşularını bul`, nbDone: n => `<b>${n}</b> ilinin bütün komşularını buldun!`,
      foot: 'Nüfus bilgileri yaklaşıktır (TÜİK 2023). Yüzölçümleri harita verisinden hesaplanmıştır.',
    },
    async load() {
      const [{ VIEWBOX, SHAPES }, { PROVINCES, REGIONS }, { LAYER_SHAPES }, { FEATURES, LAYER_TYPES }, R] = await Promise.all([
        import('./tr-geo.js'), import('./tr-info.js'), import('./tr-layers.js'), import('./tr-layers-info.js'), import('./tr-resources.js'),
      ]);
      const items = PROVINCES.map(p => ({
        ...p,
        id: p.plate,
        code: String(p.plate).padStart(2, '0'),
        area: SHAPES[p.plate].area,
        neighbors: SHAPES[p.plate].neighbors,
        vegetation: R.VEGETATION[p.plate]?.[0],
        vegetationNote: R.VEGETATION[p.plate]?.[1],
        industry: R.INDUSTRY[p.plate],
      }));
      // Coğrafi katmanlar: dağlar, göller, nehirler, denizler
      const features = FEATURES.map(f => ({ ...f, ...LAYER_SHAPES[f.id] }));
      // Ekonomik zenginlikler ve bitki örtüsü
      for (const [id, info] of Object.entries(R.REGION_INFO)) Object.assign(REGIONS[id], info);
      return {
        viewBox: VIEWBOX, shapes: SHAPES, items, regions: REGIONS, features, layerTypes: LAYER_TYPES,
        resources: R.RESOURCES, resourceCats: R.RESOURCE_CATEGORIES, vegTypes: R.VEGETATION_TYPES,
      };
    },
  },
  world: {
    id: 'world',
    title: 'Dünya',
    flag: '🌍',
    itemNoun: 'ülke',
    text: {
      one: 'ülke', pl: 'ülkeler', acc: 'ülkeyi', dat: 'ülkeye', gen: 'ülkenin', regionWord: 'kıta', regionTitle: 'Hangi kıta?',
      region: n => `${n} kıtası`, regionLoc: n => `${n} kıtasında`,
      nbPrompt: n => `<b>${n}</b> ile komşu olan ülkeleri bul`, nbSpeech: n => `${n} ile komşu olan ülkeleri bul`, nbDone: n => `<b>${n}</b> ile komşu olan bütün ülkeleri buldun!`,
      foot: 'Nüfuslar yaklaşıktır (2019 tahmini). Yüzölçümleri harita verisinden hesaplanmıştır. Tartışmalı bölgelerde Türkiye\'nin resmî tutumu esas alınmıştır.',
    },
    async load() {
      const [{ VIEWBOX, SHAPES, BACKDROP, REGION_BB }, { COUNTRIES, CONTINENTS }] = await Promise.all([
        import('./world-geo.js'), import('./world-info.js'),
      ]);
      const items = COUNTRIES.map(c => ({ ...c, area: SHAPES[c.id].area, neighbors: SHAPES[c.id].neighbors }));
      for (const [id, bb] of Object.entries(REGION_BB)) CONTINENTS[id].bb = bb;
      // Küçük ülkeler (Vatikan, Tuvalu…) için daha derin yakınlaştırma; soru görünümleri de daha yakın
      return { viewBox: VIEWBOX, shapes: SHAPES, items, regions: CONTINENTS, backdrop: BACKDROP, maxZoom: 40, zoomScale: 0.5, labelMin: 1.6 };
    },
  },
};
