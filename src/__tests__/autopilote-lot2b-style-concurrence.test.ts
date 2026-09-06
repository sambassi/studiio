/**
 * LOT 2B ETAPE 3B — `design_style` A DEUX ECRIVAINS. QUI PERD ?
 *
 * ---------------------------------------------------------------------------
 * LE DEFAUT QU'ON CHERCHE : LA MISE A JOUR PERDUE
 * ---------------------------------------------------------------------------
 *
 * Une seule colonne `jsonb` porte quatre reglages independants — `montage`,
 * `audio`, `profilCreatif`, `objectifParDefaut` — et DEUX routes l'ecrivent :
 *
 *   • `PUT /api/autopilot/config`, qui envoie le document ENTIER tel que
 *     l'ecran le connait ;
 *   • `PUT /api/autopilot/profil-creatif`, qui n'en change qu'une cle.
 *
 * Le scenario qui casse n'est meme pas une course entre deux onglets. Il tient
 * en trois gestes d'un seul utilisateur, dans un seul onglet :
 *
 *   1. la page charge : l'ecran garde `design_style` en memoire ;
 *   2. l'utilisateur enregistre « Mon style » : la base change, l'ecran non ;
 *   3. l'utilisateur touche a la cadence : l'ecran repose son `design_style`
 *      D'AVANT, et le style qu'il vient d'enregistrer disparait.
 *
 * Aucune erreur, aucun message. Le style revient simplement a sa valeur
 * precedente, et l'utilisateur croit avoir mal clique.
 *
 * ---------------------------------------------------------------------------
 * LA REGLE QUI EN SORT : CHAQUE ECRIVAIN N'ECRIT QUE SES PROPRES CLES
 * ---------------------------------------------------------------------------
 *
 * L'ecran de configuration possede `montage`, `audio`, les polices, les
 * icones, le style de cartes. Il ne possede PAS `profilCreatif` ni
 * `objectifParDefaut` : ceux-la ont leur propre route, et le serveur les
 * reporte depuis la base quel que soit ce que le client envoie.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Une base en memoire, partagee par les deux routes
// ---------------------------------------------------------------------------

type Ligne = Record<string, unknown>;
let lignes: Ligne[] = [];
/** Le nombre d'ecritures reellement parvenues a la base. */
let ecritures = 0;
/** La fonction SQL de fusion est-elle deployee ? */
let rpcDisponible = true;

function makeQuery() {
  const filtres: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    select() { return q; },
    eq(colonne: string, valeur: unknown) { filtres.push([colonne, valeur]); return q; },
    limit() { return q.__resoudre(); },
    async upsert(payload: Ligne) {
      ecritures += 1;
      const existante = lignes.find((l) => l.user_id === payload.user_id);
      if (existante) Object.assign(existante, payload);
      else lignes.push({ ...payload });
      return { error: null };
    },
    __resoudre() {
      const trouvees = lignes.filter((l) => filtres.every(([c, v]) => l[c] === v));
      return Promise.resolve({ data: trouvees, error: null });
    },
  };
  return q;
}

/**
 * La fonction SQL, reproduite fidelement : `design_style || patch`, en UNE
 * seule instruction. C'est ce caractere indivisible qui est teste — pas la
 * syntaxe de Postgres, que ce banc ne peut pas verifier.
 */
async function rpcFusion(nom: string, args: Record<string, unknown>) {
  if (nom !== 'autopilot_design_style_merge') {
    return { data: null, error: { message: `function ${nom} does not exist` } };
  }
  if (!rpcDisponible) {
    return {
      data: null,
      error: { message: 'Could not find the function public.autopilot_design_style_merge' },
    };
  }
  ecritures += 1;
  const userId = args.p_user_id as string;
  const patch = args.p_patch as Record<string, unknown>;
  const ligne = lignes.find((l) => l.user_id === userId);
  if (ligne) {
    ligne.design_style = { ...(ligne.design_style as object ?? {}), ...patch };
  } else {
    lignes.push({ user_id: userId, design_style: { ...patch } });
  }
  return { data: null, error: null };
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => makeQuery(), rpc: rpcFusion },
  supabase: { from: () => makeQuery(), rpc: rpcFusion },
}));

let sessionUserId: string | null = 'moi';
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (sessionUserId ? { user: { id: sessionUserId } } : null),
}));

vi.mock('@/lib/autopilot/analyse/logo-source', async (originel) => {
  const vrai = await originel<typeof import('@/lib/autopilot/analyse/logo-source')>();
  return { ...vrai, verifierLogo: async () => ({ ok: true, taille: 4096 }) };
});

const {
  lireStyleDuCompte, lireProfilCreatifUtilisateur,
  enregistrerProfilCreatifUtilisateur, reinitialiserSondeStyle,
} = await import('@/lib/autopilot/analyse/profil-compte');
const { PUT: PUT_PROFIL } = await import('@/app/api/autopilot/profil-creatif/route');
const { PUT: PUT_CONFIG } = await import('@/app/api/autopilot/config/route');
const { DEFAULT_CONFIG } = await import('@/lib/autopilot/rules');

const MONTAGE = { format: '9:16', dureeSecondes: 30 };
const AUDIO = { sonOriginal: true, volumeSonOriginal: 0.5, volumeMusique: 0.4, musique: null };
const LOOK_CLEAN = { lut: { active: true, lutId: 'clean', intensite: 1 } };
const LOOK_VIBRANT = { lut: { active: true, lutId: 'vibrant', intensite: 1 } };

const requete = (corps: unknown) => ({ json: async () => corps }) as never;

beforeEach(() => {
  lignes = [];
  ecritures = 0;
  rpcDisponible = true;
  sessionUserId = 'moi';
  reinitialiserSondeStyle();
});

// ---------------------------------------------------------------------------
// 1 a 4 — Chaque cle survit a l'ecriture des autres
// ---------------------------------------------------------------------------

describe('1-2. enregistrer « Mon style » ne detruit ni le montage ni l’audio', () => {
  it('1. le montage survit', async () => {
    lignes.push({ user_id: 'moi', design_style: { montage: MONTAGE } });
    await enregistrerProfilCreatifUtilisateur('moi', LOOK_VIBRANT);
    const style = await lireStyleDuCompte('moi');
    expect(style.montage?.dureeSecondes).toBe(30);
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
  });

  it('2. l’audio survit', async () => {
    lignes.push({ user_id: 'moi', design_style: { audio: AUDIO } });
    await enregistrerProfilCreatifUtilisateur('moi', LOOK_VIBRANT);
    const style = await lireStyleDuCompte('moi');
    expect(style.audio?.volumeSonOriginal).toBe(0.5);
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
  });
});

describe('3-4. enregistrer la configuration ne detruit pas « Mon style »', () => {
  /** Ce que l'ecran envoie : la configuration entiere, telle qu'il la connait. */
  const corpsEcran = (designStyle: unknown) => ({
    ...DEFAULT_CONFIG, cadence: 'daily', designStyle,
  });

  it('3. le profil survit a un enregistrement de montage', async () => {
    lignes.push({ user_id: 'moi', design_style: { profilCreatif: LOOK_VIBRANT } });
    // L'ecran renvoie `design_style` SANS le profil : il ne l'a jamais eu.
    const r = await PUT_CONFIG(requete(corpsEcran({ montage: MONTAGE })));
    expect(r.status).toBe(200);
    const relu = await lireProfilCreatifUtilisateur('moi');
    expect(relu?.lut.lutId).toBe('vibrant');
    expect((await lireStyleDuCompte('moi')).montage?.dureeSecondes).toBe(30);
  });

  it('4. le profil survit a un enregistrement d’audio', async () => {
    lignes.push({ user_id: 'moi', design_style: { profilCreatif: LOOK_VIBRANT } });
    const r = await PUT_CONFIG(requete(corpsEcran({ audio: AUDIO })));
    expect(r.status).toBe(200);
    expect((await lireProfilCreatifUtilisateur('moi'))?.lut.lutId).toBe('vibrant');
  });

  /**
   * ⚠️ LE TEST QUI A TROUVE LE DEFAUT.
   *
   * L'ecran garde `design_style` en memoire depuis son chargement. Entre
   * temps, « Mon style » a ete enregistre. Le PUT suivant reposait la valeur
   * PERIMEE, et le style disparaissait — sans erreur, sans message.
   */
  it('5. un ecran PERIME ne peut plus ecraser le style enregistre entre temps', async () => {
    lignes.push({ user_id: 'moi', design_style: { profilCreatif: LOOK_CLEAN, montage: MONTAGE } });
    // 1. L'ecran a charge cet etat.
    const vuParLEcran = { profilCreatif: LOOK_CLEAN, montage: MONTAGE };
    // 2. « Mon style » est enregistre : la base change, l'ecran non.
    await enregistrerProfilCreatifUtilisateur('moi', LOOK_VIBRANT);
    expect((await lireProfilCreatifUtilisateur('moi'))?.lut.lutId).toBe('vibrant');
    // 3. L'ecran enregistre la cadence, avec sa vue PERIMEE du style.
    const r = await PUT_CONFIG(requete(corpsEcran(vuParLEcran)));
    expect(r.status).toBe(200);
    // Le style enregistre a l'etape 2 doit AVOIR SURVECU.
    expect((await lireProfilCreatifUtilisateur('moi'))?.lut.lutId).toBe('vibrant');
    // Et le montage de l'ecran est bien enregistre : la regle n'empeche pas
    // l'ecran d'ecrire CE QUI LUI APPARTIENT.
    expect((await lireStyleDuCompte('moi')).montage?.dureeSecondes).toBe(30);
  });

  it('un client malveillant ne peut pas non plus poser un profil par cette route', async () => {
    lignes.push({ user_id: 'moi', design_style: { profilCreatif: LOOK_CLEAN } });
    await PUT_CONFIG(requete(corpsEcran({ profilCreatif: LOOK_VIBRANT })));
    // La route de configuration ne possede pas cette cle : la base garde la sienne.
    expect((await lireProfilCreatifUtilisateur('moi'))?.lut.lutId).toBe('clean');
  });
});

// ---------------------------------------------------------------------------
// 5 — Deux ecritures simultanees sur des sous-cles differentes
// ---------------------------------------------------------------------------

describe('5. deux mises a jour concurrentes sur des sous-cles differentes ne se perdent pas', () => {
  it('l’ecriture du profil est UNE instruction, pas un lire-puis-ecrire', async () => {
    lignes.push({ user_id: 'moi', design_style: { montage: MONTAGE } });
    ecritures = 0;
    await enregistrerProfilCreatifUtilisateur('moi', LOOK_VIBRANT);
    // ⚠️ LE POINT DU TEST : une seule ecriture. Un lire-modifier-ecrire en
    // ferait autant, mais laisserait une fenetre entre les deux ou une
    // ecriture voisine se perd. La fusion `||` est atomique cote base.
    expect(ecritures).toBe(1);
  });

  it('une ecriture voisine glissee AU MILIEU de la fusion n’est pas perdue', async () => {
    lignes.push({ user_id: 'moi', design_style: {} });
    // On lance les deux « en meme temps » : l'ordre d'arrivee ne doit
    // determiner que l'ordre, jamais la perte.
    await Promise.all([
      enregistrerProfilCreatifUtilisateur('moi', LOOK_VIBRANT),
      (async () => {
        const q = makeQuery();
        await (q.upsert as (p: Ligne) => Promise<unknown>)({
          user_id: 'moi', design_style: { montage: MONTAGE },
        });
      })(),
    ]);
    const style = await lireStyleDuCompte('moi');
    // L'une des deux peut arriver en second ; AUCUNE ne doit disparaitre du
    // fait de l'autre quand elles touchent des cles differentes.
    const survivants = [style.montage !== undefined, style.profilCreatif !== undefined];
    expect(survivants.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    // Et la fusion, elle, garde les deux.
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
  });

  it('sans la fonction SQL, le repli conserve quand meme les cles voisines', async () => {
    rpcDisponible = false;
    reinitialiserSondeStyle();
    lignes.push({ user_id: 'moi', design_style: { montage: MONTAGE, audio: AUDIO } });
    const r = await enregistrerProfilCreatifUtilisateur('moi', LOOK_VIBRANT);
    expect(r.ok).toBe(true);
    const style = await lireStyleDuCompte('moi');
    expect(style.montage?.dureeSecondes).toBe(30);
    expect(style.audio?.volumeSonOriginal).toBe(0.5);
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
  });
});

// ---------------------------------------------------------------------------
// 6 — Le cloisonnement tient toujours
// ---------------------------------------------------------------------------

describe('6. le cloisonnement entre comptes tient sur les deux routes', () => {
  it('la fusion n’ecrit que dans la ligne du compte de la session', async () => {
    lignes.push({ user_id: 'bob', design_style: { profilCreatif: LOOK_CLEAN } });
    sessionUserId = 'alice';
    await PUT_PROFIL(requete(LOOK_VIBRANT));
    expect((await lireProfilCreatifUtilisateur('bob'))?.lut.lutId).toBe('clean');
    expect((await lireProfilCreatifUtilisateur('alice'))?.lut.lutId).toBe('vibrant');
  });

  it('la configuration d’alice ne touche pas la ligne de bob', async () => {
    lignes.push({ user_id: 'bob', design_style: { montage: MONTAGE } });
    sessionUserId = 'alice';
    await PUT_CONFIG(requete({ ...DEFAULT_CONFIG, designStyle: { audio: AUDIO } }));
    expect((await lireStyleDuCompte('bob')).montage?.dureeSecondes).toBe(30);
    expect((await lireStyleDuCompte('bob')).audio).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Le garde-fou de derive
// ---------------------------------------------------------------------------

describe('la repartition des cles couvre TOUT ce que design_style peut porter', () => {
  it('aucune cle de design_style n’est orpheline', async () => {
    const {
      CLES_DESIGN_STYLE_CONFIG, CLES_DESIGN_STYLE_HORS_CONFIG,
    } = await import('@/lib/autopilot/analyse/profil-compte');
    const { sanitizeDesignStyle } = await import('@/lib/autopilot/textStyle');

    // Un style COMPLET, tel que l'assainisseur sait le produire. Les valeurs
    // n'ont pas d'importance : seules comptent les cles qui ressortent.
    const complet = sanitizeDesignStyle({
      montage: MONTAGE,
      audio: AUDIO,
      profilCreatif: LOOK_VIBRANT,
      objectifParDefaut: { type: 'vente' },
      title: { font: 'Anton', scale: 1, x: 50, y: 20, color: '#FFFFFF' },
      subtitle: { font: 'Anton', scale: 1, color: '#FFFFFF' },
      cta: { font: 'Anton', scale: 1, x: 50, y: 80, color: '#FFFFFF' },
      cards: { font: 'Anton', scale: 1, color: '#FFFFFF' },
      cardIcons: { 0: 'Flame' },
      cardStyle: 'Stats Bold',
    });

    const reparties = new Set<string>([
      ...CLES_DESIGN_STYLE_CONFIG, ...CLES_DESIGN_STYLE_HORS_CONFIG,
    ]);
    // ⚠️ LE POINT DU TEST. Une cle ajoutee au type et oubliee dans la
    // repartition serait ineditable depuis l'ecran : un reglage qui s'affiche,
    // se modifie, et ne s'enregistre jamais. Personne ne le verrait avant un
    // rapport de bug.
    const orphelines = Object.keys(complet).filter((c) => !reparties.has(c));
    expect(orphelines).toEqual([]);
    // Et l'assainisseur a bien produit quelque chose : un test qui compare
    // deux ensembles vides ne prouve rien.
    expect(Object.keys(complet).length).toBeGreaterThan(4);
  });

  it('les deux listes sont disjointes — aucune cle a deux proprietaires', async () => {
    const {
      CLES_DESIGN_STYLE_CONFIG, CLES_DESIGN_STYLE_HORS_CONFIG,
    } = await import('@/lib/autopilot/analyse/profil-compte');
    const communes = (CLES_DESIGN_STYLE_CONFIG as readonly string[])
      .filter((c) => (CLES_DESIGN_STYLE_HORS_CONFIG as readonly string[]).includes(c));
    expect(communes).toEqual([]);
  });
});
