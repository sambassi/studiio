/**
 * #613 — Autopilote : durée cohérente avec la cible (séquence de clôture, voix
 * intacte), CTA utile et honnête, aperçu = export (même fonction, mêmes entrées).
 */
import { describe, it, expect } from 'vitest';
import {
  planMultiSources, dureeAvecCloture, avatarSynchronise, CLOTURE_MAX_S,
} from '@/lib/autopilot/plan-multi-sources';
import { planMontageAvatar, pertinencesAutopilote, contexteMontageAutopilote, type ContexteTextesAutopilote } from '@/lib/autopilot/montage-avatar';
import { planCompletAutopilote, segmentsDuPlan } from '@/lib/autopilot/plan-complet';
import { etapesMontageApercuAutopilote, type ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';
import { planOverlays } from '@/lib/creer/overlays';
import { profilMontageDuContexte } from '@/lib/creer/smart-montage';
import { ctaAutopilote, ctaDeLObjectif, CTA_GENERIQUE } from '@/lib/autopilot/cta-action';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import type { PreparedPost } from '@/lib/autopilot/engine';
import type { MediaStockRetenu } from '@/lib/autopilot/sources';

const AVATAR = 'https://studiio.pro/storage/v1/object/public/media/u/avatar.mp4';
const v = (n: number) => `https://studiio.pro/storage/v1/object/public/media/u/stock-${n}.mp4`;
const stock: MediaStockRetenu[] = [
  ['hand-writing-motivation-word-5527758', 4], ['man-lifting-dumbbells-in-a-gym-4761426', 3], ['shirtless-man-crossing-arms-6455987', 3],
].map(([slug], i) => ({
  url: v(i), type: 'video' as const, provider: 'pexels' as const, providerAssetId: String(i), auteur: 'A', licence: 'Pexels',
  sourceUrl: `https://www.pexels.com/video/${slug}/`, vignetteUrl: '', sujet: 'Motivation',
}));
const secondes = [4, 3, 3];
const contexte: ContexteTextesAutopilote = {
  sujets: ['Motivation'], titre: 'Motivation', sousTitre: 'Les leviers qui marchent',
  cartes: [{ title: 'ANCRÉ', description: 'Habit stacking' }, { title: 'BOUCLE', description: 'Routine' }],
};
const gabarit = [{ id: 's1', type: 'avatar' as const }, { id: 's2', type: 'stock' as const }, { id: 's3', type: 'stock' as const }, { id: 's4', type: 'stock' as const }, { id: 's5', type: 'avatar' as const }];
const P = 24.682;

function montage(parole: number, dureeVisee: number | null, g = gabarit) {
  return planMontageAvatar({
    avatar: { url: AVATAR, secondes: parole }, dureeVisee,
    stockVideos: stock.map((m, i) => ({ url: m.url, secondes: secondes[i] })), photos: [],
    gabarit: g, pertinences: pertinencesAutopilote(stock, contexte),
    profil: profilMontageDuContexte(contexteMontageAutopilote(contexte)).profil,
    titre: contexte.titre, cartes: contexte.cartes,
  });
}

describe('dureeAvecCloture — la voix n’est jamais touchée', () => {
  it('parole < cible : jusqu’à la cible, au plus +8 s ; parole ≥ cible : la parole', () => {
    expect(dureeAvecCloture(24.682, 30)).toBe(30);
    expect(dureeAvecCloture(15, 30)).toBe(15 + CLOTURE_MAX_S);
    expect(dureeAvecCloture(31.2, 30)).toBe(31.2);
    expect(dureeAvecCloture(29.5, 30)).toBe(29.5); // écart < 1 s : rien
    expect(dureeAvecCloture(24.682, null)).toBe(24.682);
  });
});

describe('séquence de clôture (avatar + stock, cible 30 s, parole 24,68 s)', () => {
  const m = montage(P, 30);
  const plan = m.res.plan;
  it('le montage dure la cible, la parole est entière, la clôture n’a aucun avatar', () => {
    expect(m.res.duree).toBe(30);
    expect(m.res.parole).toBe(P);
    expect(m.res.debutCloture).toBe(P);
    const avatars = plan.filter((s) => s.kind === 'avatar');
    expect(Math.max(...avatars.map((s) => s.fin))).toBe(P);
    expect(avatarSynchronise(plan)).toBe(true);
    const cloture = plan.filter((s) => s.debut >= P - 1e-3);
    expect(cloture.length).toBeGreaterThanOrEqual(1);
    expect(cloture.length).toBeLessThanOrEqual(2);
    expect(cloture.every((s) => s.kind !== 'avatar')).toBe(true);
    // Contigu, jusqu'à la dernière image ; jamais un média monté deux fois.
    plan.forEach((s, i) => { if (i) expect(s.debut).toBe(plan[i - 1].fin); });
    const urls = plan.filter((s) => s.kind !== 'avatar').map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
  it('le CTA est sur la clôture, jusqu’à la dernière image', () => {
    expect(m.overlays?.cta).toEqual([P, 30]);
  });
  it('sans cible : le plan d’avant (durée = parole, aucune clôture)', () => {
    const avant = montage(P, null);
    expect(avant.res.duree).toBe(P);
    expect(avant.res.debutCloture).toBeNull();
    expect(avant.overlays?.cta?.[1]).toBe(P);
  });
  it('parole plus longue que la cible : rien n’est coupé, aucune clôture', () => {
    const long = montage(33, 30);
    expect(long.res.duree).toBe(33);
    expect(long.res.debutCloture).toBeNull();
  });
  it('gabarit « avatar seul » explicite : aucune clôture (choix respecté)', () => {
    const seul = montage(P, 30, [{ id: 'a', type: 'avatar' }]);
    expect(seul.res.debutCloture).toBeNull();
    expect(seul.res.duree).toBe(P);
  });
  it('aucun plan de coupe : la vidéo finit avec la parole (jamais un avatar figé)', () => {
    const r = planMultiSources({ avatar: { url: AVATAR, secondes: P }, cible: P, dureeVisee: 30 });
    expect(r.duree).toBe(P);
    expect(r.debutCloture).toBeNull();
  });
  it('planOverlays sans `debutCta` : à l’identique', () => {
    const base = { duree: 24.682, nbCartes: 3, finHook: 4, voix: { video: 24.682 } };
    expect(planOverlays(base)).toEqual(planOverlays({ ...base, debutCta: null }));
  });
});

describe('aperçu = export : même fonction, mêmes entrées → mêmes segments (à la parole près)', () => {
  const resume: ResumeMediasApercu = {
    gabarit, actives: { rushes: false, stock: true, avatar: true }, rushesPerso: [], stock,
    avatar: { disponible: true, vignette: null },
  };
  const durees = Object.fromEntries(stock.map((m, i) => [m.url, secondes[i]]));
  it('parole égale : segments, durée, clôture et CTA identiques au rendu', () => {
    const rendu = montage(P, 30);
    const apercu = planCompletAutopilote(resume, { cible: 30, durees, urlAvatar: AVATAR, secondesAvatar: P, dureeVisee: 30, contexte });
    expect(apercu.segments).toEqual(segmentsDuPlan(rendu.res.plan, rendu.res.debutCloture));
    expect(apercu.duree).toBe(rendu.res.duree);
    expect(apercu.debutCloture).toBe(rendu.res.debutCloture);
    expect(apercu.cta).toEqual(rendu.overlays?.cta);
    expect(apercu.segments.filter((s) => s.role === 'cloture').length).toBeGreaterThan(0);
    expect(apercu.segments.find((s) => s.role === 'conclusion')?.genre).toBe('avatar');
  });
  it('« Aperçu de mon montage » : étapes de clôture libellées, CTA en surimpression sur la clôture', () => {
    const r = etapesMontageApercuAutopilote({
      ...resume, avatar: { ...resume.avatar, video: AVATAR },
      plan: { avatarDisponible: true, cible: 30, rythme: null, secondesAvatar: P, durees, dureeVisee: 30, contexte },
    }, { dureeCta: 4 });
    expect(r.duree).toBe(30);
    expect(r.ctaEnSurimpression).toBe(true);
    expect(r.ctaFenetre).toEqual([P, 30]);
    expect(r.etapes.filter((e) => e.libelle.startsWith('Clôture + CTA')).length).toBeGreaterThan(0);
    expect(r.lignes.some((l) => l.cta)).toBe(false);
  });
});

describe('CTA honnête — jamais de lien inventé', () => {
  it('table objectif → action', () => {
    expect(ctaDeLObjectif('Motiver ma communauté à bouger')).toBe('PASSE À L’ACTION AUJOURD’HUI');
    expect(ctaDeLObjectif('Expliquer les bases de la nutrition')).toBe('ENREGISTRE POUR PLUS TARD');
    expect(ctaDeLObjectif('Réserver un cours d’essai')).toBe('ÉCRIS-NOUS EN MESSAGE');
    expect(ctaDeLObjectif('Prendre des cours de danse')).toBe('ÉCRIS-NOUS EN MESSAGE');
    expect(ctaDeLObjectif('La course à pied')).not.toBe('ÉCRIS-NOUS EN MESSAGE');
    expect(ctaDeLObjectif('Course à pied', null, 'parcours running')).toBe(CTA_GENERIQUE);
    expect(ctaDeLObjectif(null, null, 'Motivation')).toBe('PASSE À L’ACTION AUJOURD’HUI');
    expect(ctaDeLObjectif(null, '', 'yoga')).toBe(CTA_GENERIQUE);
  });
  it('sans CTA du brief : action dérivée, petite ligne vide ; avec CTA du brief : la règle de Créer', () => {
    expect(ctaAutopilote('LEVIERS EFFICACES', {}, 'Motivation')).toEqual({ cta: 'PASSE À L’ACTION AUJOURD’HUI', ctaSub: '', actionEnPetiteLigne: false });
    expect(ctaAutopilote('LEVIERS EFFICACES', { cta: 'Réserve ta séance' })).toMatchObject({ cta: 'LEVIERS EFFICACES', ctaSub: 'Réserve ta séance' });
  });
  it('design Autopilote sans brief : aucun « LIEN EN BIO », aucune URL', () => {
    const post = {
      title: 'Motivation', caption: '', scheduledDate: '2026-10-20', scheduledTime: '18:00', platforms: [], rushUrl: null,
      content: { subtitle: 'x', tagLine: 'LEVIERS EFFICACES', cards: [] },
    } as unknown as PreparedPost;
    const d = buildAutopilotDesign(post, {}) as { ctaText?: string; ctaSubText?: string };
    expect(d.ctaText).toBe('PASSE À L’ACTION AUJOURD’HUI');
    expect(d.ctaSubText).toBe('');
    expect(`${d.ctaText} ${d.ctaSubText}`).not.toMatch(/lien en bio|https?:|www\.|\.com/i);
  });
  it('brief AVEC CTA : clé ctaSubText seulement si la petite ligne existe (comportement d’avant)', () => {
    const base = { title: 'Motivation', caption: '', scheduledDate: '2026-10-20', scheduledTime: '18:00', platforms: [], rushUrl: null };
    const egal = buildAutopilotDesign({ ...base, content: { subtitle: 'x', tagLine: 'Réserve', cards: [] }, brief: { cta: 'Réserve' } } as unknown as PreparedPost, {});
    expect('ctaSubText' in egal).toBe(false);
    const action = buildAutopilotDesign({ ...base, content: { subtitle: 'x', tagLine: 'SLOGAN', cards: [] }, brief: { cta: 'Réserve' } } as unknown as PreparedPost, {}) as { ctaSubText?: string };
    expect(action.ctaSubText).toBe('Réserve');
  });
});
