// Harita kataloğu. Yeni bir harita (ör. Dünya) eklemek için buraya bir kayıt ekleyip
// aynı biçimde { viewBox, shapes, items, regions, features?, layerTypes? } döndüren bir yükleyici yazmak yeterli.
export const MAPS = {
  tr: {
    id: 'tr',
    title: 'Türkiye',
    flag: '🇹🇷',
    itemNoun: 'il',             // "il", ileride "ülke"
    codeLabel: 'plaka',         // kod tabanlı oyun modu (plaka) için
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
    comingSoon: true,
  },
};
