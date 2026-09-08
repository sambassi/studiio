/**
 * A_3e3 — VARIER LE STYLE SANS JAMAIS TIRER AU SORT.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI `Math.random()` EST INTERDIT ICI
 * ---------------------------------------------------------------------------
 *
 * Un rendu est REJOUÉ : le cron réessaie, un worker reprend, une génération
 * repart après une panne. Avec du hasard, chaque tentative produirait une
 * autre vidéo — et `lireRenduReussiIdentique`, qui évite de refaire ce qui
 * existe déjà, ne retrouverait jamais rien. La variété doit venir de ce qui
 * change réellement d'une vidéo à l'autre : le plan.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ET POURQUOI LA PÉNALITÉ DE RÉCENCE EST GRADUÉE
 * ---------------------------------------------------------------------------
 *
 * Une pénalité PLATE interdirait tout ce qui a déjà servi : avec deux effets
 * autorisés, plus rien ne serait choisissable au troisième passage. Le coût
 * décroît donc avec l'ancienneté — très cher hier, gratuit après dix vidéos.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MODES_CREATIFS, LIBELLES_MODE, DESCRIPTIONS_MODE, POLITIQUE_STRICTE,
  VERSION_POLITIQUE_CREATIVE, FAMILLES_BIBLIOTHEQUE, FAVORIS_VIDES,
  politiqueValide, politiqueVide, bibliothequeValide, BIBLIOTHEQUE_VIDE,
  type PolitiqueCreative,
} from '@/lib/creatif/bibliotheque';
import {
  resoudreStyleEffectif, graineCreative, graineHachee, signatureCreative,
  historiqueDepuisUsages, PENALITE_RECENCE, HISTORIQUE_MAX, VARIANTES_MAX,
  type ChoixCreatifs,
} from '@/lib/autopilot/analyse/politique-creative';
import {
  PROFIL_CREATIF_DEFAUT, normaliserProfilCreatif, profilCreatifCanonique,
} from '@/lib/autopilot/analyse/profil-creatif';
import { methodeRendu } from '@/lib/autopilot/analyse/rendu-contrat';
import { RECETTE_AUDIO_DEFAUT } from '@/lib/autopilot/analyse/recette-audio';
import { sanitizeDesignStyle } from '@/lib/autopilot/textStyle';
import { presetStudiioParId, styleDepuisProfil } from '@/lib/creatif/presets';

const Panneau = (await import('@/components/creer/PanneauStyleAutomatique')).default;

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const RESOLVEUR = lire('src/lib/autopilot/analyse/politique-creative.ts');
const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu.ts');
const AUTOPILOTE = lire('src/components/creer/AutopilotPanel.tsx');
const MON_STYLE = lire('src/components/creer/MonStylePanel.tsx');

afterEach(() => { cleanup(); });

const politique = (p: Partial<PolitiqueCreative>): PolitiqueCreative => politiqueValide({
  ...POLITIQUE_STRICTE, ...p,
});

const varier = (autorises: Partial<Record<string, string[]>>): PolitiqueCreative => politique({
  mode: 'varier-elements',
  autorises: { ...FAVORIS_VIDES, ...autorises } as never,
});

const resoudre = (
  pol: PolitiqueCreative, graine: string, historique: ChoixCreatifs[] = [],
) => resoudreStyleEffectif(PROFIL_CREATIF_DEFAUT, pol, [], { graine, historique });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La politique', () => {
  it('1.1 trois modes qui s’excluent, pas trois interrupteurs', () => {
    expect([...MODES_CREATIFS]).toEqual([
      'marque-stricte', 'varier-elements', 'varier-presets',
    ]);
    for (const m of MODES_CREATIFS) {
      expect(LIBELLES_MODE[m].length).toBeGreaterThan(3);
      expect(DESCRIPTIONS_MODE[m].length).toBeGreaterThan(20);
    }
  });

  it('1.2 le défaut est « Marque stricte » : rien ne change pour personne', () => {
    expect(POLITIQUE_STRICTE.mode).toBe('marque-stricte');
    expect(politiqueValide(undefined)).toEqual(POLITIQUE_STRICTE);
    expect(politiqueValide({ mode: 'chaos' }).mode).toBe('marque-stricte');
    expect(politiqueVide(POLITIQUE_STRICTE)).toBe(true);
    expect(BIBLIOTHEQUE_VIDE.automatisation.mode).toBe('marque-stricte');
  });

  it('1.3 les listes autorisées sont validées comme des favoris', () => {
    const p = politiqueValide({
      mode: 'varier-elements',
      autorises: { lut: ['vibrant', 'look-mort', 'vibrant'], transition: ['fondu'] },
    });
    expect(p.autorises.lut).toEqual(['vibrant']);
    expect(p.autorises.transition).toEqual(['fondu']);
    expect(p.version).toBe(VERSION_POLITIQUE_CREATIVE);
  });

  it('1.4 elle survit à l’aller-retour de persistance', () => {
    const style = sanitizeDesignStyle({
      bibliothequeCreative: {
        automatisation: { mode: 'varier-elements', autorises: { lut: ['vibrant'] } },
      },
    });
    expect(style.bibliothequeCreative?.automatisation.mode).toBe('varier-elements');
    expect(bibliothequeValide(style.bibliothequeCreative).automatisation.autorises.lut)
      .toEqual(['vibrant']);
  });

  it('1.5 ⚠️ FAVORI N’EST PAS AUTORISÉ : ce sont deux listes', () => {
    const b = bibliothequeValide({
      favoris: { transition: ['flash'] },
      automatisation: { mode: 'varier-elements', autorises: { transition: ['fondu'] } },
    });
    expect(b.favoris.transition).toEqual(['flash']);
    expect(b.automatisation.autorises.transition).toEqual(['fondu']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Marque stricte — il ne se passe rien', () => {
  it('2.1 le profil ressort tel quel, quel que soit le créneau', () => {
    const a = resoudre(POLITIQUE_STRICTE, graineCreative('u', 'plan-1', 1, 'v'));
    const b = resoudre(POLITIQUE_STRICTE, graineCreative('u', 'plan-2', 1, 'v'));
    expect(a.profil).toBe(PROFIL_CREATIF_DEFAUT);
    expect(b.profil).toBe(PROFIL_CREATIF_DEFAUT);
    expect(a.choix).toEqual(b.choix);
    expect(a.varie).toBe(false);
  });

  it('2.2 ⚠️ la répétition n’est PAS une erreur en marque stricte', () => {
    const memes = Array.from({ length: 10 }, () => ({
      lut: 'neutral', styleTexte: 'defaut', animationBloc: 'aucune',
      animationContenu: 'aucune', transition: 'cut', caption: 'minimal-blanc',
    }));
    const r = resoudre(POLITIQUE_STRICTE, 'g', memes);
    expect(r.profil).toBe(PROFIL_CREATIF_DEFAUT);
    expect(r.raison).toContain('Marque stricte');
  });

  it('2.3 ⚠️ LA CHAÎNE NE TOUCHE À RIEN dans ce mode', () => {
    // Le graphe émis reste celui d'avant ce lot, au caractère près.
    expect(sansProse(CHAINE)).toContain("biblio.automatisation.mode !== 'marque-stricte'");
    expect(sansProse(CHAINE)).toContain('let profilEffectif = profil;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le déterminisme', () => {
  it('3.1 ⚠️ AUCUN HASARD dans le résolveur, ni dans la chaîne', () => {
    expect(sansProse(RESOLVEUR)).not.toContain('Math.random');
    expect(sansProse(RESOLVEUR)).not.toContain('Date.now');
    expect(sansProse(CHAINE)).not.toContain('Math.random');
  });

  it('3.2 ⚠️ MÊME GRAINE, MÊME HISTORIQUE → MÊMES CHOIX (le retry)', () => {
    const pol = varier({
      lut: ['vibrant', 'cinema-warm', 'noir', 'punchy'],
      transition: ['fondu', 'pixels', 'iris-noir'],
    });
    const g = graineCreative('u1', 'plan-42', 3, VERSION_POLITIQUE_CREATIVE);
    const hist = [{
      lut: 'noir', styleTexte: 'defaut', animationBloc: 'aucune',
      animationContenu: 'aucune', transition: 'fondu', caption: 'minimal-blanc',
    }];
    const a = resoudre(pol, g, hist);
    const b = resoudre(pol, g, hist);
    expect(a.choix).toEqual(b.choix);
    expect(a.raison).toBe(b.raison);
  });

  it('3.3 la graine ne dépend que de données stables', () => {
    expect(graineCreative('u', 'p', 2, 'v')).toBe('u|p|2|v');
    expect(graineCreative('u', 'p', 2, 'v')).not.toBe(graineCreative('u', 'p', 3, 'v'));
    // Le hachage est stable d'une exécution à l'autre.
    expect(graineHachee('studiio')).toBe(graineHachee('studiio'));
    expect(graineHachee('a')).not.toBe(graineHachee('b'));
  });

  it('3.4 ⚠️ un plan DIFFÉRENT peut donner une combinaison différente', () => {
    const pol = varier({
      lut: ['vibrant', 'cinema-warm', 'noir', 'punchy', 'pop', 'moody'],
      transition: ['fondu', 'pixels', 'iris-noir', 'lamelles'],
      styleTexte: ['defaut', 'bold-social', 'elegant'],
    });
    const vues = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      vues.add(signatureCreative(
        resoudre(pol, graineCreative('u', `plan-${i}`, 1, 'v')).choix,
      ));
    }
    // ⚠️ PAS « TOUTES DIFFÉRENTES » : avec un nombre fini d'options, deux
    // plans peuvent légitimement tomber pareil. Ce qui est inacceptable,
    // c'est dix fois la MÊME.
    expect(vues.size).toBeGreaterThan(3);
  });

  it('3.5 ⚠️ dix cycles ne produisent pas dix fois la même signature', () => {
    const pol = varier({
      lut: ['vibrant', 'cinema-warm', 'noir', 'punchy'],
      transition: ['fondu', 'pixels', 'iris-noir', 'lamelles'],
    });
    const historique: ChoixCreatifs[] = [];
    const vues = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const r = resoudre(pol, graineCreative('u', `plan-${i}`, 1, 'v'), [...historique]);
      historique.unshift(r.choix);
      vues.add(signatureCreative(r.choix));
    }
    expect(vues.size).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Ce qui est autorisé, et rien d’autre', () => {
  it('4.1 ⚠️ un effet hors liste n’est JAMAIS choisi', () => {
    const pol = varier({ lut: ['vibrant', 'noir'] });
    for (let i = 0; i < 40; i += 1) {
      const r = resoudre(pol, graineCreative('u', `p${i}`, 1, 'v'));
      expect(['vibrant', 'noir']).toContain(r.choix.lut);
    }
  });

  it('4.2 une seule option autorisée : toujours celle-là', () => {
    const pol = varier({ transition: ['iris-noir'] });
    for (let i = 0; i < 10; i += 1) {
      expect(resoudre(pol, `g${i}`).choix.transition).toBe('iris-noir');
    }
  });

  it('4.3 ⚠️ une liste VIDE ne bloque pas : le choix actif est conservé', () => {
    const courant = styleDepuisProfil(PROFIL_CREATIF_DEFAUT);
    const pol = varier({ lut: ['vibrant', 'noir'] });
    const r = resoudre(pol, 'g');
    expect(r.choix.transition).toBe(courant.transitionId);
    expect(r.choix.styleTexte).toBe(courant.styleTexteId);
  });

  it('4.4 ⚠️ L’ANTI-RÉPÉTITION NE FORCE JAMAIS UN EFFET NON AUTORISÉ', () => {
    const pol = varier({ lut: ['vibrant'] });
    const hist = Array.from({ length: 10 }, () => ({
      lut: 'vibrant', styleTexte: 'defaut', animationBloc: 'aucune',
      animationContenu: 'aucune', transition: 'cut', caption: 'minimal-blanc',
    }));
    const r = resoudre(pol, 'g', hist);
    expect(r.choix.lut).toBe('vibrant');
    // Et on le DIT plutôt que de tricher.
    expect(r.raison).toContain('déjà servi');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. L’anti-répétition', () => {
  it('5.1 ⚠️ la combinaison exacte des dernières vidéos est évitée', () => {
    const pol = varier({
      lut: ['vibrant', 'cinema-warm', 'noir'],
      transition: ['fondu', 'pixels', 'iris-noir'],
    });
    const g = graineCreative('u', 'plan-7', 1, 'v');
    const sansHistorique = resoudre(pol, g).choix;
    const avecHistorique = resoudre(pol, g, [sansHistorique]).choix;
    expect(signatureCreative(avecHistorique)).not.toBe(signatureCreative(sansHistorique));
  });

  it('5.2 ⚠️ un effet très récent coûte plus cher qu’un effet ancien', () => {
    // La même transition sur toutes les vidéos, même en variant les looks :
    // c'est exactement ce que la pénalité empêche.
    const pol = varier({ transition: ['fondu', 'pixels'] });
    const g = graineCreative('u', 'plan-9', 1, 'v');
    const seul = resoudre(pol, g).choix.transition;
    const apres = resoudre(pol, g, [{
      lut: 'neutral', styleTexte: 'defaut', animationBloc: 'aucune',
      animationContenu: 'aucune', transition: seul, caption: 'minimal-blanc',
    }]).choix.transition;
    expect(apres).not.toBe(seul);
    expect(PENALITE_RECENCE).toBeGreaterThan(0);
    expect(HISTORIQUE_MAX).toBeGreaterThanOrEqual(10);
  });

  it('5.3 la recherche d’une combinaison neuve est bornée', () => {
    expect(VARIANTES_MAX).toBeGreaterThanOrEqual(4);
    expect(VARIANTES_MAX).toBeLessThanOrEqual(20);
    expect(sansProse(RESOLVEUR)).toContain('variante < VARIANTES_MAX');
  });

  it('5.4 l’historique se lit dans `usage.creatif`, pas dans une liste à part', () => {
    const h = historiqueDepuisUsages([
      { creatif: { lutId: 'vibrant', transitionId: 'fondu' } },
      {},
      { creatif: { lutId: 'noir' } },
    ]);
    expect(h.length).toBe(2);
    expect(h[0].lut).toBe('vibrant');
    expect(h[1].lut).toBe('noir');
    expect(h[1].transition).toBe('');
  });

  it('5.5 ⚠️ la requête d’historique est BORNÉE et filtrée par compte', () => {
    const s = sansProse(lire('src/lib/autopilot/analyse/rendu-service.ts'));
    expect(s).toContain(".eq('user_id', userId)");
    expect(s).toContain('.limit(');
    expect(sansProse(CHAINE)).toContain('historiqueDepuisUsages(await listerCreatifsRecents(userId))');
  });

  it('5.6 sans historique lisible, on choisit quand même', () => {
    expect(sansProse(CHAINE)).toMatch(/try \{[\s\S]{0,220}listerCreatifsRecents[\s\S]{0,120}\} catch/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Varier parmi mes presets', () => {
  it('6.1 il ne choisit que parmi les presets autorisés', () => {
    const pol = politique({
      mode: 'varier-presets',
      presetsAutorises: ['fitness-energie', 'luxe'],
    });
    const attendus = ['fitness-energie', 'luxe']
      .map((id) => presetStudiioParId(id)!.style.lutId);
    for (let i = 0; i < 12; i += 1) {
      expect(attendus).toContain(resoudre(pol, `g${i}`).choix.lut);
    }
  });

  it('6.2 aucun preset autorisé : le style du compte est conservé', () => {
    const pol = politique({ mode: 'varier-presets', presetsAutorises: [] });
    const r = resoudre(pol, 'g');
    expect(r.profil).toBe(PROFIL_CREATIF_DEFAUT);
    expect(r.varie).toBe(false);
    expect(r.raison).toContain('Aucun preset');
  });

  it('6.3 un preset supprimé depuis ne fait pas tomber la production', () => {
    const pol = politique({
      mode: 'varier-presets', presetsAutorises: ['preset-efface', 'luxe'],
    });
    expect(resoudre(pol, 'g').choix.lut).toBe(presetStudiioParId('luxe')!.style.lutId);
  });

  it('6.4 ⚠️ un preset appliqué NE TOUCHE PAS à la marque', () => {
    const marque = normaliserProfilCreatif({
      couleurs: { primaire: '#112233', accent: '#445566', texte: '#FFFFFF' },
    } as never);
    const pol = politique({ mode: 'varier-presets', presetsAutorises: ['promo-choc'] });
    const r = resoudreStyleEffectif(marque, pol, [], { graine: 'g', historique: [] });
    expect(r.profil.couleurs).toEqual(marque.couleurs);
    expect(r.profil.ctaVisuel).toEqual(marque.ctaVisuel);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’identité et la trace', () => {
  it('7.1 ⚠️ deux choix effectifs différents = deux identités de rendu', () => {
    const pol = varier({ lut: ['vibrant', 'noir', 'punchy'] });
    const a = resoudre(pol, graineCreative('u', 'p-1', 1, 'v'));
    const b = resoudre(pol, graineCreative('u', 'p-2', 1, 'v'));
    if (a.choix.lut !== b.choix.lut) {
      expect(profilCreatifCanonique(a.profil)).not.toBe(profilCreatifCanonique(b.profil));
      expect(methodeRendu(RECETTE_AUDIO_DEFAUT, a.profil, null))
        .not.toBe(methodeRendu(RECETTE_AUDIO_DEFAUT, b.profil, null));
    }
    // Et le même choix rend la même identité — c'est ce qui permet le retry.
    expect(profilCreatifCanonique(a.profil))
      .toBe(profilCreatifCanonique(resoudre(pol, graineCreative('u', 'p-1', 1, 'v')).profil));
  });

  it('7.2 ⚠️ la chaîne passe les choix EFFECTIFS, pas la liste autorisée', () => {
    const c = sansProse(CHAINE);
    expect(c).toContain('methodeRendu(d.recette, profilEffectif, appelAction)');
    expect(c).toContain('profil: profilEffectif');
  });

  it('7.3 les choix effectifs et la version de politique sont persistés', () => {
    const m = sansProse(MOTEUR);
    expect(m).toContain('usage.creatif = {');
    expect(m).toContain('politiqueVersion: demande.variation.politiqueVersion');
    expect(m).toContain('raison: demande.variation.raison');
    expect(sansProse(CHAINE)).toContain('politiqueVersion: biblio.automatisation.version');
  });

  it('7.4 la raison est en français, courte, et sans identifiant de compte', () => {
    const r = resoudre(varier({ lut: ['vibrant', 'noir'] }), graineCreative('u-secret', 'p', 1, 'v'));
    expect(r.raison.length).toBeLessThan(160);
    expect(r.raison).not.toContain('u-secret');
    expect(r.raison).toMatch(/Choisi parmi/);
  });

  it('7.5 ⚠️ la graine n’est ni journalisée ni persistée', () => {
    expect(sansProse(RESOLVEUR)).not.toMatch(/console\.(log|error|warn)/);
    expect(sansProse(CHAINE)).not.toMatch(/usage[^\n]*graine|console[^\n]*graine/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Manuel contre automatique', () => {
  it('8.1 ⚠️ LE CHEMIN MANUEL NE VARIE RIEN', () => {
    const manuel = sansProse(lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts'));
    expect(manuel).not.toContain('resoudreStyleEffectif');
    expect(manuel).toContain('methodeRendu(recette, profil, appelAction)');
  });

  it('8.2 seul le chemin automatique résout la politique', () => {
    expect(sansProse(CHAINE)).toContain('resoudreStyleEffectif(');
  });

  it('8.3 le résolveur est PUR : ni base, ni disque, ni horloge', () => {
    expect(sansProse(RESOLVEUR)).not.toMatch(/supabase|node:fs|fetch\(|new Date\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. L’écran', () => {
  const monter = (pol = POLITIQUE_STRICTE, extra = {}) => {
    const recus: PolitiqueCreative[] = [];
    const vue = render(
      <Panneau
        politique={pol}
        favoris={FAVORIS_VIDES}
        presetsPersonnels={[]}
        onChanger={(p) => recus.push(p)}
        {...extra}
      />,
    );
    return { ...vue, recus };
  };

  it('9.1 les trois modes sont proposés, en français', () => {
    const { container } = monter();
    for (const m of MODES_CREATIFS) {
      const b = container.querySelector(`[data-mode-creatif="${m}"]`);
      expect(b).not.toBeNull();
      expect(b!.textContent).toContain(LIBELLES_MODE[m]);
    }
    expect(container.textContent).toContain('Studiio conserve toujours');
  });

  it('9.2 en marque stricte, aucune liste n’encombre l’écran', () => {
    const { container } = monter();
    expect(container.querySelector('[data-autorises]')).toBeNull();
    expect(container.querySelector('[data-presets-autorises]')).toBeNull();
  });

  it('9.3 changer de mode remonte la politique entière', () => {
    const { container, recus } = monter();
    fireEvent.click(container.querySelector('[data-mode-creatif="varier-elements"]') as HTMLElement);
    expect(recus[0].mode).toBe('varier-elements');
  });

  it('9.4 en « Varier mon style », les cinq familles VARIABLES sont réglables', () => {
    const { container } = monter(politique({ mode: 'varier-elements' }));
    expect(container.querySelector('[data-autorises]')).not.toBeNull();
    for (const f of FAMILLES_BIBLIOTHEQUE) {
      const present = container.querySelector(`[data-autorise^="${f}:"]`);
      /* ⚠️ LES SOUS-TITRES NE SONT PAS PROPOSES : c'est un reglage de
         lisibilite, pas d'ambiance. La famille existe pour les favoris et la
         recherche ; la variation la reconduit sans la choisir. */
      if (f === 'caption') expect(present).toBeNull();
      else expect(present, f).not.toBeNull();
    }
  });

  it('9.5 cocher un effet l’ajoute à la liste autorisée', () => {
    const { container, recus } = monter(politique({ mode: 'varier-elements' }));
    fireEvent.click(container.querySelector('[data-autorise="transition:fondu"]') as HTMLElement);
    expect(recus[0].autorises.transition).toEqual(['fondu']);
  });

  it('9.6 ⚠️ « Utiliser mes favoris » COPIE la liste, il ne la lie pas', () => {
    const { container, recus } = monter(
      politique({ mode: 'varier-elements' }),
      { favoris: { ...FAVORIS_VIDES, lut: ['vibrant', 'noir'] } },
    );
    const bouton = container.querySelector('[data-utiliser-favoris="lut"]') as HTMLElement;
    expect(bouton.textContent).toContain('2 favoris');
    fireEvent.click(bouton);
    expect(recus[0].autorises.lut).toEqual(['vibrant', 'noir']);
    // Aucun bouton là où il n'y a pas de favori : rien à copier.
    expect(container.querySelector('[data-utiliser-favoris="transition"]')).toBeNull();
  });

  it('9.7 une famille sans case cochée le dit, au lieu de laisser deviner', () => {
    const { container } = monter(politique({ mode: 'varier-elements' }));
    expect(container.textContent).toContain('ne varie pas');
    expect(container.textContent).toContain('garde ton choix actuel');
  });

  it('9.8 en « Varier parmi mes presets », les douze Studiio et les miens', () => {
    const { container, recus } = monter(
      politique({ mode: 'varier-presets' }),
      {
        presetsPersonnels: [{
          id: 'mien', nom: 'Afroboost Energy',
          style: presetStudiioParId('luxe')!.style,
        }],
      },
    );
    expect(container.querySelector('[data-preset-autorise="fitness-energie"]')).not.toBeNull();
    expect(container.querySelector('[data-preset-autorise="mien"]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-preset-autorise="luxe"]') as HTMLElement);
    expect(recus[0].presetsAutorises).toEqual(['luxe']);
  });

  it('9.9 ⚠️ IL VIT DANS L’AUTOMATISATION, pas avant « Créer ma vidéo »', () => {
    expect(AUTOPILOTE).toContain('data-autonome-style');
    expect(AUTOPILOTE).toContain('PanneauStyleAutomatique');
    // Et « Mon style » ne le porte pas : c'est le chemin manuel.
    expect(MON_STYLE).not.toContain('PanneauStyleAutomatique');
  });
});
