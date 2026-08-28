/**
 * M3-B2 — La borne de capacité : UNE extraction à la fois sur ce serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le VRAI gestionnaire de route est appelé, avec DEUX requêtes qui se
 * chevauchent réellement. Ce n'est pas une simulation : la première est
 * suspendue À L'INTÉRIEUR du moteur, la seconde part pendant qu'elle y est,
 * et on regarde ce que le serveur répond.
 *
 * Quatre choses, et elles se tiennent :
 *
 *  1. la place est bien prise pendant la mesure, et pas seulement comptée ;
 *  2. le refus est un 429 avec `Retry-After`, et rien n'est écrit en base ;
 *  3. la place est rendue par TOUTES les sorties — succès, erreur levée,
 *     délai dépassé, résultat invalide, analyse déjà active ;
 *  4. la borne de capacité ne MASQUE pas l'idempotence : un rush qui traîne
 *     une analyse active répond toujours 409, jamais 429.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LE POINT 3 EST LE PLUS IMPORTANT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une place non rendue ne casse rien tout de suite : la requête en cours
 * réussit, et c'est la SUIVANTE qui est refusée — puis toutes les autres,
 * pour toujours, jusqu'au redémarrage du service. Avec `MAX = 1`, une seule
 * fuite suffit à éteindre la fonctionnalité entière, et le symptôme (« tout
 * répond 429 ») ne pointe pas vers la sortie qui a fui.
 *
 * D'où un cas par sortie, et pas seulement pour le chemin heureux.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur d'extraction. Comme dans `autopilote-m3b2-route.test.ts`, il est
 * injecté par `definirMoteurExtraction` et le module réel est neutralisé :
 * aucun ffmpeg ne démarre, et « moteur absent » reste simulable.
 *
 * La borne entre PLUSIEURS processus non plus — et pour cause, elle n'existe
 * pas. Le compteur est en mémoire, il ne borne que le processus qui le porte.
 * `capacite.ts` documente pourquoi c'est suffisant aujourd'hui (un seul
 * `node server.js`) et ce qu'il faudrait le jour où ça ne l'est plus.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  definirMoteurExtraction,
  type DemandeExtraction, type ResultatExtraction,
} from '@/lib/autopilot/analyse/moteur';
import {
  MAX_EXTRACTIONS_SIMULTANEES, RETRY_APRES_SECONDES,
  MOTIF_CAPACITE_SATUREE, MESSAGE_CAPACITE_SATUREE,
  prendrePlaceExtraction, extractionsEnCours, reinitialiserCapacite,
} from '@/lib/autopilot/analyse/capacite';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/**
 * Le moteur réel est neutralisé — même raison qu'en `…-route.test.ts`.
 *
 * Sans cela, `definirMoteurExtraction(null)` retomberait sur l'import
 * dynamique, trouverait `extraireRush`, et lancerait une VRAIE mesure : sans
 * MinIO, une requête réseau par test, et des durées qui n'ont rien à voir
 * avec ce qu'on mesure ici. Le vocabulaire est conservé, la fonction seule
 * disparaît.
 */
vi.mock('@/lib/autopilot/analyse/extraction', async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  return { MOTIFS_EXTRACTION: reel.MOTIFS_EXTRACTION };
});

// ───────────────────────────────────────────────────────────────────────────
// La même doublure de base qu'en `…-route.test.ts` : les `.eq()` sont
// appliqués, et les deux index uniques de `rush_analyses` aussi. Sans eux,
// le cas 8 — l'idempotence non masquée — ne serait qu'un `if` de test.
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;

/** Les insertions ACCEPTÉES par la base. */
const insertions: Array<{ table: string; valeurs: Ligne }> = [];
/**
 * Les insertions TENTÉES, refus compris.
 *
 * C'est la preuve qui compte pour le cas 3 : « aucune ligne n'existe » se
 * satisferait d'une insertion refusée par la base. Ce qu'on exige est plus
 * fort — que la route n'ait même pas ESSAYÉ d'écrire.
 */
const tentativesInsertion: Array<{ table: string; valeurs: Ligne }> = [];

const erreurTable = { code: '42P01', message: 'relation does not exist' };

function doublon(index: string) {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${index}"`,
  };
}

function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const lignes = tables.rush_analyses ?? [];
  const memeRush = lignes.filter((l) => l.rush_id === valeurs.rush_id);
  if (memeRush.some((l) => l.version === valeurs.version)) {
    return doublon('rush_analyses_rush_version_unique');
  }
  const actif = (e: unknown) => e === 'en_attente' || e === 'en_cours';
  if (actif(valeurs.etat) && memeRush.some((l) => actif(l.etat))) {
    return doublon('rush_analyses_active_unique');
  }
  return null;
}

/**
 * `<` sur un `timestamptz`, ajouté par M3-B2.1.
 *
 * `recupererAnalysesInterrompues` filtre sur `updated_at < seuil` — une
 * doublure qui ignorerait `.lt()` laisserait passer la fermeture d'analyses
 * VIVANTES sans qu'aucun test ne s'en aperçoive. La comparaison porte donc
 * sur des DATES, pas sur des chaînes.
 */
function anterieurA(valeur: unknown, borne: unknown): boolean {
  const a = Date.parse(String(valeur));
  const b = Date.parse(String(borne));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a < b;
}

/**
 * L'horodatage d'une ligne d'analyse POSÉE À L'INSTANT.
 *
 * ⚠️ PAS UNE DATE EN DUR, ET C'EST M3-B2.1 QUI L'EXIGE. Depuis que
 * `creerAnalyse` ferme les analyses actives dont l'`updated_at` a dépassé
 * `PEREMPTION_ANALYSE_MS`, une analyse « active » figée à une date littérale
 * finit par devenir périmée avec le simple passage du temps réel : les tests
 * d'idempotence verraient un 201 là où ils attendent un 409, et ils le
 * verraient un jour donné, sans qu'aucun commit n'ait bougé. Une analyse
 * vivante se date maintenant.
 */
const maintenantIso = () => new Date().toISOString();

function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const filtresIn: Array<[string, unknown[]]> = [];
  const filtresLt: Array<[string, unknown]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMettreAJour: Ligne | null = null;

  const lignes = () => {
    let out = (tables[table] ?? []).filter(
      (l) => filtres.every(([c, v]) => l[c] === v)
        && filtresIn.every(([c, vs]) => vs.includes(l[c]))
        && filtresLt.every(([c, v]) => anterieurA(l[c], v)),
    );
    if (tri) {
      out = [...out].sort((a, b) => {
        const x = Number(a[tri!.colonne] ?? 0); const y = Number(b[tri!.colonne] ?? 0);
        return tri!.asc ? x - y : y - x;
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = () => {
    if (aInserer) {
      const valeurs: Ligne = { version: 1, etat: 'en_attente', ...aInserer };
      tentativesInsertion.push({ table, valeurs: aInserer });
      if (table === 'rush_analyses') {
        const rush = (tables.rushes ?? []).find(
          (r) => r.id === valeurs.rush_id && r.user_id === valeurs.user_id,
        );
        if (!rush) {
          return {
            data: null,
            error: {
              code: '23503',
              message: 'violates foreign key constraint "rush_analyses_rush_meme_proprietaire"',
            },
          };
        }
        const refus = refusUnicite(valeurs);
        if (refus) return { data: null, error: refus };
      }
      const ligne: Ligne = {
        id: `${table}-${(tables[table] ?? []).length + 1}`,
        etape: null,
        fournisseurs: {},
        duree_secondes: null,
        technique: {},
        resume: null,
        textes_visibles: [],
        parole: {},
        audio: {},
        qualite: {},
        vignettes: [],
        usage: {},
        motif_echec: null,
        created_at: maintenantIso(),
        updated_at: maintenantIso(),
        ...valeurs,
      };
      insertions.push({ table, valeurs: aInserer });
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      const cibles = lignes();
      if (cibles.length === 0) return { data: null, error: null };
      const patch = aMettreAJour;
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      const misAJour = (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null;
      return { data: misAJour, error: null };
    }

    const l = lignes();
    return { data: l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { filtresIn.push([c, vs]); return api; },
    lt: (c: string, v: unknown) => { filtresLt.push([c, v]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (valeurs: Ligne) => { aInserer = valeurs; return api; },
    update: (valeurs: Ligne) => { aMettreAJour = valeurs; return api; },
    maybeSingle: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => {
      const l = lignes();
      return resoudre(l === null ? { data: null, error: erreurTable } : { data: l, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

const { POST, maxDuration } = await import(
  '@/app/api/autopilot/rushes/[id]/analyse/route'
);

// ───────────────────────────────────────────────────────────────────────────
// DEUX rushes du MÊME propriétaire.
//
// C'est ce qui distingue ce fichier de l'idempotence : deux rushes différents
// ne se disputent AUCUN index unique. Tout ce qui les oppose est la machine.
// ───────────────────────────────────────────────────────────────────────────
const RUSH_1: Ligne = {
  id: 'r-1', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan-1.mp4', nom_origine: 'plan-1.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};
const RUSH_2: Ligne = {
  ...RUSH_1, id: 'r-2', rang: 1,
  cle_objet: 'A/rush/plan-2.mp4', nom_origine: 'plan-2.mp4',
};

const EXTRACTION_OK: ResultatExtraction = {
  ok: true,
  dureeSecondes: 42.5,
  technique: { largeur: 1080, hauteur: 1920, fps: 30, audio: true },
  vignettes: [],
};

let appelsMoteur: DemandeExtraction[] = [];

function appeler(rushId: string) {
  const req = new Request(`http://x/api/autopilot/rushes/${rushId}/analyse`, { method: 'POST' });
  return POST(req as never, { params: { id: rushId } });
}

/**
 * Un moteur qui SE SUSPEND — c'est lui qui rend le chevauchement réel.
 *
 * Il rend la main à la boucle d'événements au milieu de la mesure. La route
 * appelante est alors bloquée sur son `await`, la place est prise, et une
 * seconde requête peut traverser la route de bout en bout pendant ce temps.
 *
 * Sans cette suspension, deux `await appeler(...)` successifs ne se
 * chevaucheraient jamais et ce fichier ne testerait rien.
 */
function moteurSuspendu(resultat: ResultatExtraction = EXTRACTION_OK) {
  let relacher!: () => void;
  const barriere = new Promise<void>((r) => { relacher = r; });
  const moteur = async (demande: DemandeExtraction) => {
    appelsMoteur.push(demande);
    await barriere;
    return resultat;
  };
  return { moteur, relacher };
}

/** Attend que le moteur ait été atteint — sans jamais dormir « au cas où ». */
async function attendreEntreeMoteur(n = 1) {
  for (let i = 0; i < 200 && appelsMoteur.length < n; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
  expect(appelsMoteur.length).toBeGreaterThanOrEqual(n);
}

beforeEach(() => {
  insertions.length = 0;
  tentativesInsertion.length = 0;
  appelsMoteur = [];
  reinitialiserCapacite();
  authMock.mockResolvedValue({ user: { id: 'A' } });
  definirMoteurExtraction(async (d) => { appelsMoteur.push(d); return EXTRACTION_OK; });
  tables = {
    rushes: [{ ...RUSH_1 }, { ...RUSH_2 }],
    rush_analyses: [],
  };
});

afterEach(() => {
  // Un test qui laisserait une place prise ferait échouer le SUIVANT, et le
  // rapport accuserait le mauvais.
  expect(extractionsEnCours()).toBe(0);
});

// ───────────────────────────────────────────────────────────────────────────
describe('La politique : une seule extraction à la fois', () => {
  it('la borne V1 vaut 1 — le minimum, assumé', () => {
    expect(MAX_EXTRACTIONS_SIMULTANEES).toBe(1);
  });

  it('`Retry-After` ne peut pas diverger du budget de la route', () => {
    // Une place ne peut pas rester prise plus longtemps que la requête qui la
    // détient. Annoncer une valeur plus courte ferait revenir le client pile
    // pour se faire refuser de nouveau.
    expect(RETRY_APRES_SECONDES).toBe(maxDuration);
  });

  it('le jeton ne rend sa place qu UNE fois, même appelé deux fois', () => {
    const place = prendrePlaceExtraction()!;
    expect(extractionsEnCours()).toBe(1);
    place.liberer();
    place.liberer();
    // Sans la garde, le compteur passerait à -1 : des places qui n'existent
    // pas, et la borne ne bornerait plus rien.
    expect(extractionsEnCours()).toBe(0);
    expect(prendrePlaceExtraction()).not.toBeNull();
    reinitialiserCapacite();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('1 — La première analyse prend la place', () => {
  it('pendant la mesure, une place est prise', async () => {
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();

    // La place est prise PENDANT le travail, et pas seulement comptée après.
    expect(extractionsEnCours()).toBe(1);

    relacher();
    expect((await premiere).status).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('2 et 3 — Un second rush pendant la mesure est refusé, sans rien écrire', () => {
  it('429, motif `analyse_capacite_saturee`, en-tête `Retry-After`', async () => {
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();

    const seconde = await appeler('r-2');

    // 429 et non 503 : le service marche, il est occupé.
    expect(seconde.status).toBe(429);
    const corps = await seconde.json();
    expect(corps.ok).toBe(false);
    expect(corps.motif).toBe(MOTIF_CAPACITE_SATUREE);
    expect(corps.error).toBe(MESSAGE_CAPACITE_SATUREE);
    // Explicite : sans en-tête, le client retente immédiatement.
    expect(seconde.headers.get('Retry-After')).toBe(String(RETRY_APRES_SECONDES));

    relacher();
    expect((await premiere).status).toBe(201);
  });

  it('AUCUNE ligne d analyse n est créée pour la requête refusée', async () => {
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();

    expect((await appeler('r-2')).status).toBe(429);

    // Ni acceptée, ni même TENTÉE : une ligne créée puis abandonnée resterait
    // active, occuperait `rush_analyses_active_unique`, et interdirait toute
    // relance de `r-2`.
    expect(tentativesInsertion.filter((t) => t.valeurs.rush_id === 'r-2')).toHaveLength(0);
    expect(insertions.filter((t) => t.valeurs.rush_id === 'r-2')).toHaveLength(0);
    expect((tables.rush_analyses ?? []).filter((l) => l.rush_id === 'r-2')).toHaveLength(0);

    // Et le moteur n'a pas tourné une seconde fois : c'est tout l'objet de la
    // borne.
    expect(appelsMoteur).toHaveLength(1);

    relacher();
    await premiere;
  });

  it('le refus de capacité ne touche pas non plus l analyse en cours', async () => {
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();
    await appeler('r-2');

    const enCours = (tables.rush_analyses ?? []).filter((l) => l.rush_id === 'r-1');
    expect(enCours).toHaveLength(1);
    expect(enCours[0].etat).toBe('en_cours');

    relacher();
    expect((await premiere).status).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('4 et 5 — La place rendue rouvre le service', () => {
  it('la première finie, la place est libre', async () => {
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();
    expect(extractionsEnCours()).toBe(1);

    relacher();
    expect((await premiere).status).toBe(201);
    expect(extractionsEnCours()).toBe(0);
  });

  it('la seconde, refusée pendant, passe une fois la place rendue', async () => {
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();
    expect((await appeler('r-2')).status).toBe(429);

    relacher();
    await premiere;

    // Aucun ré-essai automatique : c'est l'appelant qui relance, et ça marche.
    definirMoteurExtraction(async (d) => { appelsMoteur.push(d); return EXTRACTION_OK; });
    const reprise = await appeler('r-2');
    expect(reprise.status).toBe(201);
    expect((await reprise.json()).analyse.etat).toBe('reussie');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('6 et 7 — Une place est rendue même quand le travail échoue', () => {
  it('le moteur LÈVE : 500, et la place est rendue', async () => {
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      throw new Error('ffmpeg a disparu');
    });

    const r = await appeler('r-1');
    expect(r.status).toBe(500);
    expect((await r.json()).motif).toBe('moteur_en_erreur');
    expect(extractionsEnCours()).toBe(0);

    // La preuve qui compte : le service répond encore.
    definirMoteurExtraction(async (d) => { appelsMoteur.push(d); return EXTRACTION_OK; });
    expect((await appeler('r-2')).status).toBe(201);
  });

  it('le délai est dépassé : 504, et la place est rendue', async () => {
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      return { ok: false, motif: 'timeout' } as ResultatExtraction;
    });

    const r = await appeler('r-1');
    // 504 : le seul échec dont on sait qu'il peut ne pas se reproduire.
    expect(r.status).toBe(504);
    expect((await r.json()).motif).toBe('timeout');
    expect(extractionsEnCours()).toBe(0);

    definirMoteurExtraction(async (d) => { appelsMoteur.push(d); return EXTRACTION_OK; });
    expect((await appeler('r-2')).status).toBe(201);
  });

  it('un résultat inexploitable : 500, et la place est rendue', async () => {
    // Troisième sortie d'échec, celle qu'on oublie : le moteur n'a ni levé ni
    // rendu un motif connu — il a rendu n'importe quoi.
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      return { ok: true, dureeSecondes: 0 } as unknown as ResultatExtraction;
    });

    const r = await appeler('r-1');
    expect(r.status).toBe(500);
    expect((await r.json()).motif).toBe('resultat_moteur_invalide');
    expect(extractionsEnCours()).toBe(0);
  });

  it('le moteur est absent : 503, et la place est rendue', async () => {
    definirMoteurExtraction(null);
    const r = await appeler('r-1');
    expect(r.status).toBe(503);
    expect((await r.json()).motif).toBe('moteur_absent');
    expect(extractionsEnCours()).toBe(0);
  });

  it('le succès aussi rend sa place', async () => {
    expect((await appeler('r-1')).status).toBe(201);
    expect(extractionsEnCours()).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('8 — L idempotence par rush n est PAS masquée par la capacité', () => {
  it('deux requêtes SIMULTANÉES sur le même rush : 409, et non 429', async () => {
    // C'est LE cas où la borne pourrait tout casser. Avec une seule place,
    // la seconde requête sur le même rush trouve toujours la place prise :
    // si elle répondait 429, le refus d'idempotence de M3-B1 deviendrait
    // inatteignable sous concurrence — c'est-à-dire dans la seule situation
    // où il existe.
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();

    const seconde = await appeler('r-1');

    expect(seconde.status).toBe(409);
    const corps = await seconde.json();
    expect(corps.motif).toBe('analyse_active_existante');
    // La réponse a la MÊME forme que le 409 rendu par la base : l'analyse
    // gagnante est jointe, pour que le perdant sache quoi suivre.
    expect(corps.analyse.etat).toBe('en_cours');
    expect(corps.error).toBe('Une analyse de ce rush est déjà en cours.');
    // Le refus n'a rien écrit, et n'a pas relancé le moteur.
    expect(tentativesInsertion.filter((t) => t.table === 'rush_analyses')).toHaveLength(1);
    expect(appelsMoteur).toHaveLength(1);

    relacher();
    expect((await premiere).status).toBe(201);
    expect(tables.rush_analyses).toHaveLength(1);
  });

  it('le 429 reste pour un AUTRE rush — les deux refus ne se confondent pas', async () => {
    const { moteur, relacher } = moteurSuspendu();
    definirMoteurExtraction(moteur);

    const premiere = appeler('r-1');
    await attendreEntreeMoteur();

    // Même place prise, même instant : seule l'identité du rush change, et
    // elle change le motif. Un serveur qui rendrait 409 ici mentirait — rien
    // n'analyse `r-2`.
    expect((await appeler('r-1')).status).toBe(409);
    expect((await appeler('r-2')).status).toBe(429);

    relacher();
    await premiere;
  });

  it('une analyse active qui traîne donne 409, et non 429', async () => {
    // Le cas réel : une requête précédente a laissé une analyse `en_cours`
    // (processus tué pendant la mesure). Aucune place n'est prise — le
    // compteur, lui, est mort avec le processus — et pourtant ce rush ne doit
    // pas être analysé deux fois.
    tables.rush_analyses = [{
      id: 'a-1', rush_id: 'r-1', user_id: 'A', version: 1,
      etat: 'en_cours', etape: 'extraction',
      fournisseurs: {}, duree_secondes: null, technique: {}, resume: null,
      textes_visibles: [], parole: {}, audio: {}, qualite: {}, vignettes: [],
      usage: {}, motif_echec: null,
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    expect(extractionsEnCours()).toBe(0);

    const r = await appeler('r-1');

    // 409 de la BASE, pas 429 de la capacité. Un 429 ici serait un mensonge :
    // le serveur n'est pas plein, ce rush est déjà pris.
    expect(r.status).toBe(409);
    const corps = await r.json();
    expect(corps.motif).toBe('analyse_active_existante');
    // L'analyse gagnante est rendue, pour que l'appelant sache quoi suivre.
    expect(corps.analyse.id).toBe('a-1');

    // Et le refus d'idempotence rend lui aussi sa place — sinon le premier
    // doublon éteindrait le service pour tout le monde.
    expect(extractionsEnCours()).toBe(0);
    expect(appelsMoteur).toHaveLength(0);
  });

  it('un rush occupé n empêche pas les AUTRES rushes', async () => {
    tables.rush_analyses = [{
      id: 'a-1', rush_id: 'r-1', user_id: 'A', version: 1,
      etat: 'en_cours', etape: 'extraction',
      fournisseurs: {}, duree_secondes: null, technique: {}, resume: null,
      textes_visibles: [], parole: {}, audio: {}, qualite: {}, vignettes: [],
      usage: {}, motif_echec: null,
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    expect((await appeler('r-1')).status).toBe(409);
    // Les deux bornes sont distinctes : l'index unique porte sur UN rush, la
    // capacité sur le serveur. La première ne doit pas se comporter comme la
    // seconde.
    expect((await appeler('r-2')).status).toBe(201);
  });

  it('les refus ANTÉRIEURS à la prise de place ne consomment aucune place', async () => {
    // Session absente, rush d'autrui, rush non vérifié : ces trois-là sont
    // refusés avant la borne. Les compter comme des extractions ferait
    // refuser en 429 des requêtes qui n'ont jamais touché ffmpeg.
    authMock.mockResolvedValue(null);
    expect((await appeler('r-1')).status).toBe(401);
    expect(extractionsEnCours()).toBe(0);

    authMock.mockResolvedValue({ user: { id: 'A' } });
    expect((await appeler('r-inconnu')).status).toBe(404);
    expect(extractionsEnCours()).toBe(0);

    tables.rushes = [{ ...RUSH_1, etat: 'indexe' }, { ...RUSH_2 }];
    expect((await appeler('r-1')).status).toBe(409);
    expect(extractionsEnCours()).toBe(0);

    // Et le service n'a jamais cessé de fonctionner.
    expect((await appeler('r-2')).status).toBe(201);
  });
});
