/**
 * A_3e1 — LES FAVORIS PERSISTENT, LES RÉCENTS SE DÉDUISENT.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI LA BIBLIOTHÈQUE N'EST PAS DANS LE PROFIL CRÉATIF
 * ---------------------------------------------------------------------------
 *
 * `profilCreatifCanonique` alimente l'identité du rendu. Y ranger les favoris
 * ferait qu'un cœur cliqué invaliderait tous les montages déjà calculés du
 * compte : une préférence d'affichage qui refait des vidéos. Elle est donc un
 * FRÈRE de `profilCreatif` dans `design_style`, avec son propre écrivain.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ET POURQUOI LES RÉCENTS NE SONT PAS STOCKÉS
 * ---------------------------------------------------------------------------
 *
 * Une seconde liste `recentIds` mise à jour après chaque rendu mentirait dès
 * le premier échec ou le premier enregistrement manqué. Un rendu RÉUSSI est
 * déjà la preuve qu'un choix a servi : les récents se lisent dans
 * `usage.creatif` des derniers montages.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FAMILLES_BIBLIOTHEQUE, LIBELLES_FAMILLE, FAVORIS_MAX_PAR_FAMILLE,
  RECENTS_MAX_PAR_FAMILLE, CLE_USAGE_PAR_FAMILLE, BIBLIOTHEQUE_VIDE, FAVORIS_VIDES,
  favorisValides, bibliothequeValide, bibliothequeVide, basculerFavori,
  recentsDepuisUsages, idsFamille,
} from '@/lib/creatif/bibliotheque';
import {
  sanitizeDesignStyle, bibliothequeDepuisStyle,
} from '@/lib/autopilot/textStyle';
import {
  CLES_DESIGN_STYLE_HORS_CONFIG, CLES_DESIGN_STYLE_CONFIG, patchDesignStyleConfig,
} from '@/lib/autopilot/analyse/profil-compte';
import {
  profilCreatifCanonique, PROFIL_CREATIF_DEFAUT,
} from '@/lib/autopilot/analyse/profil-creatif';
import { LOOK_IDS } from '@/lib/creatif/looks';
import { STYLE_TEXTE_IDS } from '@/lib/creatif/styles-texte';
import { TRANSITION_CREATIVE_IDS } from '@/lib/creatif/transitions';

const Recherche = (await import('@/components/creer/RechercheCreative')).default;
const { grouperResultats, RESULTATS_MAX_PAR_FAMILLE } =
  await import('@/components/creer/RechercheCreative');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const CONTRAT = lire('src/lib/creatif/bibliotheque.ts');
const HOOK = lire('src/lib/hooks/useBibliothequeCreative.ts');
const ROUTE = lire('src/app/api/autopilot/bibliotheque-creative/route.ts');
const SERVICE = lire('src/lib/autopilot/analyse/rendu-service.ts');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu.ts');
const PANNEAU = lire('src/components/creer/MonStylePanel.tsx');

afterEach(() => { cleanup(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les favoris — validés, bornés, jamais morts', () => {
  it('1.1 les cinq familles créatives ont chacune leurs favoris', () => {
    expect([...FAMILLES_BIBLIOTHEQUE]).toEqual([
      'lut', 'styleTexte', 'animationBloc', 'animationContenu', 'transition',
    ]);
    for (const f of FAMILLES_BIBLIOTHEQUE) {
      expect(BIBLIOTHEQUE_VIDE.favoris[f]).toEqual([]);
      expect(LIBELLES_FAMILLE[f].length).toBeGreaterThan(3);
      expect(idsFamille(f).length).toBeGreaterThan(5);
    }
  });

  it('1.2 ⚠️ un identifiant disparu du catalogue est RETIRÉ, sans erreur', () => {
    const r = bibliothequeValide({
      favoris: { lut: ['cinema-warm', 'look-supprime-en-2027', LOOK_IDS[1]] },
    });
    expect(r.favoris.lut).not.toContain('look-supprime-en-2027');
    expect(r.favoris.lut.length).toBe(2);
  });

  it('1.3 ce qui n’est pas une chaîne, et les doublons, ne passent pas', () => {
    const r = favorisValides([LOOK_IDS[0], LOOK_IDS[0], 42, null, {}], 'lut');
    expect(r).toEqual([LOOK_IDS[0]]);
  });

  it('1.4 l’ORDRE de la personne est conservé — c’est son classement', () => {
    const trois = [LOOK_IDS[3], LOOK_IDS[0], LOOK_IDS[7]];
    expect(favorisValides(trois, 'lut')).toEqual(trois);
  });

  it('1.5 une vraie collection, mais bornée', () => {
    expect(FAVORIS_MAX_PAR_FAMILLE).toBeGreaterThanOrEqual(20);
    const trop = favorisValides([...LOOK_IDS, ...LOOK_IDS], 'lut');
    expect(trop.length).toBeLessThanOrEqual(FAVORIS_MAX_PAR_FAMILLE);
  });

  it('1.6 basculer ajoute puis retire, et normalise au passage', () => {
    let f = FAVORIS_VIDES;
    f = basculerFavori(f, 'transition', 'fondu');
    expect(f.transition).toEqual(['fondu']);
    f = basculerFavori(f, 'transition', 'pixels');
    expect(f.transition).toEqual(['fondu', 'pixels']);
    f = basculerFavori(f, 'transition', 'fondu');
    expect(f.transition).toEqual(['pixels']);
    // Un identifiant inconnu n'entre pas, même par cette porte.
    expect(basculerFavori(f, 'transition', 'inconnue').transition).toEqual(['pixels']);
  });

  it('1.7 « aucune » est un favori valide pour les apparitions', () => {
    expect(idsFamille('animationContenu')).toContain('aucune');
    expect(favorisValides(['aucune'], 'animationContenu')).toEqual(['aucune']);
  });

  it('1.8 le contrat ne lit ni base ni disque', () => {
    expect(sansProse(CONTRAT)).not.toMatch(/node:fs|supabase|fetch\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La persistance', () => {
  it('2.1 elle survit à un aller-retour par `sanitizeDesignStyle`', () => {
    const style = sanitizeDesignStyle({
      bibliothequeCreative: { favoris: { lut: ['cinema-warm'], transition: ['fondu'] } },
    });
    expect(style.bibliothequeCreative?.favoris.lut).toEqual(['cinema-warm']);
    expect(bibliothequeDepuisStyle(style).favoris.transition).toEqual(['fondu']);
  });

  it('2.2 ⚠️ sans cette ligne dans le sanitizer, les favoris seraient effacés', () => {
    // Le test qui aurait manqué pour `montage`, puis pour `audio`.
    expect(sansProse(lire('src/lib/autopilot/textStyle.ts')))
      .toContain('bibliothequeCreative: bibliothequeValideOuRien(o.bibliothequeCreative)');
  });

  it('2.3 vide = absent : un compte sans favori n’alourdit aucun document', () => {
    expect(sanitizeDesignStyle({ bibliothequeCreative: { favoris: {} } })
      .bibliothequeCreative).toBeUndefined();
    expect(bibliothequeVide(BIBLIOTHEQUE_VIDE)).toBe(true);
  });

  it('2.4 ⚠️ l’écran de configuration ne peut pas l’effacer', () => {
    expect([...CLES_DESIGN_STYLE_HORS_CONFIG]).toContain('bibliothequeCreative');
    expect([...CLES_DESIGN_STYLE_CONFIG]).not.toContain('bibliothequeCreative');
    const patch = patchDesignStyleConfig({ montage: undefined });
    expect(Object.keys(patch)).not.toContain('bibliothequeCreative');
  });

  it('2.5 ⚠️ un cœur cliqué NE CHANGE PAS l’identité du rendu', () => {
    // C'est la raison d'être de la séparation : sinon chaque favori
    // invaliderait tous les montages déjà calculés du compte.
    const avant = profilCreatifCanonique(PROFIL_CREATIF_DEFAUT);
    const style = sanitizeDesignStyle({
      profilCreatif: PROFIL_CREATIF_DEFAUT,
      bibliothequeCreative: { favoris: { lut: ['cinema-warm'] } },
    });
    expect(profilCreatifCanonique(style.profilCreatif!)).toBe(avant);
  });

  it('2.6 l’écriture ne touche QU’À sa clé — deux écrivains ne se marchent pas dessus', () => {
    const compte = sansProse(lire('src/lib/autopilot/analyse/profil-compte.ts'));
    expect(compte).toContain('fusionnerDesignStyle(userId, { bibliothequeCreative: normalisee })');
    expect(compte).toContain('fusionnerDesignStyle(userId, { profilCreatif: normalise })');
  });

  it('2.7 la route normalise AVANT d’écrire, jamais après', () => {
    const compte = sansProse(lire('src/lib/autopilot/analyse/profil-compte.ts'));
    const iNorm = compte.indexOf('const normalisee = bibliothequeValide(brut)');
    const iEcrit = compte.indexOf('bibliothequeCreative: normalisee');
    expect(iNorm).toBeGreaterThan(-1);
    expect(iNorm).toBeLessThan(iEcrit);
  });

  it('2.8 le `userId` vient de la session, et de nulle part ailleurs', () => {
    const r = sansProse(ROUTE);
    expect(r).toContain('await auth()');
    expect(r).toContain('session.user.id');
    expect(r).not.toMatch(/body\.userId|searchParams\.get\('user/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les récents — déduits des rendus réels', () => {
  const usage = (creatif: Record<string, string | null>) => ({ creatif });

  it('3.1 le plus récent d’abord, dans l’ordre reçu', () => {
    const r = recentsDepuisUsages([
      usage({ lutId: 'cinema-warm' }),
      usage({ lutId: 'vibrant' }),
    ]);
    expect(r.lut).toEqual(['cinema-warm', 'vibrant']);
  });

  it('3.2 ⚠️ un look utilisé six fois n’apparaît QU’UNE, à sa place la plus récente', () => {
    const r = recentsDepuisUsages([
      usage({ lutId: 'vibrant' }),
      usage({ lutId: 'cinema-warm' }),
      usage({ lutId: 'vibrant' }),
      usage({ lutId: 'vibrant' }),
    ]);
    expect(r.lut).toEqual(['vibrant', 'cinema-warm']);
  });

  it('3.3 les cinq familles sortent du même passage', () => {
    const r = recentsDepuisUsages([usage({
      lutId: 'vibrant',
      styleTexteId: STYLE_TEXTE_IDS[2],
      animationBlocId: 'aucune',
      animationContenuId: 'mot-par-mot',
      transitionId: 'fondu',
    })]);
    expect(r.lut).toEqual(['vibrant']);
    expect(r.styleTexte).toEqual([STYLE_TEXTE_IDS[2]]);
    expect(r.animationBloc).toEqual(['aucune']);
    expect(r.animationContenu).toEqual(['mot-par-mot']);
    expect(r.transition).toEqual(['fondu']);
  });

  it('3.4 la liste est bornée', () => {
    const beaucoup = LOOK_IDS.map((id) => usage({ lutId: id }));
    expect(recentsDepuisUsages(beaucoup).lut.length).toBe(RECENTS_MAX_PAR_FAMILLE);
    expect(RECENTS_MAX_PAR_FAMILLE).toBeGreaterThanOrEqual(8);
  });

  it('3.5 un usage sans bloc créatif, ou avec un identifiant mort, est ignoré', () => {
    const r = recentsDepuisUsages([
      {}, { creatif: null } as never, usage({ lutId: 'look-mort' }),
      usage({ lutId: 'vibrant' }),
    ]);
    expect(r.lut).toEqual(['vibrant']);
  });

  it('3.6 ⚠️ le moteur ÉCRIT ces choix — sans quoi les récents seraient vides', () => {
    const m = sansProse(MOTEUR);
    expect(m).toContain('usage.creatif = {');
    for (const f of FAMILLES_BIBLIOTHEQUE) {
      expect(m).toContain(`${CLE_USAGE_PAR_FAMILLE[f]}:`);
    }
  });

  it('3.7 ⚠️ la requête est BORNÉE et filtrée par compte — jamais un parcours de table', () => {
    const s = sansProse(SERVICE);
    expect(s).toContain("export async function listerCreatifsRecents");
    expect(s).toContain(".eq('user_id', userId)");
    expect(s).toContain('.limit(');
    expect(s).toContain("select('usage')");
    // Un rendu échoué ne prouve rien.
    expect(s).toContain(".eq('etat', 'reussie')");
  });

  it('3.8 sans socle de rendus, la grille perd ses récents — elle ne casse pas', () => {
    expect(sansProse(ROUTE)).toContain('let recents = FAVORIS_VIDES');
    expect(sansProse(ROUTE)).toMatch(/try \{[\s\S]{0,200}listerCreatifsRecents/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le cœur répond tout de suite, et revient s’il le faut', () => {
  it('4.1 l’état change AVANT la réponse du serveur', () => {
    const h = sansProse(HOOK);
    const iEtat = h.indexOf('setBibliotheque((avant)');
    const iEcrit = h.indexOf('void ecrire(suivante)');
    expect(iEtat).toBeGreaterThan(-1);
    expect(iEtat).toBeLessThan(iEcrit);
  });

  it('4.2 ⚠️ et il REVIENT EN ARRIÈRE si l’écriture échoue', () => {
    const h = sansProse(HOOK);
    expect(h).toContain('setBibliotheque(avant)');
    expect(h).toContain('setErreur(');
  });

  it('4.3 on n’écrit qu’au clic — ni au survol, ni au rendu', () => {
    expect(sansProse(HOOK)).not.toMatch(/onMouseEnter|onFocus/);
    // Une seule écriture dans le hook, et elle part de `basculer`/`remplacer`.
    expect((sansProse(HOOK).match(/method: 'PUT'/g) ?? []).length).toBe(1);
  });

  it('4.4 le panneau n’a plus dix états locaux qui s’évaporaient', () => {
    expect(PANNEAU).not.toContain('setFavorisLooks');
    expect(PANNEAU).not.toContain('setRecentsTransitions');
    expect(PANNEAU).toContain('useBibliothequeCreative');
    expect(PANNEAU).toContain("biblio.basculer('lut', id)");
    expect(PANNEAU).toContain("biblio.basculer('transition', id)");
  });

  it('4.5 les récents affichés viennent du serveur, plus d’un tableau local', () => {
    expect(PANNEAU).toContain('biblio.recents.lut');
    expect(PANNEAU).toContain('biblio.recents.transition');
    expect(PANNEAU).not.toMatch(/\.slice\(0, 8\)\);/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. La recherche unifiée', () => {
  it('5.1 elle interroge les cinq catalogues d’un coup', () => {
    const g = grouperResultats('cinema');
    expect(g.length).toBeGreaterThanOrEqual(3);
    const familles = g.map((x) => x.famille);
    expect(new Set(familles).size).toBe(familles.length);
  });

  it('5.2 ⚠️ les résultats sont GROUPÉS, jamais empilés dans une liste unique', () => {
    const { container } = render(
      <Recherche
        requete="cinema" onRequete={() => {}} favoris={FAVORIS_VIDES}
        onBasculerFavori={() => {}} onChoisir={() => {}}
      />,
    );
    const groupes = container.querySelectorAll('[data-recherche-groupe]');
    expect(groupes.length).toBeGreaterThanOrEqual(3);
    for (const g of groupes) {
      const f = g.getAttribute('data-recherche-groupe') as never;
      expect(g.textContent).toContain(LIBELLES_FAMILLE[f]);
    }
  });

  it('5.3 une famille sans résultat n’affiche pas un titre suivi de rien', () => {
    for (const g of grouperResultats('energie')) {
      expect(g.entrees.length).toBeGreaterThan(0);
    }
  });

  it('5.4 sans accent, et ça marche quand même', () => {
    expect(grouperResultats('cinema').length).toBe(grouperResultats('cinéma').length);
  });

  it('5.5 chaque famille est bornée : la liste aide, elle ne défile pas', () => {
    for (const g of grouperResultats('e')) {
      expect(g.entrees.length).toBeLessThanOrEqual(RESULTATS_MAX_PAR_FAMILLE);
    }
  });

  it('5.6 une recherche vide ne montre rien ; une sans résultat le dit', () => {
    expect(grouperResultats('   ')).toEqual([]);
    const { container } = render(
      <Recherche
        requete="zzzz" onRequete={() => {}} favoris={FAVORIS_VIDES}
        onBasculerFavori={() => {}} onChoisir={() => {}}
      />,
    );
    expect(container.querySelector('[data-recherche-creative-vide]')).not.toBeNull();
  });

  it('5.7 on peut aimer et choisir depuis la recherche', () => {
    const aimes: string[] = [];
    const choisis: string[] = [];
    const { container } = render(
      <Recherche
        requete="glisse" onRequete={() => {}}
        favoris={{ ...FAVORIS_VIDES, transition: ['glisse-gauche'] }}
        onBasculerFavori={(f, id) => aimes.push(`${f}:${id}`)}
        onChoisir={(f, id) => choisis.push(`${f}:${id}`)}
      />,
    );
    const coeur = container
      .querySelector('[data-recherche-favori="transition:glisse-gauche"]') as HTMLElement;
    expect(coeur.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(coeur);
    expect(aimes).toEqual(['transition:glisse-gauche']);
    fireEvent.click(
      container.querySelector('[data-recherche-resultat="transition:glisse-gauche"]') as HTMLElement,
    );
    expect(choisis).toEqual(['transition:glisse-gauche']);
  });

  it('5.8 ⚠️ aucun appel réseau : les catalogues sont déjà là', () => {
    const r = sansProse(lire('src/components/creer/RechercheCreative.tsx'));
    expect(r).not.toMatch(/fetch\(|useEffect/);
  });

  it('5.9 elle est branchée dans « Mon style », et elle applique le choix', () => {
    expect(PANNEAU).toContain('RechercheCreative');
    expect(PANNEAU).toContain('rechercheGlobale');
    expect(PANNEAU).toContain("famille === 'lut'");
    expect(PANNEAU).toContain("famille === 'animationContenu'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Aucune régression de catalogue', () => {
  it('6.1 les cinq familles ont toujours leur compte', async () => {
    const { LOOKS_CREATIFS } = await import('@/lib/creatif/looks');
    const { STYLES_TEXTE } = await import('@/lib/creatif/styles-texte');
    const { ANIMATIONS_TEXTE } = await import('@/lib/creatif/animations-texte');
    const { ANIMATIONS_CONTENU } = await import('@/lib/creatif/animations-contenu');
    const { TRANSITIONS_CREATIVES } = await import('@/lib/creatif/transitions');
    expect(LOOKS_CREATIFS.length).toBe(34);
    expect(STYLES_TEXTE.length).toBe(26);
    expect(ANIMATIONS_TEXTE.length).toBe(19);
    expect(ANIMATIONS_CONTENU.length).toBe(8);
    expect(TRANSITIONS_CREATIVES.length).toBe(29);
    expect(TRANSITION_CREATIVE_IDS.length).toBe(29);
  });

  it('6.2 aucune migration : tout tient dans le `jsonb` existant', () => {
    expect(sansProse(CONTRAT)).not.toContain('alter table');
    expect(sansProse(SERVICE)).toContain("from('rush_montage_renders')");
    // `usage` est déjà du jsonb : y ajouter une clé n'exige rien.
    expect(sansProse(MOTEUR)).toContain('usage.creatif');
  });
});
