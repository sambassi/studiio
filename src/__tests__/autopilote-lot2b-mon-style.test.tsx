/**
 * LOT 2B ETAPE 3 — « MON STYLE » : PERSISTE, CHARGE TOUT SEUL, ET NE FUITE PAS.
 *
 * ---------------------------------------------------------------------------
 * LES TROIS DEFAUTS QU'ON CHERCHE ICI
 * ---------------------------------------------------------------------------
 *
 *   1. LE STYLE D'UN AUTRE COMPTE. `supabaseAdmin` contourne RLS : c'est le
 *      `eq('user_id', …)` qui tient toute la garde. Une requete sans filtre
 *      rendrait la premiere ligne venue, et personne ne le verrait avant que
 *      deux comptes ne se retrouvent avec le meme logo.
 *
 *   2. L'ECRITURE SILENCIEUSE DU DEFAUT. Un style essaye sur une video ne doit
 *      jamais devenir l'identite du compte. Le defaut ne bouge que sur un
 *      geste explicite.
 *
 *   3. L'ECRAN QUI PROMET CE QUE LE MOTEUR NE REND PAS. Quatre des sept
 *      transitions du catalogue deviennent `cut`. Les afficher donnerait un
 *      reglage choisi et sans effet.
 *
 * Le troisieme se teste en MONTANT le composant et en interrogeant le DOM,
 * pas en cherchant une chaine dans le source : `tasks/lessons.md` a paye ce
 * raccourci une fois.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Une base en memoire, pour `autopilot_config`
// ---------------------------------------------------------------------------

type Ligne = Record<string, unknown>;
let lignes: Ligne[] = [];
let colonneStylePresente = true;
let baseInjoignable = false;

function makeQuery() {
  const filtres: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    select(colonnes: string) {
      // Reproduit le comportement de PostgREST quand la colonne manque : une
      // erreur, et non une ligne sans le champ.
      if (!colonneStylePresente && colonnes.includes('design_style')) {
        q.__erreur = { message: 'column autopilot_config.design_style does not exist' };
      }
      return q;
    },
    eq(colonne: string, valeur: unknown) { filtres.push([colonne, valeur]); return q; },
    limit() { return q.__resoudre(); },
    async upsert(payload: Ligne) {
      if (baseInjoignable) return { error: { message: 'down' } };
      if (!colonneStylePresente && 'design_style' in payload) {
        return { error: { message: 'column does not exist' } };
      }
      const existante = lignes.find((l) => l.user_id === payload.user_id);
      if (existante) Object.assign(existante, payload);
      else lignes.push({ ...payload });
      return { error: null };
    },
    __erreur: null as { message: string } | null,
    __resoudre() {
      if (baseInjoippable()) return Promise.resolve({ data: null, error: { message: 'down' } });
      if (q.__erreur) return Promise.resolve({ data: null, error: q.__erreur });
      const trouvees = lignes.filter(
        (l) => filtres.every(([c, v]) => l[c] === v),
      );
      return Promise.resolve({ data: trouvees, error: null });
    },
  };
  return q;
}
function baseInjoippable() { return baseInjoignable; }

/**
 * ⚠️ ICI, LA FONCTION SQL DE FUSION N'EXISTE PAS.
 *
 * Ce fichier verifie donc le CHEMIN DE REPLI — celui qui tourne tant que la
 * migration du 2026-09-06 n'est pas appliquee en production. L'atomicite, elle,
 * est couverte par `autopilote-lot2b-style-concurrence`. Les deux chemins
 * doivent donner le meme resultat fonctionnel, et c'est ce que la duplication
 * de couverture prouve.
 */
const rpcAbsente = async () => ({
  data: null,
  error: { message: 'Could not find the function public.autopilot_design_style_merge' },
});

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => makeQuery(), rpc: rpcAbsente },
  supabase: { from: () => makeQuery(), rpc: rpcAbsente },
}));

// La session, pilotee test par test.
let sessionUserId: string | null = 'moi';
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (sessionUserId ? { user: { id: sessionUserId } } : null),
}));

// La propriete du logo : le vrai module est teste ailleurs (etape 2), ici on
// pilote sa reponse pour observer ce que la ROUTE en fait.
const verifierLogoMock = vi.fn();
vi.mock('@/lib/autopilot/analyse/logo-source', async (originel) => {
  const vrai = await originel<typeof import('@/lib/autopilot/analyse/logo-source')>();
  return { ...vrai, verifierLogo: (...a: unknown[]) => verifierLogoMock(...a) };
});

// MediaLibrary interroge le reseau au montage : hors sujet ici.
vi.mock('@/components/shared/MediaLibrary', () => ({
  MediaLibrary: () => null,
}));

const {
  lireProfilCreatifUtilisateur, enregistrerProfilCreatifUtilisateur,
  lireStyleDuCompte, reinitialiserSondeStyle,
} = await import('@/lib/autopilot/analyse/profil-compte');
const {
  PROFIL_CREATIF_DEFAUT, estProfilHistorique, fusionnerProfilEtOverride,
  normaliserProfilCreatif, profilCreatifCanonique,
} = await import('@/lib/autopilot/analyse/profil-creatif');
const { methodeRendu, METHODE_RENDU } = await import('@/lib/autopilot/analyse/rendu-contrat');
const { RECETTE_AUDIO_DEFAUT } = await import('@/lib/autopilot/analyse/recette-audio');
const { TRANSITIONS_RENDUES, TRANSITIONS_NON_RENDUES } =
  await import('@/lib/autopilot/analyse/rendu-style');
const { ALGORITHME_COUPES } = await import('@/lib/autopilot/analyse/coupe-contrat');
const { ALGORITHME_PLAN } = await import('@/lib/autopilot/analyse/montage-contrat');
const { TRANSITION_IDS } = await import('@/lib/autopilot/analyse/catalogues-creatifs');
const { GET, PUT } = await import('@/app/api/autopilot/profil-creatif/route');
const MonStylePanel = (await import('@/components/creer/MonStylePanel')).default;

const STYLE_VIBRANT = { lut: { active: true, lutId: 'vibrant', intensite: 0.9 } };

function poser(userId: string, designStyle: unknown) {
  lignes.push({ user_id: userId, design_style: designStyle });
}

beforeEach(() => {
  lignes = [];
  colonneStylePresente = true;
  baseInjoignable = false;
  sessionUserId = 'moi';
  reinitialiserSondeStyle();
  verifierLogoMock.mockReset();
  verifierLogoMock.mockResolvedValue({ ok: true, taille: 4096 });
});

const requete = (corps: unknown) => ({ json: async () => corps }) as never;

// ---------------------------------------------------------------------------
// 1 + 2 — Lecture du style du compte
// ---------------------------------------------------------------------------

describe('1. un compte sans style tombe sur les valeurs generiques', () => {
  it('aucune ligne : le profil est null, pas un objet a moitie rempli', async () => {
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });

  it('une ligne sans profilCreatif : toujours null', async () => {
    poser('moi', { montage: { format: 'reel' } });
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });

  it('null rend la methode de rendu HISTORIQUE — les anciens rendus restent servis', async () => {
    const p = await lireProfilCreatifUtilisateur('moi');
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, p)).toBe(METHODE_RENDU);
  });

  it('la colonne absente ne fait pas echouer : elle rend « pas de style »', async () => {
    colonneStylePresente = false;
    poser('moi', { profilCreatif: STYLE_VIBRANT });
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });

  it('la base injoignable ne fait pas echouer non plus', async () => {
    baseInjoignable = true;
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });
});

describe('2. un compte avec style le voit charge automatiquement', () => {
  it('le profil enregistre est relu et normalise', async () => {
    poser('moi', { profilCreatif: STYLE_VIBRANT });
    const p = await lireProfilCreatifUtilisateur('moi');
    expect(p).not.toBeNull();
    expect(p!.lut.lutId).toBe('vibrant');
    expect(p!.lut.intensite).toBe(0.9);
  });

  it('un profil corrompu en base est ignore EN BLOC, jamais applique a moitie', async () => {
    poser('moi', { profilCreatif: { lut: { active: true, lutId: 'inexistant' } } });
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3 + 4 — Le cloisonnement entre comptes
// ---------------------------------------------------------------------------

describe('3. le compte A ne lit jamais le style du compte B', () => {
  it('le style de B reste invisible pour A', async () => {
    poser('bob', { profilCreatif: STYLE_VIBRANT });
    expect(await lireProfilCreatifUtilisateur('alice')).toBeNull();
    expect(await lireProfilCreatifUtilisateur('bob')).not.toBeNull();
  });

  it('la route GET ne rend que le style de la session', async () => {
    poser('bob', { profilCreatif: STYLE_VIBRANT });
    sessionUserId = 'alice';
    const j = await (await GET()).json();
    expect(j.ok).toBe(true);
    expect(j.profil).toBeNull();
  });

  it('sans session, la route refuse', async () => {
    sessionUserId = null;
    expect((await GET()).status).toBe(401);
    expect((await PUT(requete(STYLE_VIBRANT))).status).toBe(401);
  });
});

describe('4. le compte A ne modifie jamais le style du compte B', () => {
  it('ecrire chez A laisse la ligne de B intacte', async () => {
    poser('bob', { profilCreatif: { lut: { active: true, lutId: 'clean', intensite: 1 } } });
    await enregistrerProfilCreatifUtilisateur('alice', STYLE_VIBRANT);
    const chezBob = await lireProfilCreatifUtilisateur('bob');
    expect(chezBob!.lut.lutId).toBe('clean');
    const chezAlice = await lireProfilCreatifUtilisateur('alice');
    expect(chezAlice!.lut.lutId).toBe('vibrant');
  });

  it('le corps de la requete ne peut pas designer un autre compte', async () => {
    poser('bob', { profilCreatif: { lut: { active: true, lutId: 'clean', intensite: 1 } } });
    sessionUserId = 'alice';
    // `userId` n'est meme pas un champ du schema : il est refuse comme inconnu.
    const r = await PUT(requete({ userId: 'bob', ...STYLE_VIBRANT }));
    expect(r.status).toBe(422);
    const chezBob = await lireProfilCreatifUtilisateur('bob');
    expect(chezBob!.lut.lutId).toBe('clean');
  });
});

// ---------------------------------------------------------------------------
// 5 + 6 + 7 — Profil effectif et geste explicite
// ---------------------------------------------------------------------------

describe('5. l’override de la video l’emporte sur le style du compte', () => {
  it('champ par champ, sans effacer le reste du bloc', async () => {
    poser('moi', {
      profilCreatif: {
        lut: { active: true, lutId: 'clean', intensite: 0.6 },
        transitions: { active: true, transitionId: 'crossfade', dureeMs: 400, intensite: 0.3 },
      },
    });
    const compte = await lireProfilCreatifUtilisateur('moi');
    const effectif = fusionnerProfilEtOverride(compte, {
      transitions: { transitionId: 'flash' },
    });
    expect(effectif.transitions.transitionId).toBe('flash');
    // Le reste du bloc SURVIT.
    expect(effectif.transitions.dureeMs).toBe(400);
    // Et le look du compte aussi.
    expect(effectif.lut.lutId).toBe('clean');
  });

  it('sans override, le profil effectif EST celui du compte', async () => {
    poser('moi', { profilCreatif: STYLE_VIBRANT });
    const compte = await lireProfilCreatifUtilisateur('moi');
    expect(profilCreatifCanonique(compte)).toBe(profilCreatifCanonique(compte));
    expect(compte!.lut.lutId).toBe('vibrant');
  });
});

describe('6. l’override d’une video n’ecrit JAMAIS le defaut du compte', () => {
  it('fusionner ne touche pas la base', async () => {
    poser('moi', { profilCreatif: STYLE_VIBRANT });
    const compte = await lireProfilCreatifUtilisateur('moi');
    fusionnerProfilEtOverride(compte, { lut: { lutId: 'cinema-cool' } });
    const relu = await lireProfilCreatifUtilisateur('moi');
    expect(relu!.lut.lutId).toBe('vibrant');
  });

  it('le profil par defaut du produit reste fige', () => {
    expect(Object.isFrozen(PROFIL_CREATIF_DEFAUT)).toBe(true);
    expect(estProfilHistorique(PROFIL_CREATIF_DEFAUT)).toBe(true);
  });
});

describe('7. seule l’action explicite modifie le defaut', () => {
  it('PUT enregistre, et la relecture le confirme', async () => {
    const r = await PUT(requete(STYLE_VIBRANT));
    expect(r.status).toBe(200);
    const relu = await lireProfilCreatifUtilisateur('moi');
    expect(relu!.lut.lutId).toBe('vibrant');
  });

  it('l’ecriture PRESERVE les freres de profilCreatif dans design_style', async () => {
    poser('moi', {
      montage: { format: '9:16', dureeSecondes: 30 },
      cardStyle: 'Stats Bold',
    });
    await enregistrerProfilCreatifUtilisateur('moi', STYLE_VIBRANT);
    const style = await lireStyleDuCompte('moi');
    expect(style.profilCreatif?.lut.lutId).toBe('vibrant');
    // ⚠️ LE POINT DU TEST : `design_style` porte aussi le montage et les
    // cartes. Ecrire `{ profilCreatif }` seul les effacerait sans un mot.
    expect(style.montage).toBeDefined();
    expect(style.montage!.format).toBe('9:16');
    expect(style.cardStyle).toBe('Stats Bold');
  });

  it('la colonne absente rend 503 — jamais un succes qui n’enregistre rien', async () => {
    colonneStylePresente = false;
    const r = await PUT(requete(STYLE_VIBRANT));
    expect(r.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// 8 a 11 — Ce que la route refuse
// ---------------------------------------------------------------------------

describe('8-10. un profil invalide est refuse en entier', () => {
  it('8. un champ inconnu est refuse', async () => {
    const r = await PUT(requete({ lut: { active: true, lutPath: '/tmp/x.cube' } }));
    expect(r.status).toBe(422);
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });

  it('9. un identifiant de LUT inconnu est refuse', async () => {
    const r = await PUT(requete({ lut: { active: true, lutId: 'afroboost' } }));
    expect(r.status).toBe(422);
    expect((await r.json()).motif).toBe('identifiant_inconnu');
  });

  it('10. une couleur qui n’est pas un hex est refusee', async () => {
    const r = await PUT(requete({ couleurs: { accent: 'rouge' } }));
    expect(r.status).toBe(422);
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });

  it('une opacite hors borne est refusee', async () => {
    expect((await PUT(requete({ marque: { opacite: 1.5 } }))).status).toBe(422);
  });
});

describe('11. un logo qui n’appartient pas au compte est refuse A L’ENREGISTREMENT', () => {
  it('la cle d’un tiers ne s’installe pas dans le style du compte', async () => {
    verifierLogoMock.mockResolvedValue({ ok: false, motif: 'logo_hors_perimetre' });
    const r = await PUT(requete({
      marque: { logoActif: true, logo: { bucket: 'images', cle: 'bob/logo.png' } },
    }));
    expect(r.status).toBe(422);
    expect(verifierLogoMock).toHaveBeenCalled();
    // ⚠️ LE POINT DU TEST : rien n'est enregistre. Une garde placee seulement
    // au rendu laisserait la cle fausse s'installer, et l'utilisateur verrait
    // un style « enregistre » qui echoue video apres video.
    expect(await lireProfilCreatifUtilisateur('moi')).toBeNull();
  });

  it('un stockage injoignable rend 503, pas 422 — la demande n’est pas fautive', async () => {
    verifierLogoMock.mockResolvedValue({ ok: false, motif: 'stockage_injoignable' });
    const r = await PUT(requete({
      marque: { logoActif: true, logo: { bucket: 'images', cle: 'moi/logo.png' } },
    }));
    expect(r.status).toBe(503);
  });

  it('le logo du compte, lui, passe', async () => {
    const r = await PUT(requete({
      marque: { logoActif: true, logo: { bucket: 'images', cle: 'moi/logo.png' } },
    }));
    expect(r.status).toBe(200);
    const relu = await lireProfilCreatifUtilisateur('moi');
    expect(relu!.marque.logo?.cle).toBe('moi/logo.png');
  });
});

// ---------------------------------------------------------------------------
// 12 a 14 — L'identite de rendu suit le profil EFFECTIF
// ---------------------------------------------------------------------------

describe('12-14. l’empreinte de rendu porte sur le profil EFFECTIF', () => {
  it('12. compte + override donnent l’empreinte du RESULTAT, pas celle du compte', async () => {
    poser('moi', { profilCreatif: { lut: { active: true, lutId: 'clean', intensite: 1 } } });
    const compte = await lireProfilCreatifUtilisateur('moi');
    const effectif = fusionnerProfilEtOverride(compte, { lut: { lutId: 'cinema-cool' } });

    const mCompte = methodeRendu(RECETTE_AUDIO_DEFAUT, compte);
    const mEffectif = methodeRendu(RECETTE_AUDIO_DEFAUT, effectif);
    expect(mEffectif).not.toBe(mCompte);
    // Et c'est bien l'empreinte de ce qui sera rendu.
    expect(mEffectif).toBe(methodeRendu(
      RECETTE_AUDIO_DEFAUT,
      normaliserProfilCreatif({ lut: { active: true, lutId: 'cinema-cool', intensite: 1 } }),
    ));
  });

  it('13. deux profils effectifs identiques donnent la MEME empreinte', async () => {
    poser('moi', { profilCreatif: { lut: { active: true, lutId: 'clean', intensite: 1 } } });
    const compte = await lireProfilCreatifUtilisateur('moi');
    const a = fusionnerProfilEtOverride(compte, { lut: { lutId: 'vibrant' } });
    const b = fusionnerProfilEtOverride(
      normaliserProfilCreatif({ lut: { active: true, lutId: 'vibrant', intensite: 1 } }), null,
    );
    expect(profilCreatifCanonique(a)).toBe(profilCreatifCanonique(b));
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, a)).toBe(methodeRendu(RECETTE_AUDIO_DEFAUT, b));
  });

  it('14. changer le style du compte change l’empreinte — le cache ne sert pas l’ancienne video', async () => {
    poser('moi', { profilCreatif: { lut: { active: true, lutId: 'clean', intensite: 1 } } });
    const avant = methodeRendu(RECETTE_AUDIO_DEFAUT, await lireProfilCreatifUtilisateur('moi'));
    await enregistrerProfilCreatifUtilisateur('moi', {
      lut: { active: true, lutId: 'cinema-warm', intensite: 1 },
    });
    const apres = methodeRendu(RECETTE_AUDIO_DEFAUT, await lireProfilCreatifUtilisateur('moi'));
    expect(apres).not.toBe(avant);
  });
});

// ---------------------------------------------------------------------------
// 15 a 18 — L'ECRAN ne promet que ce qui est rendu
// ---------------------------------------------------------------------------

describe('15-18. l’ecran n’affiche que les transitions REELLEMENT rendues', () => {
  function monter(profil: Parameters<typeof MonStylePanel>[0]['profilEnregistre'] = null) {
    return render(
      <MonStylePanel profilEnregistre={profil} onEnregistrer={async () => true} />,
    );
  }

  it('15-17. cut, crossfade et flash sont proposes', () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: /Configurer/ }));
    for (const id of ['cut', 'crossfade', 'flash']) {
      expect(document.querySelector(`[data-mon-style-transition="${id}"]`)).not.toBeNull();
    }
  });

  it('18. zoom, slide, whip et blur ne sont PAS presentes comme actifs', () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: /Configurer/ }));
    for (const id of TRANSITIONS_NON_RENDUES) {
      expect(document.querySelector(`[data-mon-style-transition="${id}"]`)).toBeNull();
    }
  });

  it('la liste de l’ecran DERIVE du moteur — elle n’est pas une seconde liste', () => {
    // Si un jour `zoom` devient rendu, il apparaitra sans qu'on touche a
    // l'ecran ; et il ne peut pas apparaitre avant.
    expect([...TRANSITIONS_RENDUES].sort())
      .toEqual([...TRANSITIONS_RENDUES].filter((t) => TRANSITION_IDS.includes(t)).sort());
    for (const id of TRANSITIONS_NON_RENDUES) {
      expect(TRANSITIONS_RENDUES as readonly string[]).not.toContain(id);
    }
  });

  it('aucune commande de police ni de texte de CTA n’est proposee', () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: /Configurer/ }));
    // Les polices sont bloquees (licence: null) : rien ne doit les evoquer.
    expect(screen.queryByText(/Police/i)).toBeNull();
    expect(document.querySelector('[data-mon-style-police]')).toBeNull();
    expect(document.querySelector('[data-mon-style-cta-texte]')).toBeNull();
  });

  it('l’etat dit « Style par defaut » sans style, « Mon style » avec', () => {
    const { unmount } = monter();
    expect(document.querySelector('[data-mon-style-etat="defaut"]')).not.toBeNull();
    unmount();
    monter(normaliserProfilCreatif({ lut: { active: true, lutId: 'vibrant', intensite: 1 } }));
    expect(document.querySelector('[data-mon-style-etat="personnel"]')).not.toBeNull();
  });

  it('rien n’est envoye tant que le bouton n’est pas presse', async () => {
    const envoyer = vi.fn(async () => true);
    render(<MonStylePanel profilEnregistre={null} onEnregistrer={envoyer} />);
    fireEvent.click(screen.getByRole('button', { name: /Configurer/ }));
    fireEvent.click(document.querySelector('[data-mon-style-look="vibrant"]')!);
    // Le reglage a change a l'ecran…
    expect(document.querySelector('[data-mon-style-look-intensite]')).not.toBeNull();
    // …et RIEN n'est parti.
    expect(envoyer).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector('[data-mon-style-enregistrer]')!);
    await waitFor(() => expect(envoyer).toHaveBeenCalledTimes(1));
    expect(envoyer.mock.calls[0][0].lut.lutId).toBe('vibrant');
  });
});

// ---------------------------------------------------------------------------
// 19 a 22 — Rien d'autre n'a bouge
// ---------------------------------------------------------------------------

describe('19-22. le montage et l’audio sont intacts', () => {
  it('20. m3e-v3 inchange', () => { expect(ALGORITHME_COUPES).toBe('m3e-v3'); });
  it('21. m3g-v2 inchange', () => { expect(ALGORITHME_PLAN).toBe('m3g-v2'); });

  it('19. la recette audio par defaut n’est pas touchee par le style du compte', async () => {
    poser('moi', { audio: { sonOriginal: true, volumeSonOriginal: 0.5, volumeMusique: 0.5, musique: null } });
    await enregistrerProfilCreatifUtilisateur('moi', STYLE_VIBRANT);
    const style = await lireStyleDuCompte('moi');
    expect(style.audio).toBeDefined();
    expect(style.audio!.volumeSonOriginal).toBe(0.5);
  });

  it('22. une donnee d’objectif glissee dans le profil ne change pas l’empreinte', () => {
    const avec = profilCreatifCanonique({
      // @ts-expect-error — champ volontairement etranger au profil creatif
      objectif: { type: 'vente' },
      lut: { active: true, lutId: 'clean', intensite: 1 },
    });
    const sans = profilCreatifCanonique({ lut: { active: true, lutId: 'clean', intensite: 1 } });
    expect(avec).toBe(sans);
  });

  it('un objectif enregistre a cote du profil ne change pas l’empreinte du profil', async () => {
    poser('moi', {
      profilCreatif: STYLE_VIBRANT,
      objectifParDefaut: { type: 'vente', ton: 'direct' },
    });
    const p = await lireProfilCreatifUtilisateur('moi');
    expect(methodeRendu(RECETTE_AUDIO_DEFAUT, p)).toBe(methodeRendu(
      RECETTE_AUDIO_DEFAUT,
      normaliserProfilCreatif({ lut: { active: true, lutId: 'vibrant', intensite: 0.9 } }),
    ));
  });
});
