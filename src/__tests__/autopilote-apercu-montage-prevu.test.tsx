import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ApercuMontageListe from '@/components/creer/ApercuMontageListe';
import PlanAvantGeneration from '@/components/creer/PlanAvantGeneration';
import { etapesMontageApercuAutopilote, type ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';
import { planCompletAutopilote } from '@/lib/autopilot/plan-complet';
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

describe('etapesMontageApercuAutopilote = planCompletAutopilote (le plan de « Plan avant génération »)', () => {
  it('sans résumé ou plan vide : aucune étape', () => {
    expect(etapesMontageApercuAutopilote(null, { dureeCta: 4 })).toEqual({ etapes: [], lignes: [], duree: 0, avatar: null });
    expect(etapesMontageApercuAutopilote(resume(), { dureeCta: 4 })).toEqual({ etapes: [], lignes: [], duree: 0, avatar: null });
  });

  it('⚠️ plan enregistré à 1 créneau + avatar : étapes == segments (nombre, ordre, genre, durées), puis CTA', () => {
    const plan = { avatarDisponible: true, cible: 30, rythme: null, durees: { [RUSH]: 12 } };
    const r = resume({
      gabarit: [{ id: 's1', type: 'stock' }],
      actives: { rushes: true, avatar: true, stock: true },
      rushesPerso: [RUSH],
      stock: [retenu(PHOTO, 'photo'), retenu(STOCK_V, 'video')],
      avatar: { disponible: true, vignette: null },
      plan,
    });
    const complet = planCompletAutopilote({
      gabarit: r.gabarit, actives: { rushes: true, stock: true, avatar: true },
      rushesPerso: r.rushesPerso, stock: r.stock, avatar: { disponible: true, vignette: null },
    }, { cible: 30, rythme: null, durees: plan.durees });
    const a = etapesMontageApercuAutopilote(r, { dureeCta: 4 });
    // L'alternance complète, pas le seul créneau du gabarit.
    expect(complet.segments.length).toBeGreaterThan(1);
    expect(a.etapes).toHaveLength(complet.segments.length);
    const genre = { avatar: 'avatar', rush: 'rush', video: 'stock-video', photo: 'stock-photo' } as const;
    expect(a.etapes.map((e) => e.source)).toEqual(complet.segments.map((g) => genre[g.genre]));
    expect(a.etapes.map((e) => [e.debut, e.fin])).toEqual(complet.segments.map((g) => [g.debut, g.fin]));
    expect(a.duree).toBe(complet.segments[complet.segments.length - 1].fin);
    // Avatar non produit : emplacement, jamais un stock à sa place.
    for (const e of a.etapes.filter((x) => x.source === 'avatar')) expect(e.url).toBeNull();
    const cta = a.lignes[a.lignes.length - 1];
    expect(cta).toMatchObject({ id: 'cta', cta: true, debut: a.duree, fin: a.duree + 4 });
    expect(a.lignes).toHaveLength(complet.segments.length + 1);
  });

  it('sans avatar : le plan du moteur, médias réels du plan', () => {
    const r = resume({
      gabarit: [{ id: 'a', type: 'rush' }, { id: 'b', type: 'rush' }],
      rushesPerso: [RUSH, RUSH_2],
      plan: { avatarDisponible: false, cible: 20, rythme: null, durees: { [RUSH]: 10, [RUSH_2]: 10 } },
    });
    const a = etapesMontageApercuAutopilote(r);
    expect(a.etapes.length).toBeGreaterThan(0);
    expect(a.etapes.every((e) => e.source === 'rush' && (e.url === RUSH || e.url === RUSH_2))).toBe(true);
    expect(a.etapes.every((e) => e.libelle.startsWith('Rush : '))).toBe(true);
  });
});

describe('Aperçu du montage prévu — rendu', () => {
  afterEach(() => cleanup());
  it('titre dédié, chronologie de TOUS les créneaux puis CTA, avatar en emplacement', () => {
    const r = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'rush' }, { id: 'c', type: 'rush' }],
      actives: { rushes: true, avatar: true, stock: false },
      rushesPerso: [RUSH, RUSH_2],
      avatar: { disponible: true, vignette: null },
      plan: { avatarDisponible: true, cible: 20, rythme: null, durees: {} },
    }), { dureeCta: 4 });
    const { container } = render(
      <ApercuMontageListe etapes={r.etapes} lignes={r.lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens" vignetteAvatar={null} titre="Aperçu du montage prévu" />,
    );
    expect(container.querySelector('h3')!.textContent).toBe('Aperçu du montage prévu');
    expect([...container.querySelectorAll('[data-ligne]')].map((b) => b.getAttribute('data-ligne'))).toEqual([...r.etapes.map((e) => e.id), 'cta']);
    expect(container.querySelector('[data-apercu-montage-avatar="a-produire"]')!.textContent).toContain('Votre avatar parlera ici');
  });

  it('sans titre : l’en-tête d’avant (Créer inchangé)', () => {
    const { container } = render(<ApercuMontageListe etapes={[]} lignes={[]} format="9:16" accent="#7C3AED" />);
    expect(container.querySelector('h3')!.textContent).toBe('Aperçu du montage');
    expect(container.textContent).toContain("Séquence Vidéo dans l'ordre de la liste, puis le CTA.");
  });
});

describe('⚠️ parité avec « Plan avant génération » — même parole estimée (budget du script)', () => {
  afterEach(() => cleanup());
  it('étapes de l’aperçu == lignes « Montage prévu, plan par plan » (nombre, ordre, genre, horaires)', () => {
    // Les MÊMES options, comme le panneau (une seule source : `optionsPlan`).
    const optionsPlan = { avatarDisponible: true, cible: 30, rythme: null, secondesAvatarEstimees: 37.5 };
    const gabarit = [{ id: 's1', type: 'stock' as const }];
    const stock = [retenu(PHOTO, 'photo'), retenu(STOCK_V, 'video')];
    const { container } = render(
      <PlanAvantGeneration
        gabarit={gabarit} suggestion={[]} rushesPerso={[RUSH]} stock={stock} stockPertinent={stock}
        secondesAvatarEstimees={optionsPlan.secondesAvatarEstimees}
        vignetteAvatar={null} avatarDisponible={optionsPlan.avatarDisponible}
        onChange={() => {}} onRechercher={() => {}}
        duree={{ cible: optionsPlan.cible, rythme: optionsPlan.rythme }}
      />,
    );
    const lignesPlan = [...container.querySelectorAll('[data-plan-segment]')].map((li) => ({
      genre: li.getAttribute('data-genre'), debut: Number(li.getAttribute('data-debut')), fin: Number(li.getAttribute('data-fin')),
    }));
    expect(lignesPlan.length).toBeGreaterThan(1);
    // La parole estimée fixe la durée de la séquence (et non la cible).
    expect(lignesPlan[lignesPlan.length - 1].fin).toBe(37.5);

    const a = etapesMontageApercuAutopilote(resume({
      gabarit, actives: { rushes: true, avatar: true, stock: true }, rushesPerso: [RUSH], stock,
      avatar: { disponible: true, vignette: null },
      plan: { ...optionsPlan, durees: {} },
    }), { dureeCta: 4 });
    const genre = { avatar: 'avatar', rush: 'rush', 'stock-video': 'video', 'stock-photo': 'photo' } as const;
    expect(a.etapes.map((e) => ({ genre: genre[e.source as keyof typeof genre], debut: e.debut, fin: e.fin }))).toEqual(lignesPlan);
  });
});
