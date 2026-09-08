/**
 * A_7d4 — LE BOUTON « CRÉER MA VIDÉO » MONTE VRAIMENT PLUSIEURS RUSHES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DERNIER TROU DE LA CHAÎNE A_7
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * L'écran savait cocher plusieurs rushes, le serveur savait les monter — et
 * les deux ne se parlaient pas. Le bouton appelait
 * `/api/autopilot/clips/{clipSetId}/montage`, dont le chemin encode UN jeu de
 * clips : quel que soit le nombre de cases cochées, une seule source était
 * montée. La sélection multiple était une décoration.
 *
 * ⚠️ CE FICHIER TIENT AUSSI DEUX INTERDICTIONS :
 *
 *   1. AUCUNE DUPLICATION. Le manuel appelle le MÊME service serveur que le
 *      cycle automatique. Deux implémentations divergeraient, et le jour où
 *      l'une serait corrigée, l'autre continuerait ;
 *   2. UN SEUL BOUTON. Le produit choisit le chemin sur le NOMBRE de rushes,
 *      pas sur une seconde action que la personne devrait comprendre avant de
 *      cliquer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { creerVideo } from '@/lib/autopilot/analyse/chaine-passerelle';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const CANDIDATS = '44444444-4444-4444-8444-444444444444';

interface Appel { url: string; corps: Record<string, unknown> | null; methode: string }

/** Un serveur de test qui NOTE ce qu'on lui demande. */
function serveur(reponses: Record<string, { statut: number; corps?: unknown }>) {
  const appels: Appel[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    appels.push({
      url,
      methode: init?.method ?? 'GET',
      corps: init?.body ? JSON.parse(String(init.body)) : null,
    });
    /* ⚠️ LA CLE LA PLUS LONGUE GAGNE. `/api/autopilot/montages/x/rendu`
       contient `/montage` : chercher dans l'ordre de declaration ferait
       repondre la reponse du plan a l'appel de rendu, et le test « passerait »
       pour une mauvaise raison. */
    const clef = Object.keys(reponses)
      .filter((k) => url.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    const r = clef ? reponses[clef] : { statut: 404, corps: {} };
    return {
      ok: r.statut < 400,
      status: r.statut,
      json: async () => r.corps ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { fetcher, appels };
}

const SERVEUR_MULTI = {
  '/montages/multi-rush': { statut: 201, corps: { ok: true, plan: { id: 'plan-multi' } } },
  '/rendu': { statut: 202, corps: {} },
};

const SERVEUR_MONO = {
  '/candidats/': { statut: 200, corps: { clipSet: { id: 'jeu-1', etat: 'reussie' } } },
  '/clips/jeu-1/montage': { statut: 201, corps: { plan: { id: 'plan-mono' } } },
  '/rendu': { statut: 202, corps: {} },
};

const urls = (appels: Appel[]) => appels.map((a) => a.url);

// ═══════════════════════════════════════════════════════════════════════════
// 1. L'AIGUILLAGE
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7d4 — un seul bouton, deux chemins', () => {
  it('DEUX rushes → la route multi-rush, une seule fois', async () => {
    const { fetcher, appels } = serveur(SERVEUR_MULTI);
    const r = await creerVideo({
      candidateSetId: CANDIDATS, rushIds: [A, B],
      format: '9:16', dureeCibleSecondes: 16, fetcher,
    });
    expect(r.sorte).toBe('lancee');
    const multi = appels.filter((a) => a.url.includes('/montages/multi-rush'));
    expect(multi).toHaveLength(1);
    expect(multi[0].corps?.rushIds).toEqual([A, B]);
    /* ⚠️ LE DÉCOUPAGE MONO N'A PAS LIEU. Il monterait un seul jeu de clips —
       exactement le défaut que ce lot ferme. */
    expect(urls(appels).some((u) => u.includes('/candidats/'))).toBe(false);
  });

  it('TROIS rushes partent ensemble, dédupliqués', async () => {
    const { fetcher, appels } = serveur(SERVEUR_MULTI);
    await creerVideo({
      candidateSetId: CANDIDATS, rushIds: [A, B, A, C],
      format: '9:16', dureeCibleSecondes: 16, fetcher,
    });
    const multi = appels.find((a) => a.url.includes('/montages/multi-rush'));
    expect(multi?.corps?.rushIds).toEqual([A, B, C]);
  });

  it('UN SEUL rush → le chemin historique, intact', async () => {
    const { fetcher, appels } = serveur(SERVEUR_MONO);
    const r = await creerVideo({
      candidateSetId: CANDIDATS, rushIds: [A],
      format: '9:16', dureeCibleSecondes: 16, fetcher,
    });
    expect(r.sorte).toBe('lancee');
    /* Aucune ligne nouvelle ne s'exécute : découpage, plan mono, rendu. */
    expect(urls(appels).some((u) => u.includes('/montages/multi-rush'))).toBe(false);
    expect(urls(appels).some((u) => u.includes('/candidats/'))).toBe(true);
    expect(urls(appels).some((u) => u.includes('/clips/jeu-1/montage'))).toBe(true);
  });

  it('AUCUN rushId → le chemin historique, comme avant ce lot', async () => {
    const { fetcher, appels } = serveur(SERVEUR_MONO);
    await creerVideo({ candidateSetId: CANDIDATS, fetcher });
    expect(urls(appels).some((u) => u.includes('/montages/multi-rush'))).toBe(false);
  });

  it('le RENDU est le même appel pour les deux chemins', async () => {
    /* ⚠️ UN PLAN MULTI-RUSH EST UN PLAN. Cette route sait le rendre depuis
       A_7c ; lui écrire un second appel aurait donné deux jeux de codes de
       retour à tenir d'accord. */
    const multi = serveur(SERVEUR_MULTI);
    await creerVideo({
      candidateSetId: CANDIDATS, rushIds: [A, B], fetcher: multi.fetcher,
    });
    const mono = serveur(SERVEUR_MONO);
    await creerVideo({ candidateSetId: CANDIDATS, rushIds: [A], fetcher: mono.fetcher });

    expect(urls(multi.appels).pop()).toBe('/api/autopilot/montages/plan-multi/rendu');
    expect(urls(mono.appels).pop()).toBe('/api/autopilot/montages/plan-mono/rendu');
  });

  it('la recette audio suit le plan multi-rush jusqu au rendu', async () => {
    const { fetcher, appels } = serveur(SERVEUR_MULTI);
    await creerVideo({
      candidateSetId: CANDIDATS, rushIds: [A, B],
      audio: { sonOriginal: true } as never, fetcher,
    });
    const rendu = appels.find((a) => a.url.includes('/rendu'));
    expect(rendu?.corps?.audio).toEqual({ sonOriginal: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. UNE SEULE SOURCE : UN AIGUILLAGE, PAS UNE PANNE
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7d4 — quand une seule source survit', () => {
  it('le montage repart sur le chemin mono plutôt que d échouer', async () => {
    /* ⚠️ LA VIDÉO DEMANDÉE EST FAISABLE, simplement pas avec la matière
       espérée. Annoncer une panne ferait perdre un montage possible. */
    const { fetcher, appels } = serveur({
      '/montages/multi-rush': {
        statut: 409, corps: { ok: false, motif: 'source_unique', rushId: A },
      },
      ...SERVEUR_MONO,
    });
    const r = await creerVideo({
      candidateSetId: CANDIDATS, rushIds: [A, B],
      format: '9:16', dureeCibleSecondes: 16, fetcher,
    });
    expect(r.sorte).toBe('lancee');
    expect(urls(appels).some((u) => u.includes('/candidats/'))).toBe(true);
    expect(urls(appels).pop()).toBe('/api/autopilot/montages/plan-mono/rendu');
  });

  it('un autre 409 reste une erreur, pas un repli', () => {
    /* Le repli est réservé au motif nommé : replier sur tout 409 monterait un
       seul rush là où le serveur disait autre chose. */
    const src = sansProse(lire('src/lib/autopilot/analyse/chaine-passerelle.ts'));
    expect(src).toContain("=== 'source_unique'");
  });

  it('une vraie panne remonte un message, jamais un montage partiel', async () => {
    const { fetcher, appels } = serveur({
      '/montages/multi-rush': {
        statut: 422, corps: { ok: false, error: 'Aucun rush exploitable.' },
      },
    });
    const r = await creerVideo({
      candidateSetId: CANDIDATS, rushIds: [A, B], fetcher,
    });
    expect(r.sorte).toBe('echec');
    expect(urls(appels).some((u) => u.includes('/rendu'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LA ROUTE SERVEUR
// ═══════════════════════════════════════════════════════════════════════════
const auth = vi.fn();
const lireRush = vi.fn();
const monterMultiRush = vi.fn();
const objectifCompte = vi.fn();

vi.mock('@/lib/auth/config', () => ({ auth: () => auth() }));
vi.mock('@/lib/autopilot/tournage/service', () => ({
  lireRush: (...a: unknown[]) => lireRush(...a),
}));
vi.mock('@/lib/autopilot/automatique/multi-rush', () => ({
  monterMultiRush: (...a: unknown[]) => monterMultiRush(...a),
}));
vi.mock('@/lib/autopilot/analyse/objectif-compte', () => ({
  objectifEffectifUtilisateur: (...a: unknown[]) => objectifCompte(...a),
}));

const UTILISATEUR = '99999999-9999-4999-8999-999999999999';

const requete = (corps: unknown) =>
  ({ json: async () => corps }) as never;

beforeEach(() => {
  auth.mockReset(); lireRush.mockReset();
  monterMultiRush.mockReset(); objectifCompte.mockReset();
  auth.mockResolvedValue({ user: { id: UTILISATEUR } });
  lireRush.mockResolvedValue({ rush: { id: 'x' }, motif: null });
  objectifCompte.mockResolvedValue(null);
  monterMultiRush.mockResolvedValue({
    plan: { id: 'plan-multi', version: 1 }, motif: null,
    sources: [{ rushId: A, clipSetId: 'sA' }, { rushId: B, clipSetId: 'sB' }],
    ecartees: [], rushUnique: null, resultat: null,
  });
});

describe('A_7d4 — la route délègue, elle ne décide pas', () => {
  it('elle appelle LE service partagé, une seule fois', async () => {
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({
      rushIds: [A, B], format: '9:16', dureeCibleSecondes: 16,
    }));
    expect(r.status).toBe(201);
    expect(monterMultiRush).toHaveBeenCalledTimes(1);
    expect(monterMultiRush.mock.calls[0][0]).toMatchObject({
      userId: UTILISATEUR, rushIds: [A, B], format: '9:16', dureeCibleSecondes: 16,
    });
  });

  it('elle refuse un rush qui n appartient pas au compte', async () => {
    /* ⚠️ AVANT LE MOINDRE APPEL DE FOURNISSEUR. Laisser `preparerRush` le
       filtrer rendrait « écarté » — un diagnostic FAUX, et une analyse déjà
       payée. Aucune différence de message avec « n'existe pas » : la
       distinction apprendrait à un tiers quels identifiants existent. */
    lireRush.mockImplementation(async (_u: string, id: string) =>
      ({ rush: id === A ? { id: A } : null, motif: null }));
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({
      rushIds: [A, B], format: '9:16', dureeCibleSecondes: 16,
    }));
    expect(r.status).toBe(404);
    expect(monterMultiRush).not.toHaveBeenCalled();
    expect((await r.json()).error).toMatch(/plus disponible/);
  });

  it('elle refuse au-delà du plafond d A_7b', async () => {
    const { MAX_RUSHES_MANUEL } = await import('@/lib/autopilot/analyse/montage-pool');
    const trop = Array.from({ length: MAX_RUSHES_MANUEL + 1 }, (_, i) =>
      `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({
      rushIds: trop, format: '9:16', dureeCibleSecondes: 16,
    }));
    expect(r.status).toBe(400);
    expect((await r.json()).motif).toBe('trop_de_rushes');
    expect(monterMultiRush).not.toHaveBeenCalled();
  });

  it('elle refuse un seul rush — le mono a son chemin', async () => {
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({
      rushIds: [A], format: '9:16', dureeCibleSecondes: 16,
    }));
    expect(r.status).toBe(400);
    expect((await r.json()).motif).toBe('sources_insuffisantes');
  });

  it('elle déduplique avant de compter', async () => {
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    await POST(requete({ rushIds: [A, A, B], format: '9:16', dureeCibleSecondes: 16 }));
    expect(monterMultiRush.mock.calls[0][0].rushIds).toEqual([A, B]);
  });

  it('elle refuse un identifiant malformé', async () => {
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({
      rushIds: [A, '../../etc/passwd'], format: '9:16', dureeCibleSecondes: 16,
    }));
    expect(r.status).toBe(400);
    expect(monterMultiRush).not.toHaveBeenCalled();
  });

  it('elle refuse un format ou une durée hors contrat', async () => {
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    expect((await POST(requete({
      rushIds: [A, B], format: 'portrait', dureeCibleSecondes: 16,
    }))).status).toBe(400);
    expect((await POST(requete({
      rushIds: [A, B], format: '9:16', dureeCibleSecondes: 9000,
    }))).status).toBe(400);
    expect(monterMultiRush).not.toHaveBeenCalled();
  });

  it('sans session, rien n est lu', async () => {
    auth.mockResolvedValue(null);
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({ rushIds: [A, B], format: '9:16', dureeCibleSecondes: 16 }));
    expect(r.status).toBe(401);
    expect(lireRush).not.toHaveBeenCalled();
  });

  it('une seule source survivante rend 409 `source_unique` avec le rush', async () => {
    monterMultiRush.mockResolvedValue({
      plan: null, motif: 'source_unique', sources: [],
      ecartees: [{ rushId: B, motif: 'analyse_echouee' }], rushUnique: A, resultat: null,
    });
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({
      rushIds: [A, B], format: '9:16', dureeCibleSecondes: 16,
    }));
    expect(r.status).toBe(409);
    const corps = await r.json();
    expect(corps.motif).toBe('source_unique');
    expect(corps.rushId).toBe(A);
  });

  it('ce qui n a pas pu servir est DIT, jamais tu', async () => {
    /* « 2 rushes sur 3 ont été utilisés » vaut mieux qu'une vidéo plus courte
       que prévu dont personne n'explique pourquoi. */
    monterMultiRush.mockResolvedValue({
      plan: { id: 'p', version: 1 }, motif: null,
      sources: [{ rushId: A, clipSetId: 'sA' }],
      ecartees: [{ rushId: C, motif: 'analyse_echouee' }], rushUnique: null, resultat: null,
    });
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const r = await POST(requete({
      rushIds: [A, B, C], format: '9:16', dureeCibleSecondes: 16,
    }));
    expect((await r.json()).ecartees).toEqual([{ rushId: C, motif: 'analyse_echouee' }]);
  });

  it('aucun détail d infrastructure ne remonte au navigateur', async () => {
    monterMultiRush.mockResolvedValue({
      plan: null, motif: 'socle_absent', sources: [], ecartees: [],
      rushUnique: null, resultat: null,
    });
    const { POST } = await import('@/app/api/autopilot/montages/multi-rush/route');
    const corps = await (await POST(requete({
      rushIds: [A, B], format: '9:16', dureeCibleSecondes: 16,
    }))).json();
    for (const interdit of ['PGRST', 'postgres', 'ffmpeg', 'supabase', 'SELECT']) {
      expect(JSON.stringify(corps).toLowerCase())
        .not.toContain(interdit.toLowerCase());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CE QUE LE LOT NE FAIT PAS
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7d4 — aucune duplication, aucune frontière franchie', () => {
  const ROUTE = sansProse(lire('src/app/api/autopilot/montages/multi-rush/route.ts'));
  const PASSERELLE = sansProse(lire('src/lib/autopilot/analyse/chaine-passerelle.ts'));

  it('la route délègue au service de l automatique, sans le recopier', () => {
    expect(ROUTE).toContain('monterMultiRush');
    for (const interdit of ['preparerJeuClips', 'planifierMontageMultiRush',
      'creerPlanMultiRushAtomique', 'materialiserSet', 'politiqueDePlan']) {
      expect(ROUTE, `la route ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('la route ne rend pas — le rendu a sa route', () => {
    expect(ROUTE).not.toContain('rendreMontage');
    expect(ROUTE).not.toContain('argumentsRendu');
  });

  it('le navigateur n envoie que des intentions', () => {
    /* Ni URL, ni chemin de fichier, ni transcription, ni jeu de clips : la
       lignée se résout côté serveur. */
    const corps = PASSERELLE.slice(PASSERELLE.indexOf("'/api/autopilot/montages/multi-rush'"));
    const bloc = corps.slice(0, 500);
    expect(bloc).toContain('rushIds: rushes');
    for (const interdit of ['bucket', 'cle', 'clipSetId', 'transcription', 'url']) {
      expect(bloc, `le corps ne doit pas porter « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('le rendu n existe qu en UN endroit de la passerelle', () => {
    expect((PASSERELLE.match(/\/rendu`/g) ?? []).length).toBe(1);
  });

  it('un seul bouton : aucune seconde action « multi-rush »', () => {
    const bouton = lire('src/components/creer/PassagesSuggeres.tsx');
    expect((bouton.match(/data-chaine-bouton/g) ?? []).length).toBe(1);
    expect(bouton).not.toContain('Créer multi-rush');
  });

  it('la garde de double soumission est celle qui existait', () => {
    /* Deux clics rapides ne doivent pas lancer deux travaux : le verrou est
       posé avant l'appel et relâché en `finally`. */
    const bouton = sansProse(lire('src/components/creer/PassagesSuggeres.tsx'));
    expect(bouton).toContain('if (verrouRef.current) return;');
    expect(bouton).toContain('verrouRef.current = true;');
    expect(bouton).toContain('verrouRef.current = false;');
  });

  it('un montage à plusieurs rushes reste UNE vidéo facturée une fois', () => {
    const orchestre = sansProse(lire('src/lib/autopilot/automatique/multi-rush.ts'));
    expect(ROUTE).not.toContain('@/lib/credits');
    expect(orchestre).not.toContain('@/lib/credits');
  });

  it('aucune publication n est déclenchée', () => {
    for (const interdit of ['@/lib/social', 'social/publish', 'publierPost']) {
      expect(ROUTE, `la route ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LA FRONTIÈRE CLIENT / SERVEUR
// ═══════════════════════════════════════════════════════════════════════════
describe('A_7d4 — aucun module client n embarque la base', () => {
  /**
   * ⚠️ CE BANC EXISTE PARCE QUE LE BUILD A DÉJÀ CASSÉ ICI. A_7d2 a importé
   * `MAX_RUSHES_MANUEL` depuis l'écran ; `montage-pool` portait alors
   * `persisterPlanMultiRush`, donc le client Postgres, et le bundle navigateur
   * a échoué. Une constante partagée doit vivre dans un module PUR — pas dans
   * un service serveur qu'on importerait pour aller la chercher.
   */
  const suivre = (depart: string): string[] => {
    const vus = new Set<string>();
    const pile = [depart];
    while (pile.length > 0) {
      const f = pile.pop() as string;
      if (vus.has(f)) continue;
      vus.add(f);
      let src: string;
      try { src = lire(f); } catch { continue; }
      for (const m of src.matchAll(/from '(@\/[^']+)'/g)) {
        const rel = `src/${m[1].slice(2)}`;
        for (const ext of ['.ts', '.tsx', '/index.ts']) {
          try { lire(rel + ext); pile.push(rel + ext); break; } catch { /* suivant */ }
        }
      }
    }
    return [...vus];
  };

  it('montage-pool reste PUR : ni base, ni réseau, ni horloge', () => {
    const atteints = suivre('src/lib/autopilot/analyse/montage-pool.ts');
    expect(atteints).not.toContain('src/lib/db/supabase.ts');
    const src = sansProse(lire('src/lib/autopilot/analyse/montage-pool.ts'));
    for (const interdit of ['supabase', 'fetch(', 'Date.now', 'Math.random']) {
      expect(src, `montage-pool ne doit pas contenir « ${interdit} »`)
        .not.toContain(interdit);
    }
  });

  it('l écran de sélection n atteint jamais le client de base', () => {
    for (const ecran of [
      'src/components/creer/BandeRushes.tsx',
      'src/components/creer/SessionsTournagePanel.tsx',
      'src/components/creer/PassagesSuggeres.tsx',
    ]) {
      const atteints = suivre(ecran);
      expect(atteints, `${ecran} atteint le client de base`)
        .not.toContain('src/lib/db/supabase.ts');
      expect(atteints, `${ecran} atteint l orchestrateur serveur`)
        .not.toContain('src/lib/autopilot/automatique/multi-rush.ts');
    }
  });

  it('la passerelle cliente ne touche que des routes HTTP', () => {
    const atteints = suivre('src/lib/autopilot/analyse/chaine-passerelle.ts');
    expect(atteints).not.toContain('src/lib/db/supabase.ts');
    expect(atteints).not.toContain('src/lib/autopilot/automatique/multi-rush.ts');
  });
});
