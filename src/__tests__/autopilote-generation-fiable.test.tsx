/**
 * AUTOPILOTE — GÉNÉRATION FIABLE (2026-10-20).
 *
 *  1. Aucune redirection automatique vers le Calendrier ; aucune ancienne
 *     vidéo présentée pendant une production Autopilote.
 *  2. Une production perdue (serveur redémarré) est DITE, avec la relance.
 *  3. Un 2e lancement est refusé (409) tant qu'une vidéo avec avatar du compte
 *     est en préparation.
 *  4. Plan = MP4 : avec avatar + plans de coupe, aucune séquence CTA promise
 *     après la vidéo ; la durée du MP4 est vérifiée contre le plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { fausseBase as base } from './helpers/fausse-base';

vi.mock('@/lib/db/supabase', async () => ({ supabaseAdmin: (await import('./helpers/fausse-base')).fausseBase.supabaseAdmin }));
vi.mock('@/lib/autopilot/jumeau-async', () => ({ finaliserJumeauxPrets: vi.fn(async () => ({ examines: 0, rendus: 0, encore: 0, echecs: 0 })) }));

import VideosPretes from '@/components/creer/VideosPretes';
import PlanAvantGeneration from '@/components/creer/PlanAvantGeneration';
import BandeauGenerationEnCours from '@/components/calendar/BandeauGenerationEnCours';
import {
  annoncerProductionAutopilote, lireProgressionServeur, repriseAuRetour, libelleBoutonProduire,
  productionSuivieDepuis, parametresSuivi, MESSAGE_PRODUCTION_INTERROMPUE,
} from '@/lib/autopilot/etat-production-manuelle';
import {
  jumeauEnPreparation, suiviProductionManuelle, jetonManuel, jobIdManuel, creneauDepuisRequete,
} from '@/lib/autopilot/suivi-jumeau-manuel';
import { generationEnCoursDepuisLecture } from '@/lib/autopilot/progression';
import { etapesMontageApercuAutopilote, type ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';
import { verifierDureeRendu, dureePlanRendu } from '@/lib/autopilot/produire';

const U = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const NOW = Date.parse('2026-10-20T14:00:00Z');
const RENDU = '77777777-7777-4777-8777-777777777777';
const RENDU_PRET = {
  id: RENDU, etat: 'reussie', etape: null, motif: null,
  video: { dureeSecondes: 28.4, largeur: 1080, hauteur: 1920, chemin: `/api/autopilot/rendus-montage/${RENDU}/fichier` },
};

afterEach(() => { cleanup(); annoncerProductionAutopilote(false); });
beforeEach(() => { base.vider(); });

// ── 1. Pas de redirection, pas d'ancienne vidéo pendant une production ──
describe('1. VideosPretes dans la colonne Autopilote', () => {
  it('« Ajouter en brouillon » ne navigue JAMAIS : message + lien « Voir dans le Calendrier »', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === '/api/posts') return new Response(JSON.stringify({ success: true, post: { id: 'p1' } }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, rendu: RENDU_PRET }), { status: 200 });
    });
    const avant = window.location.href;
    const { container } = render(<VideosPretes sessionId="s1" aucunRush={false} fetcher={fetcher as never} />);
    await screen.findByText('Vidéo ponctuelle de ce tournage');
    await act(async () => { fireEvent.click(container.querySelector('[data-videos-planifier]')!); });
    const lien = await waitFor(() => {
      const a = container.querySelector('[data-videos-voir-calendrier]');
      expect(a).not.toBeNull();
      return a!;
    });
    expect(lien.getAttribute('href')).toBe('/dashboard/calendar');
    expect(container.querySelector('[data-videos-planif-message]')!.textContent).toContain('Brouillon ajouté au Calendrier');
    expect(window.location.href).toBe(avant);
  });

  it('pendant une production Autopilote : la vidéo ponctuelle prête s’efface et l’aperçu garde sa place', async () => {
    const onEtat = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, rendu: RENDU_PRET }), { status: 200 }));
    const { container } = render(<VideosPretes sessionId="s1" aucunRush={false} fetcher={fetcher as never} onEtat={onEtat} />);
    await screen.findByText('Vidéo ponctuelle de ce tournage');
    expect(onEtat).toHaveBeenLastCalledWith('prete');
    act(() => { annoncerProductionAutopilote(true); });
    expect(container.querySelector('[data-videos-pretes]')).toBeNull();
    expect(onEtat).toHaveBeenLastCalledWith('vide');
    expect(screen.queryByText('Dernière vidéo générée')).toBeNull();
    act(() => { annoncerProductionAutopilote(false); });
    expect(await screen.findByText('Vidéo ponctuelle de ce tournage')).toBeTruthy();
  });

  it('monté APRÈS l’annonce : masquée dès le premier rendu', async () => {
    annoncerProductionAutopilote(true);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, rendu: RENDU_PRET }), { status: 200 }));
    const { container } = render(<VideosPretes sessionId="s1" aucunRush={false} fetcher={fetcher as never} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('[data-videos-pretes]')).toBeNull();
  });
});

// ── 2. Production perdue : dite, relançable, sans facturation ──
describe('2. État de génération durable', () => {
  it('créneau suivi relu dans le Calendrier : déposé → résultat prouvé ; perdu → « interrompue »', () => {
    const d = lireProgressionServeur({ progression: null, resultat: null, jumeau: null, manuel: { etat: 'depose', post: { postId: 'p9', scheduledDate: '2026-10-20', scheduledTime: '16:05' } } });
    expect(d).toMatchObject({ cas: 'resultat', resultat: { success: true, postId: 'p9' } });
    const perdue = lireProgressionServeur({ progression: null, resultat: null, jumeau: null, manuel: { etat: 'perdue' } });
    expect(perdue).toEqual({ cas: 'perdue' });
    expect(repriseAuRetour(perdue)).toBe('interrompue');
  });

  it('message de reprise : interrompue, aucun débit sans brouillon, bouton « Relancer la production »', () => {
    expect(MESSAGE_PRODUCTION_INTERROMPUE).toMatch(/Production interrompue/);
    expect(MESSAGE_PRODUCTION_INTERROMPUE).toMatch(/Aucun crédit n’est débité tant qu’aucun brouillon n’est déposé/);
    expect(MESSAGE_PRODUCTION_INTERROMPUE).toMatch(/Relancez/);
    expect(libelleBoutonProduire({ etat: 'erreur', message: MESSAGE_PRODUCTION_INTERROMPUE, code: 'interrompue' })).toBe('Relancer la production');
    expect(libelleBoutonProduire({ etat: 'erreur', message: 'x' })).toBe('Réessayer la production');
  });

  it('créneau suivi : format validé, fenêtre de 6 h', () => {
    const p = productionSuivieDepuis(JSON.stringify({ date: '2026-10-20', time: '16:05', depuis: NOW }), NOW + 1000);
    expect(p).toEqual({ date: '2026-10-20', time: '16:05', depuis: NOW });
    expect(parametresSuivi(p)).toBe('?date=2026-10-20&time=16%3A05');
    expect(productionSuivieDepuis({ date: '2026-10-20', time: '16:05', depuis: NOW }, NOW + 7 * 3600_000)).toBeNull();
    expect(productionSuivieDepuis({ date: 'x', time: '16:05', depuis: NOW }, NOW)).toBeNull();
    expect(parametresSuivi(null)).toBe('');
    expect(creneauDepuisRequete('2026-10-20', '16:05')).toEqual({ date: '2026-10-20', time: '16:05' });
    expect(creneauDepuisRequete('2026-10-20', '16h05')).toBeNull();
  });

  it('serveur : le post du créneau est relu (déposé) ; absent → perdu', async () => {
    expect(await suiviProductionManuelle(U, '2026-10-20', '16:05')).toEqual({ etat: 'perdue' });
    base.table('scheduled_posts').push({
      id: 'p9', user_id: U, status: 'draft', scheduled_date: '2026-10-20', scheduled_time: '16:05:00',
      media_url: 'https://studiio.pro/x.mp4', metadata: { slotKey: jetonManuel(U, '2026-10-20', '16:05') },
    });
    expect(await suiviProductionManuelle(U, '2026-10-20', '16:05')).toMatchObject({ etat: 'depose', post: { postId: 'p9' } });
    expect(jetonManuel(U, '2026-10-20', '16:05')).toBe(`manuel:${U}|2026-10-20|16:05`);
    expect(jobIdManuel(U, '2026-10-20', '16:05')).toBe(`autopilote-manuel-${U}-2026-10-20-1605`);
  });

  it('Calendrier : « Génération en cours » seulement si une production tourne ; % seulement mesuré', () => {
    expect(generationEnCoursDepuisLecture({ progression: null, resultat: null, jumeau: null })).toBeNull();
    expect(generationEnCoursDepuisLecture({ resultat: { success: true, postId: 'p' } })).toBeNull();
    const prep = generationEnCoursDepuisLecture({ progression: { etape: 'preparation', avancement: null } });
    expect(prep).toMatchObject({ sorte: 'rendu' });
    expect((prep as { pourcentage?: number }).pourcentage).toBeUndefined();
    expect(generationEnCoursDepuisLecture({ progression: { etape: 'composition', avancement: 0.42 } })).toMatchObject({ pourcentage: 42 });
    expect(generationEnCoursDepuisLecture({ jumeau: { etat: 'en_preparation', statut: 'en_attente', depuis: '2026-10-20T13:50:00Z' } }))
      .toMatchObject({ sorte: 'avatar', depuis: '2026-10-20T13:50:00Z' });
  });

  it('Calendrier : la carte s’affiche pendant la production, disparaît ensuite et relit les posts', async () => {
    const reponses = [
      { success: true, progression: { etape: 'composition', avancement: 0.5 }, resultat: null, jumeau: null },
      { success: true, progression: null, resultat: { success: true, postId: 'p' }, jumeau: null },
    ];
    let i = 0;
    const fetcher = vi.fn(async () => new Response(JSON.stringify(reponses[Math.min(i++, 1)])));
    const onTerminee = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = render(<BandeauGenerationEnCours fetcher={fetcher as never} onTerminee={onTerminee} />);
      await waitFor(() => expect(container.querySelector('[data-calendrier-generation-en-cours]')).not.toBeNull());
      expect(container.textContent).toContain('Génération en cours');
      await act(async () => { await vi.advanceTimersByTimeAsync(5200); });
      await waitFor(() => expect(container.querySelector('[data-calendrier-generation-en-cours]')).toBeNull());
      expect(onTerminee).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 3. Garde anti-doublon ──
describe('3. Aucune génération en double', () => {
  const M = (suffixe: string) => `autopilote-manuel-${U}-${suffixe}`;
  it('ligne MANUELLE non terminale récente → 409 ; terminale ou ancienne → non', async () => {
    expect(await jumeauEnPreparation(U, NOW)).toBe(false);
    base.table('autopilot_jumeau_attente').push({ user_id: U, job_id: M('2026-10-19-0800'), statut: 'en_attente', created_at: '2026-10-19T08:00:00Z' });
    base.table('autopilot_jumeau_attente').push({ user_id: U, job_id: M('2026-10-20-1359'), statut: 'rendu', created_at: '2026-10-20T13:59:00Z' });
    expect(await jumeauEnPreparation(U, NOW)).toBe(false);
    base.table('autopilot_jumeau_attente').push({ user_id: U, job_id: M('2026-10-20-1358'), statut: 'reserve', created_at: '2026-10-20T13:58:00Z' });
    expect(await jumeauEnPreparation(U, NOW)).toBe(true);
    expect(await jumeauEnPreparation('autre', NOW)).toBe(false);
  });

  it('ligne du CRON (même non terminale, même « reserve » bloquée) → jamais de 409', async () => {
    base.table('autopilot_jumeau_attente').push({ user_id: U, job_id: `autopilote-${U}-2026-10-20-0`, statut: 'reserve', created_at: '2026-10-20T13:58:00Z' });
    base.table('autopilot_jumeau_attente').push({ user_id: U, job_id: `autopilote-${U}-2026-10-20-1`, statut: 'en_cours', created_at: '2026-10-20T13:59:00Z' });
    expect(await jumeauEnPreparation(U, NOW)).toBe(false);
  });
});

// ── 4. Plan = MP4 ──
function resume(o: Partial<ResumeMediasApercu> = {}): ResumeMediasApercu {
  return {
    gabarit: [], actives: { rushes: true, avatar: false, stock: false }, rushesPerso: [], stock: [],
    avatar: { disponible: false, vignette: null }, ...o,
  };
}
const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/plage.mp4';

describe('4. Plan = MP4', () => {
  it('avatar + plans de coupe : AUCUNE séquence CTA après la vidéo dans l’aperçu', () => {
    const a = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'rush' }],
      actives: { rushes: true, avatar: true, stock: false }, rushesPerso: [RUSH],
      avatar: { disponible: true, vignette: null },
      plan: { avatarDisponible: true, cible: 30, rythme: null, durees: { [RUSH]: 12 } },
    }), { dureeCta: 4 });
    expect(a.etapes.some((e) => e.source === 'avatar')).toBe(true);
    expect(a.lignes.some((l) => l.cta)).toBe(false);
    expect(a.lignes[a.lignes.length - 1].fin).toBe(a.duree);
  });

  it('sans avatar : la séquence CTA reste à la fin', () => {
    const a = etapesMontageApercuAutopilote(resume({
      gabarit: [{ id: 'b', type: 'rush' }], rushesPerso: [RUSH],
      plan: { avatarDisponible: false, cible: 20, rythme: null, durees: { [RUSH]: 20 } },
    }), { dureeCta: 4 });
    expect(a.lignes[a.lignes.length - 1]).toMatchObject({ id: 'cta', cta: true, debut: a.duree });
  });

  it('Plan avant génération (avatar + rush) : CTA annoncé en surimpression, durée estimée et recalée', () => {
    const { container } = render(
      <PlanAvantGeneration
        gabarit={[{ id: 's1', type: 'avatar' }, { id: 's2', type: 'rush' }]} suggestion={[]} rushesPerso={[RUSH]} stock={[]}
        secondesAvatarEstimees={30} vignetteAvatar={null} avatarDisponible
        onChange={() => {}} onRechercher={() => {}} duree={{ cible: 30, rythme: null }}
      />,
    );
    expect(container.querySelector('[data-plan-cta]')!.getAttribute('data-plan-cta-mode')).toBe('surimpression');
    expect(container.textContent).not.toContain('La séquence CTA reste toujours à la fin');
    expect(container.textContent).toContain('il n’y a pas de séquence CTA séparée');
    expect(container.querySelector('[data-plan-duree-planifiee]')!.textContent).toContain('(estimée)');
    expect(container.querySelector('[data-plan-duree-avertissement]')!.textContent).toMatch(/recalé sur sa durée réelle/);
  });

  it('Plan avant génération sans avatar : séquence CTA fixe à la fin (inchangé)', () => {
    const { container } = render(
      <PlanAvantGeneration
        gabarit={[{ id: 's2', type: 'rush' }]} suggestion={[]} rushesPerso={[RUSH]} stock={[]}
        vignetteAvatar={null} avatarDisponible={false}
        onChange={() => {}} onRechercher={() => {}} duree={{ cible: 20, rythme: null }}
      />,
    );
    expect(container.querySelector('[data-plan-cta]')!.getAttribute('data-plan-cta-mode')).toBe('sequence');
    expect(container.textContent).toContain('La séquence CTA reste toujours à la fin');
  });

  it('vérification MP4 : écart > 1 s ou mesure impossible → dureeVerifiee false', () => {
    // Le cas MOTIVATION : plan 34 s annoncé, MP4 24,68 s.
    expect(verifierDureeRendu(34, 24.68)).toMatchObject({ dureeVerifiee: false, ecartS: -9.32 });
    expect(verifierDureeRendu(24.7, 24.68)).toMatchObject({ dureeVerifiee: true });
    expect(verifierDureeRendu(24.7, null)).toMatchObject({ dureeVerifiee: false, dureeMesureeS: null });
    // Durée du plan rendu = la même règle que la composition.
    expect(dureePlanRendu({ introDuration: 0, cardsDuration: 0, ctaDuration: 0, videoDuration: 24.68, videoUrl: 'v.mp4', cards: [{}] })).toBe(24.68);
    expect(dureePlanRendu({ introDuration: 3, cardsDuration: 5, ctaDuration: 4, videoDuration: 10, videoUrl: 'v.mp4', cards: [{}] })).toBe(22);
    expect(dureePlanRendu({ introDuration: 3, cardsDuration: 5, ctaDuration: 4, videoDuration: 10, videoUrl: 'v.mp4', cards: [] })).toBe(17);
  });
});
