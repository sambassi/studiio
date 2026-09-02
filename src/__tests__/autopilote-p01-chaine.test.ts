/**
 * P0.1 — L'ENCHAÎNEMENT « CRÉER MA VIDÉO ».
 *
 * L'ORDRE des trois appels, l'arrêt à la première rupture, et la traduction
 * des motifs asynchrones du découpage.
 *
 * ⚠️ CE FICHIER NE MOCKE PAS `chaine-passerelle` : c'est lui qu'il teste. Le
 * bouton, qui doit le mocker, vit dans un fichier à part — mocker le module
 * sous test le viderait de sa substance.
 *
 * ⚠️ AUCUNE ASSERTION SUR LE SOURCE : chaque test porte sur un comportement,
 * ici les URL appelées et l'ordre dans lequel elles le sont.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  ATTENTE_CLIPS_MAX_MS, DUREE_CIBLE_SECONDES, FORMAT_VIDEO,
  MOTIFS_CLIPS_TRADUITS, creerVideo, messageClips, phraseChaine,
} from '@/lib/autopilot/analyse/chaine-passerelle';
import { MOTIFS_CLIPS } from '@/lib/autopilot/analyse/clip-contrat';
import { FORMATS_MONTAGE, DUREE_CIBLE_MAX_SECONDES, DUREE_CIBLE_MIN_SECONDES } from '@/lib/autopilot/analyse/montage-contrat';

const CANDIDATS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JEU = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const URL_CLIPS = `/api/autopilot/candidats/${CANDIDATS}/clips`;
const URL_JEU = `/api/autopilot/clips/${JEU}`;
const URL_MONTAGE = `/api/autopilot/clips/${JEU}/montage`;
const URL_RENDU = `/api/autopilot/montages/${PLAN}/rendu`;

/** Un `fetch` scénarisé : une file de réponses par URL, et le journal des appels. */
function banc(scenario: Record<string, { statut: number; corps: unknown }[]>) {
  const appels: { url: string; methode: string; corps: string | null }[] = [];
  const restes: Record<string, { statut: number; corps: unknown }[]> = {};
  for (const [k, v] of Object.entries(scenario)) restes[k] = [...v];

  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    appels.push({
      url,
      methode: init?.method ?? 'GET',
      corps: typeof init?.body === 'string' ? init.body : null,
    });
    const file = restes[url];
    if (!file || file.length === 0) throw new Error(`URL non prévue : ${url}`);
    const r = file.length > 1 ? file.shift()! : file[0];
    return new Response(JSON.stringify(r.corps), { status: r.statut });
  });
  return { fetcher, appels };
}

const jeu = (etat: string, motifEchec: string | null = null) => ({
  ok: true, clipSet: { id: JEU, etat, motifEchec },
});

const lancer = (o: Partial<Parameters<typeof creerVideo>[0]> & { fetcher: never }) => creerVideo({
  candidateSetId: CANDIDATS,
  // Aucune vraie minuterie : les tests ne dorment pas.
  attendre: async () => {},
  ...o,
} as Parameters<typeof creerVideo>[0]);

afterEach(() => { vi.restoreAllMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. L'ENCHAÎNEMENT
// ═══════════════════════════════════════════════════════════════════════════

describe('1. L’ordre des trois appels', () => {
  it('1.1 découpage → montage → rendu, et rien d’autre', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{ statut: 202, corps: jeu('en_attente') }],
      [URL_JEU]: [
        { statut: 200, corps: jeu('en_cours') },
        { statut: 200, corps: jeu('reussie') },
      ],
      [URL_MONTAGE]: [{ statut: 201, corps: { ok: true, plan: { id: PLAN } } }],
      [URL_RENDU]: [{ statut: 202, corps: { ok: true, rendu: { id: 'r' } } }],
    });

    const r = await lancer({ fetcher } as never);
    expect(r.sorte).toBe('lancee');

    expect(appels.map((a) => `${a.methode} ${a.url}`)).toEqual([
      `POST ${URL_CLIPS}`,
      `GET ${URL_JEU}`,
      `GET ${URL_JEU}`,
      `POST ${URL_MONTAGE}`,
      `POST ${URL_RENDU}`,
    ]);
  });

  it('1.2 le montage porte le format et la durée, tous deux dans les bornes', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{ statut: 200, corps: jeu('reussie') }],
      [URL_MONTAGE]: [{ statut: 201, corps: { ok: true, plan: { id: PLAN } } }],
      [URL_RENDU]: [{ statut: 202, corps: { ok: true } }],
    });
    await lancer({ fetcher } as never);

    const envoi = JSON.parse(appels.find((a) => a.url === URL_MONTAGE)!.corps!);
    expect(envoi).toEqual({
      format: FORMAT_VIDEO, dureeCibleSecondes: DUREE_CIBLE_SECONDES,
    });
    // Les deux valeurs sont celles que le CONTRAT accepte — pas des nombres
    // choisis au hasard qui feraient un 422 en production.
    expect(FORMATS_MONTAGE).toContain(FORMAT_VIDEO);
    expect(DUREE_CIBLE_SECONDES).toBeGreaterThanOrEqual(DUREE_CIBLE_MIN_SECONDES);
    expect(DUREE_CIBLE_SECONDES).toBeLessThanOrEqual(DUREE_CIBLE_MAX_SECONDES);
  });

  it('1.3 le rendu part SANS corps — le contrat l’exige vide', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{ statut: 200, corps: jeu('reussie') }],
      [URL_MONTAGE]: [{ statut: 201, corps: { ok: true, plan: { id: PLAN } } }],
      [URL_RENDU]: [{ statut: 202, corps: { ok: true } }],
    });
    await lancer({ fetcher } as never);
    expect(appels.find((a) => a.url === URL_RENDU)!.corps).toBeNull();
  });

  it('1.4 un jeu déjà réussi n’est pas sondé', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{ statut: 200, corps: jeu('reussie') }],
      [URL_MONTAGE]: [{ statut: 200, corps: { ok: true, reutilise: true, plan: { id: PLAN } } }],
      [URL_RENDU]: [{ statut: 200, corps: { ok: true, reutilise: true } }],
    });
    const r = await lancer({ fetcher } as never);
    expect(r.sorte).toBe('deja_prete');
    expect(appels.some((a) => a.url === URL_JEU)).toBe(false);
  });

  it('1.5 les étapes sont signalées dans l’ordre', async () => {
    const { fetcher } = banc({
      [URL_CLIPS]: [{ statut: 200, corps: jeu('reussie') }],
      [URL_MONTAGE]: [{ statut: 201, corps: { ok: true, plan: { id: PLAN } } }],
      [URL_RENDU]: [{ statut: 202, corps: { ok: true } }],
    });
    const vues: string[] = [];
    await lancer({
      fetcher, signalerEtape: (e: string) => vues.push(e),
    } as never);
    expect(vues).toEqual(['decoupage', 'montage', 'rendu']);
  });
});

describe('2. L’arrêt à la première rupture', () => {
  it('2.1 un refus du découpage n’appelle ni montage ni rendu', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{
        statut: 409,
        corps: { ok: false, error: 'Cette recherche de passages n’a proposé aucun moment.' },
      }],
    });
    const r = await lancer({ fetcher } as never);
    expect(r).toEqual({
      sorte: 'echec',
      message: 'Cette recherche de passages n’a proposé aucun moment.',
    });
    expect(appels).toHaveLength(1);
  });

  it('2.2 un découpage qui échoue APRÈS le 202 arrête tout', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{ statut: 202, corps: jeu('en_attente') }],
      [URL_JEU]: [{ statut: 200, corps: jeu('echouee', 'media_illisible') }],
    });
    const r = await lancer({ fetcher } as never);
    expect(r).toEqual({ sorte: 'echec', message: 'Ce rush est illisible.' });
    expect(appels.some((a) => a.url === URL_MONTAGE)).toBe(false);
  });

  it('2.3 un refus du montage n’appelle jamais le rendu', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{ statut: 200, corps: jeu('reussie') }],
      [URL_MONTAGE]: [{
        statut: 409,
        corps: { ok: false, error: 'Les dimensions de ce rush ne sont pas connues.' },
      }],
    });
    const r = await lancer({ fetcher } as never);
    expect(r).toEqual({
      sorte: 'echec', message: 'Les dimensions de ce rush ne sont pas connues.',
    });
    expect(appels.some((a) => a.url === URL_RENDU)).toBe(false);
  });

  it('2.4 un jeu annulé est un échec, pas une réussite silencieuse', async () => {
    const { fetcher } = banc({
      [URL_CLIPS]: [{ statut: 202, corps: jeu('en_attente') }],
      [URL_JEU]: [{ statut: 200, corps: jeu('annulee', 'set_interrompu') }],
    });
    expect((await lancer({ fetcher } as never)).sorte).toBe('echec');
  });

  it('2.5 une session expirée le dit, sans reprendre le mot du serveur', async () => {
    const { fetcher } = banc({
      [URL_CLIPS]: [{ statut: 401, corps: { ok: false, error: 'Unauthorized' } }],
    });
    const r = await lancer({ fetcher } as never);
    expect(r).toEqual({ sorte: 'echec', message: 'Ta session a expiré. Reconnecte-toi.' });
  });

  it('2.6 une panne réseau ne fait pas croire à un lancement', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    const r = await lancer({ fetcher } as never);
    expect(r).toEqual({ sorte: 'echec', message: 'Réseau indisponible.' });
  });

  it('2.7 une réponse sans identifiant de jeu ne poursuit pas à l’aveugle', async () => {
    const { fetcher, appels } = banc({
      [URL_CLIPS]: [{ statut: 202, corps: { ok: true, clipSet: { etat: 'en_attente' } } }],
    });
    expect((await lancer({ fetcher } as never)).sorte).toBe('echec');
    expect(appels).toHaveLength(1);
  });
});

describe('3. Les issues du rendu', () => {
  const socle = {
    [URL_CLIPS]: [{ statut: 200, corps: jeu('reussie') }],
    [URL_MONTAGE]: [{ statut: 201, corps: { ok: true, plan: { id: PLAN } } }],
  };

  it('3.1 202 = lancée', async () => {
    const { fetcher } = banc({ ...socle, [URL_RENDU]: [{ statut: 202, corps: { ok: true } }] });
    expect((await lancer({ fetcher } as never)).sorte).toBe('lancee');
  });

  it('3.2 200 = déjà prête, aucun encodage relancé', async () => {
    const { fetcher } = banc({
      ...socle, [URL_RENDU]: [{ statut: 200, corps: { ok: true, reutilise: true } }],
    });
    expect((await lancer({ fetcher } as never)).sorte).toBe('deja_prete');
  });

  it('3.3 409 = déjà en cours, on la suit au lieu d’en lancer une seconde', async () => {
    const { fetcher } = banc({
      ...socle,
      [URL_RENDU]: [{ statut: 409, corps: { ok: false, motif: 'rendu_actif' } }],
    });
    expect((await lancer({ fetcher } as never)).sorte).toBe('deja_en_cours');
  });

  it('3.4 429 = le serveur est occupé, et le dit avec SES mots', async () => {
    const { fetcher } = banc({
      ...socle,
      [URL_RENDU]: [{
        statut: 429,
        corps: { ok: false, error: 'Un rendu est déjà en cours sur ce serveur.' },
      }],
    });
    expect(await lancer({ fetcher } as never)).toEqual({
      sorte: 'echec', message: 'Un rendu est déjà en cours sur ce serveur.',
    });
  });
});

describe('4. L’attente bornée', () => {
  it('4.1 abandonne l’attente sans prétendre que le travail est annulé', async () => {
    const { fetcher } = banc({
      [URL_CLIPS]: [{ statut: 202, corps: jeu('en_attente') }],
      [URL_JEU]: [{ statut: 200, corps: jeu('en_cours') }],
    });
    let t = 0;
    const r = await lancer({
      fetcher,
      attendre: async () => { t += ATTENTE_CLIPS_MAX_MS; },
      maintenant: () => t,
    } as never);
    expect(r.sorte).toBe('trop_long');
    if (r.sorte === 'trop_long') {
      expect(r.message).toMatch(/continue/i);
      expect(r.message).toMatch(/reclique/i);
    }
  });
});

describe('5. La traduction des motifs du découpage', () => {
  it('5.1 les DIX motifs de M3-F sont traduits, ni plus ni moins', () => {
    expect([...MOTIFS_CLIPS_TRADUITS].sort()).toEqual([...MOTIFS_CLIPS].sort());
  });

  it('5.2 aucune traduction ne laisse passer un mot de machine', () => {
    for (const motif of MOTIFS_CLIPS) {
      const m = messageClips(motif);
      expect(m.length).toBeGreaterThan(10);
      expect(m).toMatch(/[.!]$/);
      expect(m.toLowerCase()).not.toContain('_');
      expect(m.toLowerCase()).not.toContain(motif);
      expect(m).not.toMatch(/%/);
    }
  });

  it('5.3 un motif absent ou inconnu ne laisse pas l’écran muet', () => {
    expect(messageClips(null).length).toBeGreaterThan(10);
    expect(messageClips('inventé').length).toBeGreaterThan(10);
  });

  it('5.4 les trois phrases d’étape sont distinctes et sans chiffre', () => {
    const p = (['decoupage', 'montage', 'rendu'] as const).map(phraseChaine);
    expect(new Set(p).size).toBe(3);
    for (const x of p) {
      expect(x).toMatch(/…$/);
      expect(x).not.toMatch(/\d/);
    }
  });
});
