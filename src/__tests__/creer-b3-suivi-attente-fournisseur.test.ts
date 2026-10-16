import { describe, it, expect } from 'vitest';
import {
  attendreStatutJumeau, ErreurAttenteJumeau, JUMEAU_ATTENTE_MAX_MS, JUMEAU_POLL_MS,
  JUMEAU_POLL_ATTENTE_MS, JUMEAU_ATTENTE_FOURNISSEUR_MAX_MS, MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR,
} from '@/lib/creer/jumeau';

/**
 * B3 — le suivi de Créer suit l'ATTENTE FOURNISSEUR du serveur.
 *
 * Le suivi abandonnait après 32 min (« prend trop de temps ») alors qu'une
 * génération mise en attente fournisseur (#558) peut reprendre jusqu'à 6 h
 * plus tard. Tant que le serveur répond `enAttente: 'fournisseur'`, aucun
 * échec n'est déclaré ; l'écran le dit ; le rythme ralentit après 32 min.
 * Horloge et `fetch` doublés : aucune attente réelle, aucun réseau.
 */

const GEN = 'gen-b3';
const MIN = 60 * 1000;

function scenario(reponses: (t: number) => unknown) {
  let t = 0;
  const pauses: number[] = [];
  const appels: number[] = [];
  const f = (async () => {
    appels.push(t);
    return new Response(JSON.stringify(reponses(t)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return {
    f, pauses, appels,
    maintenant: () => t,
    dormir: async (ms: number) => { pauses.push(ms); t += ms; },
  };
}
const attente = { success: true, data: { status: 'processing', videoUrl: null, enAttente: 'fournisseur', message: 'Ta génération est momentanément en attente.' } };
const enCours = { success: true, data: { status: 'processing', videoUrl: null } };
const pret = { success: true, data: { status: 'completed', videoUrl: 'https://minio/u/avatar/gen-b3.mp4', avatarVersion: 2 } };

describe('B3 — attendreStatutJumeau et l’attente fournisseur', () => {
  it('⚠️ serveur « en attente fournisseur » au-delà de 32 min → aucun échec, puis la vidéo reprise est rendue', async () => {
    // En attente pendant 3 h, puis reprise : la vidéo arrive 10 min plus tard.
    const s = scenario((t) => (t < 180 * MIN ? attente : t < 190 * MIN ? enCours : pret));
    const etapes: string[] = [];
    const r = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: s.dormir, maintenant: s.maintenant, onEtape: (m) => etapes.push(m) });
    expect(r).toEqual({ url: 'https://minio/u/avatar/gen-b3.mp4', avatarVersion: 2 });
    expect(etapes).toContain(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR);
  });

  it('le message dit l’attente, la reprise automatique et qu’on peut quitter la page', () => {
    expect(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR).toMatch(/attente/i);
    expect(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR).toMatch(/reprendr/i);
    expect(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR).toMatch(/quitter la page/i);
    expect(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR).not.toMatch(/heygen|d-id|elevenlabs/i);
  });

  it('pas de polling agressif : intervalle nominal avant 32 min, ralenti ensuite', async () => {
    const s = scenario((t) => (t < 120 * MIN ? attente : pret));
    await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: s.dormir, maintenant: s.maintenant });
    expect(JUMEAU_POLL_ATTENTE_MS).toBeGreaterThan(JUMEAU_POLL_MS);
    const avant = s.appels.filter((t) => t < JUMEAU_ATTENTE_MAX_MS).length;
    const apres = s.appels.filter((t) => t >= JUMEAU_ATTENTE_MAX_MS).length;
    expect(avant).toBeLessThanOrEqual(Math.ceil(JUMEAU_ATTENTE_MAX_MS / JUMEAU_POLL_MS) + 1);
    // 88 min d'attente au rythme ralenti : au plus ~ une lecture par minute.
    expect(apres).toBeLessThanOrEqual(Math.ceil((120 * MIN - JUMEAU_ATTENTE_MAX_MS) / JUMEAU_POLL_ATTENTE_MS) + 2);
    expect(s.pauses.every((p) => p === JUMEAU_POLL_MS || p === JUMEAU_POLL_ATTENTE_MS)).toBe(true);
  });

  it('reprise côté serveur après une longue attente : une fenêtre normale de suivi repart (pas d’échec immédiat)', async () => {
    // Attente 40 min, puis relancée : 25 min de rendu.
    const s = scenario((t) => (t < 40 * MIN ? attente : t < 65 * MIN ? enCours : pret));
    await expect(attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: s.dormir, maintenant: s.maintenant })).resolves.toMatchObject({ avatarVersion: 2 });
  });

  it('sans attente fournisseur, le délai de 32 min est INCHANGÉ (échec « delai », identifiant à garder)', async () => {
    const s = scenario(() => enCours);
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: s.dormir, maintenant: s.maintenant }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurAttenteJumeau);
    expect(e.code).toBe('delai');
    expect(s.maintenant()).toBeLessThan(JUMEAU_ATTENTE_MAX_MS + JUMEAU_POLL_MS + 1);
  });

  it('attente au-delà du plafond serveur (6 h + marge) → arrêt du SUIVI, jamais un « échec » : code delai, message d’attente', async () => {
    expect(JUMEAU_ATTENTE_FOURNISSEUR_MAX_MS).toBeGreaterThan(6 * 60 * MIN);
    const s = scenario(() => attente);
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: s.dormir, maintenant: s.maintenant }).catch((x) => x);
    expect(e).toBeInstanceOf(ErreurAttenteJumeau);
    expect(e.code).toBe('delai'); // reprenable : l'identifiant est gardé
    expect(e.message).toBe(MESSAGE_JUMEAU_EN_ATTENTE_FOURNISSEUR);
  });

  it('le serveur finit par dire `failed` (attente close, remboursée) → c’est SON verdict qui s’affiche', async () => {
    const s = scenario((t) => (t < 360 * MIN ? attente : { success: true, data: { status: 'failed', videoUrl: null, error: 'Vos crédits Studiio ont été recrédités.' } }));
    const e = await attendreStatutJumeau({ generationId: GEN, fetchImpl: s.f, attendreMs: s.dormir, maintenant: s.maintenant }).catch((x) => x);
    expect(e.code).toBe('echec');
    expect(e.message).toContain('recrédités');
  });
});
