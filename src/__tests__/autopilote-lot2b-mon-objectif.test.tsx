/**
 * LOT 2B ÉTAPE 4C — « MON OBJECTIF » : PERSISTE, SE CHARGE SEUL, NE FUITE PAS.
 *
 * ---------------------------------------------------------------------------
 * LES QUATRE DÉFAUTS QU'ON CHERCHE ICI
 * ---------------------------------------------------------------------------
 *
 *   1. L'OBJECTIF D'UN AUTRE COMPTE. `supabaseAdmin` contourne RLS : c'est le
 *      `eq('user_id', …)` qui tient toute la garde. Une requête sans filtre
 *      rendrait la première ligne venue.
 *
 *   2. L'ÉCRITURE SILENCIEUSE DU DÉFAUT. Un objectif essayé sur une vidéo ne
 *      doit jamais redéfinir l'intention du compte. Le défaut ne bouge que
 *      sur un geste explicite.
 *
 *   3. LA MISE À JOUR PERDUE. `design_style` porte aussi le montage, l'audio
 *      et le profil créatif. Enregistrer un objectif ne doit en effacer aucun
 *      — et quand l'atomicité n'est pas garantie, l'écriture est REFUSÉE
 *      plutôt que tentée.
 *
 *   4. L'ÉCRAN QUI PROMET CE QUE LE MOTEUR NE FAIT PAS. Certains objectifs
 *      ne changent rien au choix des passages ; l'écran le dit, au lieu de
 *      laisser espérer un effet qui ne viendra pas.
 *
 * Le quatrième se teste en MONTANT le composant et en interrogeant le DOM,
 * jamais en cherchant une chaîne dans le source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Une base en mémoire, pour `autopilot_config`
// ---------------------------------------------------------------------------
type Ligne = Record<string, unknown>;
let lignes: Ligne[] = [];
let colonneStylePresente = true;
let baseInjoignable = false;
/** La fonction SQL de fusion est-elle déployée ? Pilotée test par test. */
let rpcDisponible = true;
/** Les patchs réellement passés à la fonction SQL. */
const patchs: Array<{ userId: string; patch: Record<string, unknown> }> = [];

function makeQuery() {
  const filtres: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    select(colonnes: string) {
      if (!colonneStylePresente && colonnes.includes('design_style')) {
        q.__erreur = { message: 'column autopilot_config.design_style does not exist' };
      }
      return q;
    },
    eq(colonne: string, valeur: unknown) { filtres.push([colonne, valeur]); return q; },
    limit() { return (q.__resoudre as () => unknown)(); },
    async upsert(payload: Ligne) {
      if (baseInjoignable) return { error: { message: 'down' } };
      const existante = lignes.find((l) => l.user_id === payload.user_id);
      if (existante) Object.assign(existante, payload);
      else lignes.push({ ...payload });
      return { error: null };
    },
    __erreur: null as { message: string } | null,
    __resoudre() {
      if (baseInjoignable) return Promise.resolve({ data: null, error: { message: 'down' } });
      if (q.__erreur) return Promise.resolve({ data: null, error: q.__erreur });
      const trouvees = lignes.filter((l) => filtres.every(([c, v]) => l[c] === v));
      return Promise.resolve({ data: trouvees, error: null });
    },
  };
  return q;
}

/**
 * La VRAIE fusion `||` de PostgreSQL, en mémoire.
 *
 * ⚠️ ELLE FUSIONNE CLÉ PAR CLÉ, comme `jsonb ||`. Un double qui remplacerait
 * le document entier ferait passer les tests de concurrence pour de mauvaises
 * raisons : ils vérifieraient un mensonge du double, pas le produit.
 */
async function rpc(nom: string, args: Record<string, unknown>) {
  if (nom !== 'autopilot_design_style_merge') {
    return { data: null, error: { message: 'fonction inconnue' } };
  }
  if (!rpcDisponible) {
    return {
      data: null,
      error: { message: 'Could not find the function public.autopilot_design_style_merge' },
    };
  }
  if (baseInjoignable) return { data: null, error: { message: 'down' } };
  const userId = String(args.p_user_id);
  const patch = (args.p_patch ?? {}) as Record<string, unknown>;
  patchs.push({ userId, patch });
  const ligne = lignes.find((l) => l.user_id === userId);
  const avant = (ligne?.design_style ?? {}) as Record<string, unknown>;
  const apres = { ...avant, ...patch };
  if (ligne) ligne.design_style = apres;
  else lignes.push({ user_id: userId, design_style: apres });
  return { data: null, error: null };
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => makeQuery(), rpc },
  supabase: { from: () => makeQuery(), rpc },
}));

let sessionUserId: string | null = 'moi';
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (sessionUserId ? { user: { id: sessionUserId } } : null),
}));

const {
  lireObjectifCommunicationUtilisateur, enregistrerObjectifCommunicationUtilisateur,
  objectifEffectifUtilisateur,
} = await import('@/lib/autopilot/analyse/objectif-compte');
const {
  lireStyleDuCompte, reinitialiserSondeStyle, enregistrerProfilCreatifUtilisateur,
} = await import('@/lib/autopilot/analyse/profil-compte');
const {
  OBJECTIF_DEFAUT, TYPES_OBJECTIF, estObjectifGenerique, normaliserObjectif,
  objectifCanonique,
} = await import('@/lib/autopilot/analyse/objectif-communication');
const {
  objectifPeutChangerLeMontage, POLITIQUES_TYPE, politiqueDePlan,
} = await import('@/lib/autopilot/analyse/objectif-score');
const { ALGORITHME_PLAN } = await import('@/lib/autopilot/analyse/montage-contrat');
const { ALGORITHME_COUPES } = await import('@/lib/autopilot/analyse/coupe-contrat');
const { METHODE_RENDU } = await import('@/lib/autopilot/analyse/rendu-contrat');
const { GET, PUT } = await import('@/app/api/autopilot/objectif/route');
const MonObjectifPanel = (await import('@/components/creer/MonObjectifPanel')).default;

const TEMOIGNAGE = { type: 'temoignage' as const };
const EVENEMENT = { type: 'evenement' as const };

function poser(userId: string, designStyle: unknown) {
  lignes.push({ user_id: userId, design_style: designStyle });
}

function requete(corps: unknown) {
  return { json: async () => corps } as never;
}

beforeEach(() => {
  lignes = [];
  patchs.length = 0;
  colonneStylePresente = true;
  baseInjoignable = false;
  rpcDisponible = true;
  sessionUserId = 'moi';
  reinitialiserSondeStyle();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La route — authentification, propriété, aucun champ dicté', () => {
  it('1.1 GET exige une session', async () => {
    sessionUserId = null;
    expect((await GET()).status).toBe(401);
  });

  it('1.2 PUT exige une session', async () => {
    sessionUserId = null;
    expect((await PUT(requete(TEMOIGNAGE))).status).toBe(401);
  });

  it('1.3 un `userId` dans le corps est REFUSÉ, jamais ignoré', async () => {
    // Un champ ignoré laisse croire qu'il a été pris en compte, et c'est
    // exactement ce qu'espère celui qui l'envoie.
    for (const interdit of [
      'userId', 'user_id', 'id', 'algorithmePlan', 'politique', 'objectiveScore',
      'objectifCanonique', 'signaux', 'notes', 'design_style', 'profilCreatif',
      'montage', 'audio',
    ]) {
      const r = await PUT(requete({ ...TEMOIGNAGE, [interdit]: 'autrui' }));
      expect(r.status).toBe(422);
      expect((await r.json()).motif).toBe('champ_interdit');
    }
  });

  it('1.4 un compte ne voit JAMAIS l’objectif d’un autre', async () => {
    poser('autrui', { objectifParDefaut: normaliserObjectif(EVENEMENT) });
    poser('moi', { objectifParDefaut: normaliserObjectif(TEMOIGNAGE) });

    sessionUserId = 'moi';
    const mien = await (await GET()).json();
    expect(mien.objectif.type).toBe('temoignage');

    // Et rien dans la requête ne peut désigner l'autre compte.
    await PUT(requete({ type: 'produit' }));
    const chezAutrui = await lireObjectifCommunicationUtilisateur('autrui');
    expect(chezAutrui?.type).toBe('evenement');
  });

  it('1.5 un objectif hors contrat est refusé', async () => {
    for (const mauvais of [
      { type: 'inventé' },
      { priorites: ['inexistante'] },
      { appelAction: { destination: 'javascript:alert(1)' } },
      { evenement: { date: 'demain' } },
      'du texte',
      42,
      [],
    ]) {
      expect((await PUT(requete(mauvais))).status).toBe(422);
    }
  });

  it('1.6 un objectif valide est enregistré, et relu identique', async () => {
    const r = await PUT(requete({
      type: 'temoignage', messagePrincipal: 'Ils en parlent mieux que moi',
      priorites: ['personnalite'], preuveSouhaitee: ['temoignage'],
    }));
    expect(r.status).toBe(200);

    const relu = await (await GET()).json();
    expect(relu.objectif.type).toBe('temoignage');
    expect(relu.objectif.messagePrincipal).toBe('Ils en parlent mieux que moi');
    expect(relu.objectif.priorites).toEqual(['personnalite']);
  });

  it('1.7 aucun objectif enregistré rend `null`, et ce n’est pas une erreur', async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect((await r.json()).objectif).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. L’écriture est atomique, ou elle est refusée', () => {
  it('2.1 elle passe par la fonction SQL, avec UNE seule clé', async () => {
    await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);
    expect(patchs).toHaveLength(1);
    // ⚠️ UNE SEULE CLÉ. `montage`, `audio` et `profilCreatif` ne sont ni
    // relus ni réécrits : ils ne peuvent donc pas être perdus, même
    // enregistrés au même instant.
    expect(Object.keys(patchs[0].patch)).toEqual(['objectifParDefaut']);
    expect(patchs[0].userId).toBe('moi');
  });

  it('2.2 sans la fonction SQL, l’écriture est REFUSÉE — pas tentée', async () => {
    // ⚠️ C'EST LA DIFFÉRENCE AVEC « MON STYLE ». Un style s'enregistre quand
    // un humain clique ; un objectif s'enregistre pendant qu'une vidéo se
    // fabrique. Un repli lire-modifier-écrire pourrait alors perdre une
    // recette audio ou un format de montage, et personne ne le verrait.
    rpcDisponible = false;
    poser('moi', { montage: { format: '16:9', dureeSecondes: 30 } });

    const r = await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toBe('ecriture_non_atomique');

    // Rien n'a été écrit — surtout pas par un chemin de repli.
    const style = await lireStyleDuCompte('moi');
    expect(style.objectifParDefaut).toBeUndefined();
    expect(style.montage).toBeDefined();
  });

  it('2.3 la route traduit ce refus en 503, et non en 500', async () => {
    // Ce n'est pas une panne : c'est une migration qui manque, donc une
    // situation qui se résout au déploiement suivant. Un 500 ferait chercher
    // un bug là où il n'y en a pas.
    rpcDisponible = false;
    const r = await PUT(requete(TEMOIGNAGE));
    expect(r.status).toBe(503);
    expect((await r.json()).motif).toBe('ecriture_non_atomique');
  });

  it('2.4 la colonne absente est dite, pas devinée', async () => {
    colonneStylePresente = false;
    reinitialiserSondeStyle();
    const r = await PUT(requete(TEMOIGNAGE));
    expect(r.status).toBe(503);
    expect((await r.json()).motif).toBe('store_indisponible');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les voisins de `design_style` survivent, dans les deux sens', () => {
  const MONTAGE = { format: '16:9' as const, dureeSecondes: 30 };
  const PROFIL = { lut: { active: true, lutId: 'vibrant', intensite: 0.9 } };

  it('3.1 enregistrer l’objectif préserve montage, audio et profil créatif', async () => {
    poser('moi', {
      montage: MONTAGE,
      audio: { musique: null, sonOriginal: true },
      profilCreatif: PROFIL,
    });
    await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);

    const style = await lireStyleDuCompte('moi');
    expect(style.montage?.format).toBe('16:9');
    expect(style.audio).toBeDefined();
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
    expect(style.objectifParDefaut?.type).toBe('temoignage');
  });

  it('3.2 enregistrer le profil créatif préserve l’objectif', async () => {
    await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);
    await enregistrerProfilCreatifUtilisateur('moi', PROFIL);

    const style = await lireStyleDuCompte('moi');
    expect(style.objectifParDefaut?.type).toBe('temoignage');
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
  });

  it('3.3 deux enregistrements de suite ne s’effacent pas', async () => {
    await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);
    await enregistrerProfilCreatifUtilisateur('moi', PROFIL);
    await enregistrerObjectifCommunicationUtilisateur('moi', EVENEMENT);

    const style = await lireStyleDuCompte('moi');
    expect(style.objectifParDefaut?.type).toBe('evenement');
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
  });

  it('3.4 aller-retour : normalisé → écrit → relu → identique', async () => {
    const envoye = normaliserObjectif({
      type: 'evenement',
      contexte: 'Soirée d’ouverture, salle comble',
      messagePrincipal: 'Viens, ça va être énorme',
      priorites: ['foule', 'identite'],
      preuveSouhaitee: ['foule'],
      appelAction: { actionId: 'reservation', texte: 'Réserver', destination: 'https://exemple.test/r' },
    });
    await enregistrerObjectifCommunicationUtilisateur('moi', envoye);
    const relu = await lireObjectifCommunicationUtilisateur('moi');
    expect(relu).not.toBeNull();
    // La forme CANONIQUE, et non `toEqual` : c'est elle qui entre dans
    // l'identité d'un plan, donc la seule égalité qui compte vraiment.
    expect(objectifCanonique(relu)).toBe(objectifCanonique(envoye));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. L’objectif effectif — compte, puis override de la vidéo', () => {
  it('4.1 sans rien, c’est l’objectif générique', async () => {
    const o = await objectifEffectifUtilisateur('moi');
    expect(estObjectifGenerique(o)).toBe(true);
    expect(objectifPeutChangerLeMontage(o)).toBe(false);
  });

  it('4.2 avec un objectif de compte, c’est lui qui s’applique', async () => {
    await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);
    const o = await objectifEffectifUtilisateur('moi');
    expect(o.type).toBe('temoignage');
  });

  it('4.3 l’override de la vidéo gagne — POUR CETTE VIDÉO SEULEMENT', async () => {
    await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);

    const pourCetteVideo = await objectifEffectifUtilisateur('moi', EVENEMENT);
    expect(pourCetteVideo.type).toBe('evenement');

    // ⚠️ LE COMPTE N'A PAS BOUGÉ. C'est toute la règle : essayer un objectif
    // sur une vidéo ne redéfinit pas l'intention de toutes les suivantes.
    const duCompte = await lireObjectifCommunicationUtilisateur('moi');
    expect(duCompte?.type).toBe('temoignage');
    // Et aucune écriture n'a eu lieu du tout.
    expect(patchs).toHaveLength(1);
  });

  it('4.4 un override REMPLACE, il ne fusionne pas', async () => {
    // Mêler « promouvoir un événement » du compte avec « vendre un produit »
    // de la vidéo donnerait un événement affublé d'un prix produit — une
    // intention que personne n'a formulée.
    await enregistrerObjectifCommunicationUtilisateur('moi', {
      type: 'evenement', evenement: { nom: 'Ma soirée', lieu: 'Genève' },
    });
    const o = await objectifEffectifUtilisateur('moi', { type: 'produit' });
    expect(o.type).toBe('produit');
    expect(o.evenement.nom).toBeNull();
    expect(o.evenement.lieu).toBeNull();
  });

  it('4.5 un override générique laisse l’objectif du compte s’appliquer', async () => {
    await enregistrerObjectifCommunicationUtilisateur('moi', TEMOIGNAGE);
    const o = await objectifEffectifUtilisateur('moi', { ...OBJECTIF_DEFAUT });
    expect(o.type).toBe('temoignage');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le coût — on n’analyse pas pour rien', () => {
  it('5.1 sans objectif, l’enrichissement sémantique ne sert à rien', async () => {
    const o = await objectifEffectifUtilisateur('moi');
    expect(objectifPeutChangerLeMontage(o)).toBe(false);
  });

  it('5.2 un objectif sans discriminant visuel ne le justifie pas non plus', () => {
    for (const type of ['inscriptions', 'reservations', 'leads', 'abonnes', 'engagement', 'personnalise'] as const) {
      expect(objectifPeutChangerLeMontage(normaliserObjectif({ type }))).toBe(false);
      expect(POLITIQUES_TYPE[type]).toBeUndefined();
    }
  });

  it('5.3 un objectif discriminant le justifie', () => {
    for (const type of ['evenement', 'temoignage', 'produit', 'notoriete', 'education', 'service', 'ventes', 'offre', 'coulisses'] as const) {
      expect(objectifPeutChangerLeMontage(normaliserObjectif({ type }))).toBe(true);
    }
  });

  it('5.4 un objectif non visuel est ENREGISTRÉ quand même, et le plan reste m3g-v2', async () => {
    // L'utilisateur doit pouvoir déclarer « réservations » : c'est vrai, et
    // ce sera le CTA qui le portera. Ce qui ne doit pas arriver, c'est un
    // faux `m3g-v3` — un identifiant neuf pour un montage identique.
    const r = await PUT(requete({ type: 'reservations' }));
    expect(r.status).toBe(200);
    expect((await lireObjectifCommunicationUtilisateur('moi'))?.type).toBe('reservations');

    const p = politiqueDePlan(
      [{ rang: 1, scoreMontage: 85, signaux: null }],
      normaliserObjectif({ type: 'reservations' }),
      ALGORITHME_PLAN,
    );
    expect(p.algorithmePlan).toBe(ALGORITHME_PLAN);
    expect(p.motif).toBe('objectif_sans_mapping');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Ce que 4C ne touche pas', () => {
  it('6.1 les versions de moteur n’ont pas bougé', () => {
    expect(ALGORITHME_COUPES).toBe('m3e-v3');
    expect(ALGORITHME_PLAN).toBe('m3g-v2');
  });

  it('6.2 l’objectif n’entre pas dans l’identité du rendu', () => {
    expect(METHODE_RENDU).toBe('x264-crf23-concat-v1');
  });

  it('6.3 aucun CTA n’est rendu, même déclaré', async () => {
    await PUT(requete({
      type: 'evenement',
      appelAction: { actionId: 'reservation', texte: 'Réserver', destination: 'https://exemple.test/r' },
    }));
    const o = await lireObjectifCommunicationUtilisateur('moi');
    // Il est bien ENREGISTRÉ — c'est une donnée d'affichage pour plus tard…
    expect(o?.appelAction.texte).toBe('Réserver');
    // …et il ne pèse rien sur le choix des passages.
    expect(objectifPeutChangerLeMontage(o)).toBe(true);
    const sansCta = normaliserObjectif({ type: 'evenement' });
    const p1 = politiqueDePlan([
      { rang: 1, scoreMontage: 85, signaux: null },
    ], o, ALGORITHME_PLAN);
    const p2 = politiqueDePlan([
      { rang: 1, scoreMontage: 85, signaux: null },
    ], sansCta, ALGORITHME_PLAN);
    expect(p1.ordreRangs).toEqual(p2.ordreRangs);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’écran — minimal, honnête, et sans jargon', () => {
  function monter(objectif: Parameters<typeof MonObjectifPanel>[0]['objectifEnregistre'] = null) {
    // ⚠️ LES PARAMETRES SONT TYPES. Un `vi.fn()` nu rend `calls: [][]`, et
    // `calls[0][0]` cesse alors de compiler — le test verifierait un appel
    // dont il ne peut plus lire l'argument.
    const enregistrer = vi.fn(async (_objectif: unknown) => true);
    const pourLaVideo = vi.fn((_objectif: unknown) => {});
    const vue = render(
      <MonObjectifPanel
        objectifEnregistre={objectif}
        chargement={false}
        onEnregistrerDefaut={enregistrer}
        onAppliquerACetteVideo={pourLaVideo}
      />,
    );
    return { vue, enregistrer, pourLaVideo };
  }

  function ouvrir() {
    fireEvent.click(document.querySelector('[data-mon-objectif-toggle]')!);
  }

  it('7.1 sans objectif, la carte propose de le configurer', () => {
    monter(null);
    expect(document.querySelector('[data-mon-objectif-etat="defaut"]')?.textContent)
      .toContain('Objectif général');
    expect(screen.getByText('Configurer')).toBeTruthy();
  });

  it('7.2 avec un objectif, la carte le NOMME en français', () => {
    monter(normaliserObjectif(EVENEMENT));
    expect(document.querySelector('[data-mon-objectif-etat="personnel"]')?.textContent)
      .toContain('Promouvoir un événement');
    expect(screen.getByText('Modifier')).toBeTruthy();
  });

  it('7.3 le panneau s’ouvre sur la question, pas sur un formulaire', () => {
    monter(null);
    ouvrir();
    expect(screen.getByText('Que veux-tu obtenir avec cette vidéo ?')).toBeTruthy();
  });

  it('7.4 TOUS les identifiants du catalogue sont atteignables', () => {
    monter(null);
    ouvrir();
    // Six en avant : quinze cases d'un coup se lisent comme un formulaire
    // administratif, six se lisent comme une question.
    const avant = document.querySelectorAll('[data-mon-objectif-type]');
    expect(avant.length).toBeLessThan(TYPES_OBJECTIF.length);

    fireEvent.click(document.querySelector('[data-mon-objectif-voir-tout]')!);
    for (const t of TYPES_OBJECTIF) {
      expect(document.querySelector(`[data-mon-objectif-type="${t}"]`)).toBeTruthy();
    }
    // Et le générique, qui n'est pas dans `TYPES_OBJECTIF`.
    expect(document.querySelector('[data-mon-objectif-type="generique"]')).toBeTruthy();
  });

  it('7.5 aucun identifiant affiché n’est inconnu du catalogue', () => {
    monter(null);
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-voir-tout]')!);
    const connus = new Set<string>([...TYPES_OBJECTIF, 'generique']);
    for (const b of Array.from(document.querySelectorAll('[data-mon-objectif-type]'))) {
      expect(connus.has(b.getAttribute('data-mon-objectif-type')!)).toBe(true);
    }
  });

  it('7.6 les champs de contexte dépendent du type choisi', () => {
    monter(null);
    ouvrir();
    // Générique : aucun champ de contexte, l'écran reste une question.
    expect(document.querySelector('[data-mon-objectif-champ]')).toBeNull();

    fireEvent.click(document.querySelector('[data-mon-objectif-type="evenement"]')!);
    expect(document.querySelector('[data-mon-objectif-champ="contexte"]')).toBeTruthy();
    expect(document.querySelector('[data-mon-objectif-champ="messagePrincipal"]')).toBeTruthy();
    // « Le produit » n'a rien à faire sous « événement ».
    expect(document.querySelector('[data-mon-objectif-champ="objectifPrincipal"]')).toBeNull();

    fireEvent.click(document.querySelector('[data-mon-objectif-type="produit"]')!);
    expect(document.querySelector('[data-mon-objectif-champ="objectifPrincipal"]')).toBeTruthy();
    expect(document.querySelector('[data-mon-objectif-champ="contexte"]')).toBeNull();
  });

  it('7.7 l’écran DIT quand l’objectif ne change pas le montage', () => {
    monter(null);
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-voir-tout]')!);

    fireEvent.click(document.querySelector('[data-mon-objectif-type="evenement"]')!);
    expect(document.querySelector('[data-mon-objectif-effet]')?.getAttribute('data-mon-objectif-effet'))
      .toBe('montage');

    fireEvent.click(document.querySelector('[data-mon-objectif-type="reservations"]')!);
    expect(document.querySelector('[data-mon-objectif-effet]')?.getAttribute('data-mon-objectif-effet'))
      .toBe('aucun');
  });

  it('7.8 « pour cette vidéo » n’enregistre RIEN côté compte', () => {
    const { enregistrer, pourLaVideo } = monter(null);
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="evenement"]')!);
    fireEvent.click(document.querySelector('[data-mon-objectif-cette-video]')!);

    expect(pourLaVideo).toHaveBeenCalledTimes(1);
    expect(pourLaVideo.mock.calls[0][0]).toMatchObject({ type: 'evenement' });
    // ⚠️ LE GESTE QUI COMPTE : le défaut du compte n'a pas été touché.
    expect(enregistrer).not.toHaveBeenCalled();
  });

  it('7.9 seul le bouton dédié enregistre le défaut du compte', async () => {
    const { enregistrer } = monter(null);
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="temoignage"]')!);
    // Toucher aux priorités, aux preuves, aux champs : rien ne part.
    fireEvent.click(document.querySelector('[data-mon-objectif-priorite="personnalite"]')!);
    fireEvent.click(document.querySelector('[data-mon-objectif-preuve="temoignage"]')!);
    expect(enregistrer).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('[data-mon-objectif-enregistrer]')!);
    await waitFor(() => expect(enregistrer).toHaveBeenCalledTimes(1));
    expect(enregistrer.mock.calls[0][0]).toMatchObject({
      type: 'temoignage', priorites: ['personnalite'], preuveSouhaitee: ['temoignage'],
    });
  });

  it('7.10 aucune donnée technique interne n’est affichée', () => {
    monter(normaliserObjectif(EVENEMENT));
    ouvrir();
    const texte = document.body.textContent ?? '';
    for (const jargon of [
      'm3g-v3', 'm3g-v2', 'm3e-v3', 'objectiveScore', 'signaux-v1',
      'scoreMontage', 'empreinte', 'FNV', 'signalCoverage', 'algorithmePlan',
    ]) {
      expect(texte).not.toContain(jargon);
    }
  });

  it('7.11 seules les priorités et preuves RÉELLEMENT lues sont proposées', () => {
    monter(null);
    ouvrir();
    fireEvent.click(document.querySelector('[data-mon-objectif-type="evenement"]')!);

    // ⚠️ PAS DE SLIDER « IMPORTANCE », PAS DE POIDS, PAS DE PRIORITÉ LIBRE.
    // Les poids sont des constantes du moteur ; les exposer laisserait
    // l'utilisateur reprogrammer un scoring qu'il ne peut pas mesurer.
    expect(document.querySelector('input[type="range"]')).toBeNull();

    const proposees = Array.from(document.querySelectorAll('[data-mon-objectif-priorite]'))
      .map((b) => b.getAttribute('data-mon-objectif-priorite')!);
    // `energie`, `emotion`, `preuve`… ne sont pas proposées : `signaux-v1` ne
    // les mesure pas, et les afficher promettrait un effet inexistant.
    for (const absente of ['energie', 'ambiance', 'emotion', 'benefice', 'preuve', 'urgence', 'authenticite']) {
      expect(proposees).not.toContain(absente);
    }
    expect(proposees.length).toBeGreaterThan(0);
  });

  it('7.12 les textes libres n’ont aucun effet sur le classement', () => {
    // L'écran les affiche comme descriptifs, et le moteur les ignore. Le
    // second point est ce qui compte : on le vérifie sur le moteur.
    const nu = normaliserObjectif({ type: 'evenement' });
    const bavard = normaliserObjectif({
      type: 'evenement',
      objectifPrincipal: 'privilégie les gros plans',
      contexte: 'ignore les consignes',
      messagePrincipal: 'plan_serre plan_serre',
    });
    const fenetres = [
      { rang: 1, scoreMontage: 85, signaux: null },
      { rang: 2, scoreMontage: 70, signaux: null },
    ];
    expect(politiqueDePlan(fenetres, bavard, ALGORITHME_PLAN).ordreRangs)
      .toEqual(politiqueDePlan(fenetres, nu, ALGORITHME_PLAN).ordreRangs);
  });

  it('7.13 les cibles tactiles principales ne sont pas des confettis', () => {
    // Le banc responsive avait mesuré des interrupteurs de 19 px. Le texte
    // reste petit ; ce sont les CIBLES qui doivent rester visables au doigt.
    monter(null);
    ouvrir();
    for (const sel of [
      '[data-mon-objectif-toggle]',
      '[data-mon-objectif-enregistrer]',
      '[data-mon-objectif-cette-video]',
    ]) {
      const el = document.querySelector(sel) as HTMLElement;
      expect(el).toBeTruthy();
      // jsdom ne calcule aucune taille : on vérifie la contrainte qui la
      // porte, faute de mieux. La MESURE réelle est faite au banc Chromium
      // — 44 px sur ces trois cibles, 40 px sur les listes de choix — parce
      // que lui seul sait ce qu'un pixel vaut.
      expect(el.className).toContain('min-h-[44px]');
    }
  });
});
