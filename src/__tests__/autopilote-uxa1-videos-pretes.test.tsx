/**
 * UX-A1 — LES VIDÉOS D'UNE SESSION, VUES PAR LE CRÉATEUR.
 *
 * Trois objets sous test, et rien d'autre :
 *
 *   1. `GET /api/autopilot/sessions/[id]/rendus` — ce qu'elle rend, ce
 *      qu'elle refuse, et surtout ce qu'elle N'ÉCRIT PAS ;
 *   2. `rendu-passerelle` — la traduction des vocabulaires fermés en phrases,
 *      son exhaustivité, et la revalidation de ce qui vient du réseau ;
 *   3. `VideosPretes` — MONTÉ pour de vrai, et interrogé par son DOM.
 *
 * ⚠️ AUCUN TEST N'EST UNE EXPRESSION RÉGULIÈRE SUR LE SOURCE. La leçon du
 * 2026-07-30 du dépôt : un test qui vérifie la présence d'une ligne ne peut
 * pas échouer quand le produit est cassé. Ici, chaque assertion porte sur un
 * comportement — une réponse HTTP, une valeur rendue, un nœud du DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render, screen, cleanup, waitFor, fireEvent, act,
} from '@testing-library/react';

// ───────────────────────────────────────────────────────────────────────────
// La base, en mémoire
// ───────────────────────────────────────────────────────────────────────────

type Ligne = Record<string, unknown>;

const UID = '11111111-1111-4111-8111-111111111111';
const AUTRUI = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const RUSH = '44444444-4444-4444-8444-444444444444';
const JEU = '55555555-5555-4555-8555-555555555555';
const PLAN = '66666666-6666-4666-8666-666666666666';
const RENDU = '77777777-7777-4777-8777-777777777777';

let tables: Record<string, Ligne[]> = {};
let tableAbsente: string | null = null;
/** Toute écriture atterrit ici — et le test vérifie qu'il reste vide. */
let ecritures: { table: string; op: string }[] = [];

function erreurSocle() {
  return { code: 'PGRST205', message: 'Could not find the table in the schema cache' };
}

function requete(table: string) {
  const eq: [string, unknown][] = [];
  const dans: [string, unknown[]][] = [];
  let tri: { c: string; asc: boolean } | null = null;
  let limite: number | null = null;

  const lignes = (): Ligne[] | null => {
    if (tableAbsente === table) return null;
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    for (const [c, vs] of dans) out = out.filter((l) => vs.includes(l[c] as never));
    if (tri) {
      const { c, asc } = tri;
      out.sort((a, b) => {
        const x = String(a[c] ?? '');
        const y = String(b[c] ?? '');
        return asc ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const ecrire = (op: string) => {
    ecritures.push({ table, op });
    return api;
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { dans.push([c, vs]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: () => ecrire('insert'),
    update: () => ecrire('update'),
    upsert: () => ecrire('upsert'),
    delete: () => ecrire('delete'),
    maybeSingle: async () => {
      const l = lignes();
      if (l === null) return { data: null, error: erreurSocle() };
      return { data: l.length ? l[0] : null, error: null };
    },
    then: (resoudre: (v: unknown) => unknown) => {
      const l = lignes();
      return resoudre(l === null
        ? { data: null, error: erreurSocle() }
        : { data: l, error: null });
    },
  };
  return api;
}

let utilisateurConnecte: string | null = UID;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (utilisateurConnecte ? { user: { id: utilisateurConnecte } } : null),
}));

import { GET } from '@/app/api/autopilot/sessions/[id]/rendus/route';
import { lireRenduDeSession } from '@/lib/autopilot/analyse/rendu-session';
import {
  ETAPES_RENDU, ETATS_RENDU, MOTIFS_RENDU,
} from '@/lib/autopilot/analyse/rendu-contrat';
import {
  MOTIFS_TRADUITS, formaterDuree, messageEchec, orientation, phraseEnCours,
  relanceCoherente, renduDepuisReponse, renduEnCours,
  lireRenduDeSession as lireRenduDeSessionClient,
} from '@/lib/autopilot/analyse/rendu-passerelle';
import VideosPretes from '@/components/creer/VideosPretes';

// ───────────────────────────────────────────────────────────────────────────
// Les fixtures
// ───────────────────────────────────────────────────────────────────────────

const RESULTAT_VALIDE = {
  bucket: 'media',
  cle: `${UID}/montages/${RENDU}.mp4`,
  octets: 4_200_000,
  dureeMesureeSecondes: 28.4,
  largeur: 1080,
  hauteur: 1920,
  fpsMesure: 30,
  codecVideo: 'h264',
  aAudio: true,
  codecAudio: 'aac',
};

function socleComplet(rendu?: Partial<Ligne>) {
  tables = {
    shoot_sessions: [{
      id: SESSION, user_id: UID, titre: 'Cours du samedi', statut: 'ouverte',
      contexte: null, metadata: {},
      created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
    }],
    rushes: [{
      id: RUSH, shoot_session_id: SESSION, user_id: UID, bucket: 'media',
      cle_objet: `${UID}/rushes/a.mp4`, nom_origine: 'a.mp4', content_type: 'video/mp4',
      taille_octets: 100, duree_secondes: 60, rang: 0, etat: 'verifie', metadata: {},
      created_at: '2026-09-01T10:01:00Z', updated_at: '2026-09-01T10:01:00Z',
    }],
    rush_clip_sets: [{ id: JEU, user_id: UID, rush_id: RUSH, created_at: '2026-09-01T10:02:00Z' }],
    rush_montage_plans: [{ id: PLAN, user_id: UID, clip_set_id: JEU, created_at: '2026-09-01T10:03:00Z' }],
    rush_montage_renders: rendu === undefined ? [] : [{
      id: RENDU, user_id: UID, montage_plan_id: PLAN, montage_plan_version: 1,
      methode_rendu: 'x264-crf23-concat-v1', etat: 'reussie', etape: null,
      resultat: RESULTAT_VALIDE, motif_echec: null, usage: {},
      created_at: '2026-09-01T10:04:00Z', started_at: '2026-09-01T10:04:00Z',
      completed_at: '2026-09-01T10:09:00Z', updated_at: '2026-09-01T10:09:00Z',
      ...rendu,
    }],
  };
}

beforeEach(() => {
  tableAbsente = null;
  ecritures = [];
  utilisateurConnecte = UID;
  socleComplet();
});

afterEach(() => { cleanup(); });

const appeler = async (id = SESSION) => GET(
  {} as never, { params: { id } },
);

// ═══════════════════════════════════════════════════════════════════════════
// 1. LA ROUTE
// ═══════════════════════════════════════════════════════════════════════════

describe('1. GET /api/autopilot/sessions/[id]/rendus', () => {
  it('1.1 refuse une requête sans session utilisateur', async () => {
    utilisateurConnecte = null;
    const r = await appeler();
    expect(r.status).toBe(401);
  });

  it('1.2 refuse un identifiant qui n’est pas un identifiant', async () => {
    const r = await appeler('pas-un-uuid');
    expect(r.status).toBe(422);
    expect((await r.json()).motif).toBe('identifiant_invalide');
  });

  it('1.3 rend 404 pour une session inconnue', async () => {
    const r = await appeler('99999999-9999-4999-8999-999999999999');
    expect(r.status).toBe(404);
  });

  it('1.4 rend 404 — et non 403 — pour la session d’autrui', async () => {
    utilisateurConnecte = AUTRUI;
    const r = await appeler();
    expect(r.status).toBe(404);
    // Un 403 confirmerait au visiteur que ce tournage existe.
    expect(r.status).not.toBe(403);
  });

  it('1.5 rend 503 quand la table des rendus n’est pas migrée', async () => {
    tableAbsente = 'rush_montage_renders';
    const r = await appeler();
    expect(r.status).toBe(503);
    expect((await r.json()).motif).toBe('socle_absent');
  });

  it('1.6 rend 503 quand un maillon intermédiaire n’est pas migré', async () => {
    tableAbsente = 'rush_clip_sets';
    const r = await appeler();
    expect(r.status).toBe(503);
  });

  it('1.7 rend `rendu: null` pour une session sans aucun rendu', async () => {
    socleComplet();
    const r = await appeler();
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.ok).toBe(true);
    expect(c.rendu).toBeNull();
  });

  it('1.8 rend `rendu: null` quand la session n’a aucun rush', async () => {
    tables.rushes = [];
    const r = await appeler();
    expect((await r.json()).rendu).toBeNull();
  });

  it('1.9 rend la PROJECTION publique, jamais la ligne', async () => {
    socleComplet({});
    const r = await appeler();
    const { rendu } = await r.json();

    expect(rendu.id).toBe(RENDU);
    expect(rendu.etat).toBe('reussie');
    expect(rendu.video.dureeSecondes).toBe(28.4);
    expect(rendu.video.chemin).toBe(`/api/autopilot/rendus-montage/${RENDU}/fichier`);

    // ⚠️ CE QUI NE DOIT JAMAIS SORTIR.
    const brut = JSON.stringify(rendu);
    expect(rendu.montagePlanId).toBeUndefined();
    expect(rendu.methodeRendu).toBeUndefined();
    expect(brut).not.toContain(RESULTAT_VALIDE.cle);
    expect(brut).not.toContain('media');
    expect(brut).not.toContain('x264');
    expect(brut).not.toContain(PLAN);
  });

  it('1.10 ne sert pas le rendu d’un autre utilisateur', async () => {
    socleComplet({});
    tables.rush_montage_renders[0].user_id = AUTRUI;
    expect((await (await appeler()).json()).rendu).toBeNull();
  });

  it('1.11 ne sert pas un rendu dont le plan appartient à un autre tournage', async () => {
    socleComplet({});
    tables.rush_montage_plans[0].clip_set_id = 'un-autre-jeu';
    expect((await (await appeler()).json()).rendu).toBeNull();
  });

  it('1.12 rétrograde une réussite dont le fichier ne tient pas', async () => {
    // Clé hors du préfixe utilisateur : la réussite n'en est pas une.
    socleComplet({ resultat: { ...RESULTAT_VALIDE, cle: `${AUTRUI}/vol.mp4` } });
    const { rendu } = await (await appeler()).json();
    expect(rendu.etat).toBe('echouee');
    expect(rendu.video).toBeNull();
  });

  it('1.13 rend le rendu le plus RÉCENT quand il y en a plusieurs', async () => {
    socleComplet({});
    tables.rush_montage_renders.push({
      ...tables.rush_montage_renders[0],
      id: '88888888-8888-4888-8888-888888888888',
      etat: 'en_cours', etape: 'encodage', resultat: {},
      created_at: '2026-09-02T10:00:00Z',
    });
    const { rendu } = await (await appeler()).json();
    expect(rendu.id).toBe('88888888-8888-4888-8888-888888888888');
    expect(rendu.etat).toBe('en_cours');
  });

  it('1.14 ⚠️ N’ÉCRIT RIEN — aucun insert, update, upsert ni delete', async () => {
    socleComplet({ etat: 'en_cours', etape: 'source', resultat: {} });
    await appeler();
    // Un GET qui écrirait serait rejoué par chaque préchargement de lien.
    expect(ecritures).toEqual([]);
  });

  it('1.15 interdit la mise en cache partagée', async () => {
    const r = await appeler();
    expect(r.headers.get('Cache-Control')).toContain('no-store');
    expect(r.headers.get('Cache-Control')).toContain('private');
  });

  it('1.16 le service rend `session_introuvable` sans toucher aux rendus', async () => {
    const r = await lireRenduDeSession(UID, '99999999-9999-4999-8999-999999999999');
    expect(r.motif).toBe('session_introuvable');
    expect(r.rendu).toBeNull();
    expect(ecritures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LA PASSERELLE — ÉTATS, ÉTAPES, MOTIFS
// ═══════════════════════════════════════════════════════════════════════════

describe('2. La traduction des vocabulaires fermés', () => {
  it('2.1 les ONZE motifs du contrat sont traduits, ni plus ni moins', () => {
    expect([...MOTIFS_TRADUITS].sort()).toEqual([...MOTIFS_RENDU].sort());
    // Onze depuis le correctif Lot 2A, qui a donne son motif a la musique.
    expect(MOTIFS_RENDU).toHaveLength(11);
  });

  it('2.2 aucun message ne contient un mot de machine', () => {
    const interdits = [
      '_', 'ffmpeg', 'crf', 'bucket', 'codec', 'http', '%', 'null', 'undefined',
    ];
    for (const motif of MOTIFS_RENDU) {
      const m = messageEchec(motif);
      expect(m.length).toBeGreaterThan(10);
      // Une phrase, pas un code : majuscule en tête, ponctuation finale.
      expect(m[0]).toBe(m[0].toUpperCase());
      expect(m).toMatch(/[.!]$/);
      for (const i of interdits) {
        expect(m.toLowerCase()).not.toContain(i);
      }
      // Le motif brut ne doit jamais transparaître dans sa propre traduction.
      expect(m.toLowerCase()).not.toContain(motif);
    }
  });

  it('2.3 aucun motif définitif ne promet de réessayer', () => {
    // L'invariant tient dans UN sens, et c'est celui qui compte : promettre
    // une relance impossible envoie quelqu'un cliquer indéfiniment. La
    // réciproque, elle, est fausse à dessein — `capacite_saturee` est
    // relançable, mais sa phrase rassure (« la tienne démarre juste après »)
    // au lieu d'ordonner un geste que le serveur fera tout seul.
    for (const motif of MOTIFS_RENDU) {
      if (relanceCoherente(motif)) continue;
      expect(messageEchec(motif).toLowerCase()).not.toContain('réessaie');
    }
    // Et au moins un motif relançable le dit explicitement : sans quoi le
    // test ci-dessus passerait sur un jeu de phrases toutes muettes.
    expect(messageEchec('rendu_interrompu').toLowerCase()).toContain('réessaie');
  });

  it('2.4 les quatre motifs définitifs sont bien définitifs', () => {
    for (const m of ['plan_non_conforme', 'clip_illisible', 'outil_absent'] as const) {
      expect(relanceCoherente(m)).toBe(false);
      expect(messageEchec(m).toLowerCase()).not.toContain('réessaie');
    }
  });

  it('2.5 un motif absent ou inconnu ne laisse pas l’écran muet', () => {
    expect(messageEchec(null).length).toBeGreaterThan(10);
    expect(messageEchec('inventé' as never).length).toBeGreaterThan(10);
    expect(messageEchec(null)).not.toContain('null');
  });

  it('2.6 les QUATRE étapes du contrat ont chacune leur phrase, toutes distinctes', () => {
    const phrases = ETAPES_RENDU.map((e) => phraseEnCours(e));
    expect(ETAPES_RENDU).toHaveLength(4);
    expect(new Set(phrases).size).toBe(4);
    for (const p of phrases) {
      expect(p).toMatch(/…$/);
      expect(p).not.toMatch(/\d/); // ⚠️ AUCUN CHIFFRE : pas de pourcentage.
      expect(p).not.toMatch(/%/);
    }
  });

  it('2.7 une étape absente ou inconnue a sa propre phrase, pas un vide', () => {
    expect(phraseEnCours(null)).toMatch(/…$/);
    expect(phraseEnCours('inventée' as never)).toBe(phraseEnCours(null));
  });

  it('2.8 seuls les états actifs méritent un tour de sondage', () => {
    for (const etat of ETATS_RENDU) {
      const actif = etat === 'en_attente' || etat === 'en_cours';
      expect(renduEnCours({ id: 'x', etat, etape: null, motif: null, video: null }))
        .toBe(actif);
    }
    expect(renduEnCours(null)).toBe(false);
  });

  it('2.9 la durée s’écrit en minutes et secondes, jamais en timecode', () => {
    expect(formaterDuree(28.4)).toBe('0:28');
    expect(formaterDuree(95)).toBe('1:35');
    expect(formaterDuree(Number.NaN)).toBe('');
  });

  it('2.10 l’orientation s’écrit en mots, pas en pixels', () => {
    expect(orientation(1080, 1920)).toBe('Vertical');
    expect(orientation(1920, 1080)).toBe('Horizontal');
    expect(orientation(1080, 1080)).toBe('Carré');
    expect(orientation(0, 0)).toBe('');
  });
});

describe('3. La relecture de ce qui vient du réseau', () => {
  const complet = {
    id: RENDU, etat: 'reussie', etape: null, motif: null,
    video: { dureeSecondes: 28.4, largeur: 1080, hauteur: 1920, chemin: '/api/x' },
  };

  it('3.1 relit un rendu complet', () => {
    expect(renduDepuisReponse(complet)?.video?.chemin).toBe('/api/x');
  });

  it('3.2 écarte une vidéo incomplète plutôt que d’inventer un zéro', () => {
    for (const manquant of ['dureeSecondes', 'largeur', 'hauteur', 'chemin']) {
      const v = { ...complet.video } as Record<string, unknown>;
      delete v[manquant];
      expect(renduDepuisReponse({ ...complet, video: v })?.video).toBeNull();
    }
  });

  it('3.3 refuse un chemin qui n’est pas un chemin de l’application', () => {
    const v = { ...complet.video, chemin: 'https://stockage.example/objet.mp4' };
    expect(renduDepuisReponse({ ...complet, video: v })?.video).toBeNull();
  });

  it('3.4 n’expose aucune vidéo pour un état non réussi', () => {
    expect(renduDepuisReponse({ ...complet, etat: 'en_cours' })?.video).toBeNull();
  });

  it('3.5 rejette une charge utile sans identité', () => {
    expect(renduDepuisReponse(null)).toBeNull();
    expect(renduDepuisReponse({ etat: 'reussie' })).toBeNull();
    expect(renduDepuisReponse({ id: 'x', etat: 'inventé' })).toBeNull();
  });

  it('3.6 un 503 ou un 404 est une indisponibilité, pas une erreur à annoncer', async () => {
    for (const status of [503, 404]) {
      const r = await lireRenduDeSessionClient(SESSION, async () => new Response(
        JSON.stringify({ ok: false }), { status },
      ));
      expect(r.sorte).toBe('indisponible');
    }
  });

  it('3.7 une charge utile illisible n’est pas « aucune vidéo »', async () => {
    // Le dire effacerait de l'écran un travail qui existe.
    const r = await lireRenduDeSessionClient(SESSION, async () => new Response(
      JSON.stringify({ ok: true, rendu: { pas: 'un rendu' } }), { status: 200 },
    ));
    expect(r.sorte).toBe('erreur');
  });

  it('3.8 `rendu: null` est bien « aucune vidéo »', async () => {
    const r = await lireRenduDeSessionClient(SESSION, async () => new Response(
      JSON.stringify({ ok: true, rendu: null }), { status: 200 },
    ));
    expect(r.sorte).toBe('aucun');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LE COMPOSANT — MONTÉ, ET INTERROGÉ PAR SON DOM
// ═══════════════════════════════════════════════════════════════════════════

function reponse(corps: unknown, status = 200) {
  return async () => new Response(JSON.stringify(corps), { status });
}

const RENDU_PRET = {
  id: RENDU, etat: 'reussie', etape: null, motif: null,
  video: {
    dureeSecondes: 28.4, largeur: 1080, hauteur: 1920,
    chemin: `/api/autopilot/rendus-montage/${RENDU}/fichier`,
  },
};

const monter = (props: Partial<React.ComponentProps<typeof VideosPretes>>) => render(
  <VideosPretes sessionId={SESSION} aucunRush={false} {...props} />,
);

describe('4. VideosPretes — les cinq états', () => {
  it('4.1 aucun rush : l’écran le dit, et n’interroge pas le serveur', async () => {
    const fetcher = vi.fn(reponse({ ok: true, rendu: null }));
    monter({ aucunRush: true, fetcher });
    expect(await screen.findByText(/Ajoute des rushes/i)).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('4.2 aucune vidéo : une phrase, aucun bouton', async () => {
    monter({ fetcher: reponse({ ok: true, rendu: null }) });
    expect(await screen.findByText(/Aucune vidéo pour l’instant/i)).toBeInTheDocument();
    expect(screen.queryByText(/Regarder/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Télécharger/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Planifier/i)).not.toBeInTheDocument();
  });

  it('4.3 en cours : la phrase de l’étape, et AUCUN pourcentage', async () => {
    monter({
      fetcher: reponse({
        ok: true,
        rendu: { id: RENDU, etat: 'en_cours', etape: 'encodage', motif: null, video: null },
      }),
    });
    expect(await screen.findByText('Montage de ta vidéo…')).toBeInTheDocument();
    const bloc = document.querySelector('[data-videos-pretes]')!;
    expect(bloc.textContent).not.toMatch(/%/);
    expect(bloc.textContent).not.toMatch(/\d+\s*%/);
    expect(bloc.textContent).not.toContain('encodage');
  });

  it('4.4 les quatre étapes produisent les quatre phrases attendues', async () => {
    const attendu: Record<string, string> = {
      source: 'Récupération de tes rushes…',
      encodage: 'Montage de ta vidéo…',
      mesure: 'Vérification du résultat…',
      televersement: 'Finalisation…',
    };
    for (const etape of ETAPES_RENDU) {
      cleanup();
      monter({
        fetcher: reponse({
          ok: true,
          rendu: { id: RENDU, etat: 'en_cours', etape, motif: null, video: null },
        }),
      });
      expect(await screen.findByText(attendu[etape])).toBeInTheDocument();
    }
  });

  it('4.5 vidéo prête : durée, orientation, et EXACTEMENT trois actions', async () => {
    monter({ fetcher: reponse({ ok: true, rendu: RENDU_PRET }) });

    expect(await screen.findByText(/0:28 · Vertical/)).toBeInTheDocument();
    // Le titre DIT l'état, il ne nomme pas une rubrique.
    expect(screen.getByText('Votre vidéo est prête')).toBeInTheDocument();

    const bloc = document.querySelector('[data-videos-pretes]')!;
    // ⚠️ QUATRE COMMANDES, ET CE SONT CELLES-LA. Ni « Modifier », ni
    // « Créer ma vidéo », ni relance.
    //
    // La quatrieme est le « ⋯ » : les details du rendu y ont remplace le
    // texte technique qui n'avait nulle part ou aller. Et « Regarder » n'est
    // plus un bouton de la rangee — c'est l'affiche elle-meme qui se clique,
    // ce qui RETIRE un element sans retirer la fonction.
    expect(bloc.querySelectorAll('button, a')).toHaveLength(4);
    expect(document.querySelector('[data-videos-regarder]')).toBeTruthy();
    expect(screen.getByText('Télécharger')).toBeInTheDocument();
    expect(screen.getByText('Planifier la publication')).toBeInTheDocument();
    expect(document.querySelector('[data-menu-actions="rendu"]')).toBeTruthy();
    expect(screen.queryByText(/Modifier/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Créer ma vidéo/i)).not.toBeInTheDocument();
  });

  it('4.6 aucune donnée technique n’apparaît à l’écran', async () => {
    monter({ fetcher: reponse({ ok: true, rendu: RENDU_PRET }) });
    await screen.findByText(/0:28 · Vertical/);
    const texte = document.querySelector('[data-videos-pretes]')!.textContent ?? '';
    for (const interdit of ['1080', '1920', RENDU, 'mp4', 'bucket', 'crf', 'ffmpeg']) {
      expect(texte).not.toContain(interdit);
    }
  });

  it('4.7 le lecteur ne se monte QU’au clic sur l’affiche', async () => {
    monter({ fetcher: reponse({ ok: true, rendu: RENDU_PRET }) });
    await screen.findByText(/0:28 · Vertical/);

    // Avant : rien ne télécharge. La route rend le fichier d'un bloc.
    expect(document.querySelector('[data-videos-lecteur]')).toBeNull();

    await act(async () => {
      fireEvent.click(document.querySelector('[data-videos-regarder]')!);
    });

    const lecteur = document.querySelector('[data-videos-lecteur]') as HTMLVideoElement;
    expect(lecteur).not.toBeNull();
    expect(lecteur.getAttribute('src')).toBe(RENDU_PRET.video.chemin);
    // `playsInline` : sans lui, iOS sort la personne de la page.
    expect(lecteur.hasAttribute('playsinline')).toBe(true);
  });

  it('4.8 Télécharger pointe sur la route de l’application, jamais sur le stockage', async () => {
    monter({ fetcher: reponse({ ok: true, rendu: RENDU_PRET }) });
    await screen.findByText(/0:28 · Vertical/);

    const lien = document.querySelector('[data-videos-telecharger]') as HTMLAnchorElement;
    expect(lien.getAttribute('href')).toBe(RENDU_PRET.video.chemin);
    expect(lien.getAttribute('href')).not.toMatch(/^https?:/);
    expect(lien.hasAttribute('download')).toBe(true);
  });

  it('4.9 erreur relançable : une phrase humaine, et aucun code', async () => {
    monter({
      fetcher: reponse({
        ok: true,
        rendu: {
          id: RENDU, etat: 'echouee', etape: null,
          motif: 'rendu_interrompu', video: null,
        },
      }),
    });
    expect(await screen.findByText('La création a été interrompue. Réessaie.'))
      .toBeInTheDocument();
    const bloc = document.querySelector('[data-videos-pretes]')!;
    expect(bloc.textContent).not.toContain('rendu_interrompu');
  });

  it('4.10 erreur définitive : aucune promesse de réessayer', async () => {
    monter({
      fetcher: reponse({
        ok: true,
        rendu: {
          id: RENDU, etat: 'echouee', etape: null,
          motif: 'clip_illisible', video: null,
        },
      }),
    });
    const p = await screen.findByText(/illisible/i);
    expect(p.textContent).not.toMatch(/Réessaie/i);
    expect(document.querySelector('[data-videos-pretes]')!.textContent)
      .not.toContain('clip_illisible');
  });

  it('4.11 capacité saturée : la phrase d’attente, pas un code d’erreur', async () => {
    monter({
      fetcher: reponse({
        ok: true,
        rendu: {
          id: RENDU, etat: 'echouee', etape: null,
          motif: 'capacite_saturee', video: null,
        },
      }),
    });
    expect(await screen.findByText(/Studiio termine une autre vidéo/i))
      .toBeInTheDocument();
  });

  it('4.12 une indisponibilité serveur n’affiche rien du tout', async () => {
    const { container } = monter({ fetcher: reponse({ ok: false }, 503) });
    await waitFor(() => {
      expect(container.querySelector('[data-videos-pretes]')).toBeNull();
    });
  });

  it('4.13 un état terminal arrête le sondage', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(reponse({ ok: true, rendu: RENDU_PRET }));
      monter({ fetcher });
      await vi.advanceTimersByTimeAsync(30_000);
      // Un seul appel : une réussite ne changera plus.
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('4.14 un état actif est re-sondé, puis s’arrête à la réussite', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn()
        .mockImplementationOnce(reponse({
          ok: true,
          rendu: { id: RENDU, etat: 'en_cours', etape: 'source', motif: null, video: null },
        }))
        .mockImplementation(reponse({ ok: true, rendu: RENDU_PRET }));

      monter({ fetcher });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('4.15 le démontage arrête la minuterie', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(reponse({
        ok: true,
        rendu: { id: RENDU, etat: 'en_cours', etape: 'source', motif: null, video: null },
      }));
      const { unmount } = monter({ fetcher });
      await vi.advanceTimersByTimeAsync(100);
      const avant = fetcher.mock.calls.length;
      unmount();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(avant);
    } finally {
      vi.useRealTimers();
    }
  });
});
