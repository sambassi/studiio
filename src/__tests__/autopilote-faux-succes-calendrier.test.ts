/**
 * AUTOPILOTE — « Brouillon déposé dans le Calendrier » alors que le Calendrier
 * était vide (prod, 2026-10-13, 11:35 Paris).
 *
 * Cause : avec l'avatar actif, « Produire maintenant » répond 200
 * `{ jumeau: 'en_preparation' }` sans `postId` ; le montage attend en file
 * (`autopilot_jumeau_attente`) jusqu'à la passe du finaliseur. L'écran
 * l'annonçait comme déposé.
 *
 * Ici : le VRAI module de suivi, sur une base en mémoire. Un dépôt n'est
 * déclaré qu'avec un post relu (bon compte, statut affichable, vidéo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fausseBase as base } from './helpers/fausse-base';

vi.mock('@/lib/db/supabase', async () => ({ supabaseAdmin: (await import('./helpers/fausse-base')).fausseBase.supabaseAdmin }));
vi.mock('@/lib/autopilot/jumeau-async', () => ({ finaliserJumeauxPrets: vi.fn(async () => ({ examines: 0, rendus: 0, encore: 0, echecs: 0 })) }));

import {
  suiviProductionJumeau, postVisibleDansCalendrier, avancerFileDuCompte, _reinitialiserSuivi, INTERVALLE_AVANCEE_MS,
} from '@/lib/autopilot/suivi-jumeau-manuel';
import { creneauImmediat } from '@/lib/autopilot/rules';
import { trahitUnFournisseur } from '@/lib/avatar/fournisseurs';

const U = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const AUTRE = '99999999-9999-4999-8999-999999999999';
const NOW = Date.parse('2026-10-13T09:40:00Z');
const file = (l: Record<string, unknown>) => base.table('autopilot_jumeau_attente').push({
  user_id: U, job_id: `autopilote-manuel-${U}-2026-10-13-1135`, slot_key: `manuel:${U}:2026-10-13:11:35`,
  statut: 'en_attente', post_id: null, motif: null, created_at: '2026-10-13T09:25:40Z', ...l,
});
const post = (l: Record<string, unknown>) => base.table('scheduled_posts').push({
  id: 'post-1', user_id: U, status: 'draft', scheduled_date: '2026-10-13', scheduled_time: '11:35:00',
  media_url: 'https://studiio.pro/storage/v1/object/public/media/u/rendus/x.mp4', metadata: {}, ...l,
});

beforeEach(() => { base.vider(); _reinitialiserSuivi(); });

describe('CAS B — pas de post : jamais « déposé »', () => {
  it('montage en file (jumeau en préparation) → en_preparation, aucun post annoncé', async () => {
    file({ statut: 'en_attente' });
    expect(await suiviProductionJumeau(U, NOW)).toEqual({ etat: 'en_preparation', jobId: expect.stringContaining('autopilote-manuel-'), statut: 'en_attente', depuis: '2026-10-13T09:25:40Z' });
  });
  it('file « rendu » mais post absent → échec explicite, pas de succès', async () => {
    file({ statut: 'rendu', post_id: 'post-fantome' });
    expect(await suiviProductionJumeau(U, NOW)).toMatchObject({ etat: 'echec' });
  });
  it('aucune production récente → rien à suivre', async () => {
    file({ created_at: '2026-10-12T09:00:00Z' });
    expect(await suiviProductionJumeau(U, NOW)).toBeNull();
  });
});

describe('CAS A / D — post réellement dans le Calendrier, avec SA vidéo', () => {
  it('file rendue + post du compte, brouillon, vidéo → déposé avec la date/heure du post', async () => {
    file({ statut: 'rendu', post_id: 'post-1' });
    post({});
    const s = await suiviProductionJumeau(U, NOW);
    expect(s).toMatchObject({ etat: 'depose', sansAvatar: false, post: { postId: 'post-1', scheduledDate: '2026-10-13', scheduledTime: '11:35', status: 'draft' } });
    expect((s as { post: { videoUrl: string } }).post.videoUrl).toContain('/rendus/x.mp4');
  });
});

describe('CAS C — échec du jumeau', () => {
  it('repli sans avatar rendu → déposé, signalé « sans avatar »', async () => {
    file({ statut: 'echec', motif: 'La préparation du jumeau ne s’est jamais terminée.' });
    post({ metadata: { slotKey: `manuel:${U}:2026-10-13:11:35` } });
    expect(await suiviProductionJumeau(U, NOW)).toMatchObject({ etat: 'depose', sansAvatar: true });
  });
  it('aucun repli → message clair, sans nom de fournisseur', async () => {
    file({ statut: 'echec', motif: "HeyGen : Insufficient credit" });
    const s = await suiviProductionJumeau(U, NOW) as { etat: string; message: string };
    expect(s.etat).toBe('echec');
    expect(s.message).toContain('aucun brouillon n’a été déposé');
    expect(trahitUnFournisseur(s.message)).toBe(false);
  });
});

describe('CAS E / F — vidéo obligatoire, bon compte', () => {
  it('post sans vidéo → pas visible comme dépôt', async () => {
    post({ media_url: null });
    expect(await postVisibleDansCalendrier(U, 'post-1')).toBeNull();
  });
  it('post d’un AUTRE compte → refusé', async () => {
    post({ user_id: AUTRE });
    expect(await postVisibleDansCalendrier(U, 'post-1')).toBeNull();
    file({ statut: 'rendu', post_id: 'post-1' });
    expect(await suiviProductionJumeau(U, NOW)).toMatchObject({ etat: 'echec' });
  });
  it('post publié/échoué → pas un brouillon déposé', async () => {
    post({ status: 'failed' });
    expect(await postVisibleDansCalendrier(U, 'post-1')).toBeNull();
  });
});

describe('CAS G — fuseau Europe/Paris : le post tombe le bon jour', () => {
  it('11:27 à Paris → créneau du jour, 11:35', () => {
    expect(creneauImmediat(Date.parse('2026-10-13T09:27:00Z'), 'Europe/Paris')).toEqual({ date: '2026-10-13', time: '11:35' });
  });
  it('23:58 à Paris (21:58 UTC) → lendemain 00:05 à Paris, jamais la veille UTC', () => {
    expect(creneauImmediat(Date.parse('2026-10-13T21:58:00Z'), 'Europe/Paris')).toEqual({ date: '2026-10-14', time: '00:05' });
  });
});

describe('Faire avancer la file pendant que l’écran attend', () => {
  it('le navigateur relit toutes les 2 s : UNE avancée par intervalle, jamais deux en vol', async () => {
    let finir!: () => void;
    const finaliser = vi.fn(() => new Promise<{ examines: number; rendus: number; encore: number; echecs: number }>((r) => { finir = () => r({ examines: 1, rendus: 0, encore: 1, echecs: 0 }); }));
    expect(avancerFileDuCompte(U, NOW, finaliser)).toBe(true);
    expect(avancerFileDuCompte(U, NOW + 2000, finaliser)).toBe(false);
    expect(avancerFileDuCompte(U, NOW + INTERVALLE_AVANCEE_MS + 1, finaliser)).toBe(false); // encore en vol
    finir();
    await new Promise((r) => setTimeout(r, 0));
    expect(avancerFileDuCompte(U, NOW + INTERVALLE_AVANCEE_MS + 2, finaliser)).toBe(true);
    expect(finaliser).toHaveBeenCalledTimes(2);
    expect(finaliser).toHaveBeenCalledWith({ userId: U, max: 1 });
  });
});
