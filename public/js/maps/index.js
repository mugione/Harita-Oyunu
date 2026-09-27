// Harita kataloğu. Yeni bir harita (ör. Dünya) eklemek için buraya bir kayıt ekleyip
// aynı biçimde { viewBox, shapes, items, regions } döndüren bir yükleyici yazmak yeterli.
export const MAPS = {
  tr: {
    id: 'tr',
    title: 'Türkiye',
    flag: '🇹🇷',
    itemNoun: 'il',             // "il", ileride "ülke"
    codeLabel: 'plaka',         // kod tabanlı oyun modu (plaka) için
    async load() {
      const [{ VIEWBOX, SHAPES }, { PROVINCES, REGIONS }] = await Promise.all([
        import('./tr-geo.js'), import('./tr-info.js'),
      ]);
      const items = PROVINCES.map(p => ({
        ...p,
        id: p.plate,
        code: String(p.plate).padStart(2, '0'),
        area: SHAPES[p.plate].area,
        neighbors: SHAPES[p.plate].neighbors,
      }));
      return { viewBox: VIEWBOX, shapes: SHAPES, items, regions: REGIONS };
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
