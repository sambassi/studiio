import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ApercuMontageListe from '@/components/creer/ApercuMontageListe';
import { etapesMontageApercuAutopilote, type ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';
import type { MediaStockRetenu } from '@/lib/autopilot/sources';

/**
 * APERÇU DU MONTAGE PRÉVU — chaque créneau du plan devient une étape, dans
 * l'ordre, avec rotation des rushes et du stock ; l'avatar reste un
 * emplacement (jamais un stock à sa place).
 */

const ORIGINE = 'https://studiio.pro/storage/v1/object/public/media/u1';
const RUSH = `${ORIGINE}/plage.mp4`;
const RUSH_2 = `${ORIGINE}/salle.mp4`;
const STOCK_V = `${ORIGINE}/library/stock-pexels-video-77.mp4`;
const PHOTO = 'https://images.pexels.com/photos/9/p.jpg';

const retenu = (url: string, type: 'video' | 'photo'): MediaStockRetenu => ({
  url, type, provider: 'pexels', providerAssetId: '1', auteur: 'X', sourceUrl: '', licence: 'Pexels License', vignetteUrl: `${url}.jpg`,
});

function resume(o: Partial<ResumeMediasApercu> = {}): ResumeMediasApercu {
  return {
    gabarit: [],
    actives: { rushes: true, avatar: false, stock: false },
    rushesPerso: [],
    stock: [],
    avatar: { disponible: false, vignette: null },
    ...o,
  };
}

describe('etapesMontageApercuAutopilote', () => {
  it('sans résumé : aucune étape, aucune ligne', () => {
    expect(etapesMontageApercuAutopilote(null, { dureeCta: 4 })).toEqual({ etapes: [], lignes: [], duree: 0 });
  });

  it('tous les créneaux, dans l’ordre, contigus, puis le CTA en fondu', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'rush' }, { id: 'c', type: 'stock' }, { id: 'd', type: 'avatar' }],
      actives: { rushes: true, avatar: true, stock: true },
      rushesPerso: [RUSH],
      stock: [retenu(PHOTO, 'photo')],
      avatar: { disponible: true, vignette: null },
    }), { dureeCta: 4 });
    expect(r.etapes.map((e) => e.source)).toEqual(['avatar', 'rush', 'stock-photo', 'avatar']);
    for (let i = 1; i < r.etapes.length; i += 1) expect(r.etapes[i].debut).toBe(r.etapes[i - 1].fin);
    const cta = r.lignes[r.lignes.length - 1];
    expect(cta).toMatchObject({ id: 'cta', cta: true, debut: r.duree, fin: r.duree + 4 });
    expect(cta.fondu).toBeGreaterThan(0);
    expect(r.etapes[2].mouvement).toBeDefined();
  });

  it('avatar pas encore produit : emplacement url null, jamais un stock à sa place', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'avatar' }],
      actives: { rushes: true, avatar: true, stock: true },
      stock: [retenu(STOCK_V, 'video')],
      avatar: { disponible: false, vignette: null },
    }));
    expect(r.etapes).toHaveLength(1);
    expect(r.etapes[0]).toMatchObject({ source: 'avatar', url: null, libelle: 'Mon avatar' });
  });

  it('source avatar décochée : le créneau avatar est omis', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'rush' }],
      rushesPerso: [RUSH],
    }));
    expect(r.etapes.map((e) => e.source)).toEqual(['rush']);
  });

  it('rotation des rushes (pas toujours le premier), média imposé respecté', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'rush' }, { id: 'b', type: 'rush' }, { id: 'c', type: 'rush' }, { id: 'd', type: 'rush', media: RUSH_2 }],
      rushesPerso: [RUSH, RUSH_2],
    }));
    expect(r.etapes.map((e) => e.url)).toEqual([RUSH, RUSH_2, RUSH, RUSH_2]);
    expect(r.etapes[1].libelle).toBe('Rush : salle.mp4');
  });

  it('rotation du stock et rush stock jamais pris pour un rush personnel', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'stock' }, { id: 'b', type: 'stock' }, { id: 'c', type: 'rush' }],
      actives: { rushes: true, avatar: false, stock: true },
      rushesPerso: [STOCK_V],
      stock: [retenu(STOCK_V, 'video'), retenu(PHOTO, 'photo')],
    }));
    expect(r.etapes.map((e) => [e.source, e.url])).toEqual([['stock-video', STOCK_V], ['stock-photo', PHOTO]]);
  });

  it('auto : avatar prêt, sinon rush suivant, sinon stock suivant', () => {
    const base = { gabarit: [{ id: 'a', type: 'auto' as const }, { id: 'b', type: 'auto' as const }], stock: [retenu(PHOTO, 'photo')] };
    const avecAvatar = etapesMontageApercuAutopilote(resume({
      ...base, actives: { rushes: true, avatar: true, stock: true }, rushesPerso: [RUSH], avatar: { disponible: true, vignette: null },
    }));
    expect(avecAvatar.etapes.map((e) => e.source)).toEqual(['avatar', 'avatar']);
    const sansAvatar = etapesMontageApercuAutopilote(resume({
      ...base, actives: { rushes: true, avatar: true, stock: true }, rushesPerso: [RUSH],
    }));
    expect(sansAvatar.etapes.map((e) => e.source)).toEqual(['rush', 'rush']);
    const stockSeul = etapesMontageApercuAutopilote(resume({ ...base, actives: { rushes: false, avatar: false, stock: true }, rushesPerso: [RUSH] }));
    expect(stockSeul.etapes.map((e) => e.source)).toEqual(['stock-photo', 'stock-photo']);
  });

  it('source rushes / stock décochée : rien de ces sources', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'rush' }, { id: 'b', type: 'stock' }],
      actives: { rushes: false, avatar: false, stock: false },
      rushesPerso: [RUSH],
      stock: [retenu(PHOTO, 'photo')],
    }), { dureeCta: 4 });
    expect(r).toEqual({ etapes: [], lignes: [], duree: 0 });
  });
});

describe('Aperçu du montage prévu — rendu', () => {
  afterEach(() => cleanup());
  it('titre dédié, chronologie de TOUS les créneaux puis CTA, avatar en emplacement', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'rush' }, { id: 'c', type: 'rush' }],
      actives: { rushes: true, avatar: true, stock: false },
      rushesPerso: [RUSH, RUSH_2],
    }), { dureeCta: 4 });
    const { container } = render(
      <ApercuMontageListe etapes={r.etapes} lignes={r.lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens" vignetteAvatar={null} titre="Aperçu du montage prévu" />,
    );
    expect(container.querySelector('h3')!.textContent).toBe('Aperçu du montage prévu');
    expect([...container.querySelectorAll('[data-ligne]')].map((b) => b.getAttribute('data-ligne'))).toEqual(['creneau-1', 'creneau-2', 'creneau-3', 'cta']);
    expect(container.querySelector('[data-apercu-montage-avatar="a-produire"]')!.textContent).toContain('Votre avatar parlera ici');
  });

  it('sans titre : l’en-tête d’avant (Créer inchangé)', () => {
    const { container } = render(<ApercuMontageListe etapes={[]} lignes={[]} format="9:16" accent="#7C3AED" />);
    expect(container.querySelector('h3')!.textContent).toBe('Aperçu du montage');
    expect(container.textContent).toContain("Séquence Vidéo dans l'ordre de la liste, puis le CTA.");
  });
});
