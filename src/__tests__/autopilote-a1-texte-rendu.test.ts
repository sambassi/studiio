/**
 * A_1 — LE TEXTE ARRIVE ENFIN DANS LE RENDU.
 *
 * ---------------------------------------------------------------------------
 * CE QUI EXISTAIT, ET NE SERVAIT À RIEN
 * ---------------------------------------------------------------------------
 *
 * Le profil créatif validait et persistait `texte.titre`, `texte.sousTitre`,
 * `texte.libre`, leur position et leur durée — consommés par PERSONNE. Le CTA
 * était un bandeau coloré sans un mot dedans ; l'écran l'appelait « Bandeau de
 * fin » et prévenait que « le texte arrivera plus tard ». C'étaient des
 * réglages qui ne réglaient rien.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : qu'aucune valeur saisie ne
 * devienne de la syntaxe ffmpeg. Dans un graphe de filtres, `:` sépare les
 * options, `,` et `;` séparent les filtres, `'` délimite, `\` échappe, et
 * `%{…}` est un langage d'expansion. « Réserve : 50% de remise, c'est
 * aujourd'hui ! » casserait le graphe — ou pire, en changerait le sens sans
 * rien casser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  POLICES_RENDU, NATURES_TEXTE, LONGUEURS_MAX, couleurValide, texteRetenu,
  positionY, filtreDrawtext, policeDe, preparerCouches, empreinteCouches,
  type SourcesTexte,
} from '@/lib/autopilot/analyse/rendu-texte';
import { fichierPolice } from '@/lib/autopilot/analyse/rendu-polices';
import { methodeRendu } from '@/lib/autopilot/analyse/rendu-contrat';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const TEXTE = lire('src/lib/autopilot/analyse/rendu-texte.ts');
const POLICES = lire('src/lib/autopilot/analyse/rendu-polices.ts');
const STYLE = lire('src/lib/autopilot/analyse/rendu-style.ts');
const RENDU = lire('src/lib/autopilot/analyse/rendu.ts');

const profilBase = (): NonNullable<SourcesTexte['profil']> => ({
  typographie: { policeTitreId: 'anton', policeTexteId: 'poppins', graisse: 'grasse' },
  couleurs: { primaire: '#7c3aed', accent: '#ec4899', texte: '#ffffff' },
  texte: {
    actif: true, titre: 'Bouge. Danse. Transpire.', sousTitre: null, libre: null,
    position: 'bas', debutSecondes: 0, dureeSecondes: 3,
  },
  ctaVisuel: { actif: false, dureeSecondes: 3, position: 'bas' },
});

const sources = (o: Partial<SourcesTexte> = {}): SourcesTexte => ({
  profil: profilBase(),
  appelAction: null,
  dureeTotaleSecondes: 30,
  ...o,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Aucune valeur saisie n’entre dans le graphe', () => {
  it('1.1 le texte part dans un FICHIER, jamais dans `text=`', () => {
    /* ⚠️ LE CHOIX QUI FERME TOUTE LA QUESTION DE L'ÉCHAPPEMENT. `textfile=`
       lit des octets ; `text=` lit de la syntaxe. On n'échappe donc rien —
       il n'y a rien à échapper. */
    const f = filtreDrawtext({
      fichierTexte: '/tmp/rendu/texte-0.txt',
      fichierPolice: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      taillePx: 64, couleur: '#ffffff', y: 100,
      debutSecondes: 0, finSecondes: 3,
    });
    expect(f).toContain("textfile='/tmp/rendu/texte-0.txt'");
    expect(f).not.toMatch(/(^|:)text=/);
    expect(f).toContain('drawtext=textfile=');
  });

  it('1.2 l’expansion `%{…}` est coupée', () => {
    // Sans cela, un CTA contenant « 50% » ferait interpréter la suite comme
    // une expression — et `%{pts}` afficherait un horodatage à la place.
    expect(filtreDrawtext({
      fichierTexte: '/tmp/t.txt', fichierPolice: '/f.ttf', taillePx: 40,
      couleur: '#ffffff', y: 0, debutSecondes: 0, finSecondes: 1,
    })).toContain('expansion=none');
  });

  it('1.3 les textes tordus traversent la préparation sans dommage', () => {
    const tordus = [
      "Réserve : 50% de remise, c'est aujourd'hui !",
      'Chemin C:\\Users\\test',
      'Crochets [1] et point-virgule ; fin',
      '« Guillemets » et — tirets',
      'Ünïcödé àéîôù ç',
    ];
    for (const t of tordus) {
      const c = preparerCouches(sources({
        profil: { ...profilBase(), texte: { ...profilBase().texte, titre: t } },
      }));
      expect(c[0]?.texte, t).toBe(t.slice(0, LONGUEURS_MAX.hook));
    }
  });

  it('1.4 le module n’émet aucun `text=` nulle part', () => {
    // ⚠️ LA FRONTIÈRE COMPTE : `drawtext=` CONTIENT « text= ». Un motif naïf
    // échouait sur le filtre lui-même, c'est-à-dire sur la bonne réponse.
    expect(sansProse(TEXTE)).not.toMatch(/(?<![a-z])text=/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les polices sont un catalogue, jamais un chemin', () => {
  it('2.1 trois familles, celles que l’image installe', () => {
    expect(POLICES_RENDU).toEqual(['sans', 'serif', 'mono']);
    expect(lire('Dockerfile')).toContain('fonts-liberation');
  });

  it('2.2 un identifiant inconnu retombe sur `sans`, sans erreur', () => {
    /* ⚠️ ON NE FABRIQUE PAS UN CHEMIN À PARTIR D'UN NOM. Le catalogue de
       l'écran compte 52 familles que le serveur ne porte pas ; deviner
       `/usr/share/fonts/…/Anton.ttf` donnerait un rendu en échec, ou pire un
       chemin arbitraire lu sur le serveur. */
    expect(policeDe('anton')).toBe('sans');
    expect(policeDe(null)).toBe('sans');
    expect(policeDe('../../etc/passwd')).toBe('sans');
  });

  it('2.3 les familles connues sont rangées', () => {
    expect(policeDe('space-grotesk')).toBe('mono');
    expect(policeDe('playfair-serif')).toBe('serif');
  });

  it('2.4 aucun chemin de police ne vient d’un réglage', () => {
    const code = sansProse(TEXTE);
    // Les seuls chemins sont ceux de la constante `RACINE_LIBERATION`, et
    // ils vivent dans le module SERVEUR.
    expect(sansProse(POLICES)).toContain('const RACINE_LIBERATION =');
    expect((sansProse(POLICES).match(/\/usr\/share\/fonts/g) ?? []).length).toBe(1);
    expect(code).not.toContain('/usr/share/fonts');
    expect(typeof fichierPolice).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Ce qui est rendu, et ce qui ne l’est pas', () => {
  it('3.1 hook actif → une couche', () => {
    const c = preparerCouches(sources());
    expect(c.map((x) => x.nature)).toEqual(['hook']);
    expect(c[0].texte).toBe('Bouge. Danse. Transpire.');
  });

  it('3.2 hook inactif → aucune couche', () => {
    expect(preparerCouches(sources({
      profil: { ...profilBase(), texte: { ...profilBase().texte, actif: false } },
    }))).toEqual([]);
  });

  it('3.3 CTA actif AVEC texte → bandeau qui parle', () => {
    const c = preparerCouches(sources({
      profil: { ...profilBase(), ctaVisuel: { actif: true, dureeSecondes: 4, position: 'bas' } },
      appelAction: { texte: 'Réserve ton cours d’essai', destination: null },
    }));
    expect(c.map((x) => x.nature)).toContain('cta');
    const cta = c.find((x) => x.nature === 'cta')!;
    expect(cta.finSecondes).toBe(30);
    expect(cta.debutSecondes).toBe(26);
  });

  it('3.4 CTA inactif → aucun texte de CTA', () => {
    const c = preparerCouches(sources({
      appelAction: { texte: 'Réserve', destination: 'afroboost.com' },
    }));
    expect(c.some((x) => x.nature === 'cta' || x.nature === 'lien')).toBe(false);
  });

  it('3.5 ⚠️ AUCUN CTA INVENTÉ quand l’objectif est muet', () => {
    // Ce lot RESTITUE ce que la personne a écrit ; il n'écrit pas à sa place.
    const c = preparerCouches(sources({
      profil: { ...profilBase(), ctaVisuel: { actif: true, dureeSecondes: 4, position: 'bas' } },
      appelAction: { texte: null, destination: null },
    }));
    expect(c.some((x) => x.nature === 'cta')).toBe(false);
  });

  it('3.6 lien présent → visible ; absent → aucune ligne vide', () => {
    const avec = preparerCouches(sources({
      profil: { ...profilBase(), ctaVisuel: { actif: true, dureeSecondes: 4, position: 'bas' } },
      appelAction: { texte: 'Réserve', destination: 'afroboost.com' },
    }));
    expect(avec.some((x) => x.nature === 'lien')).toBe(true);
    const sans = preparerCouches(sources({
      profil: { ...profilBase(), ctaVisuel: { actif: true, dureeSecondes: 4, position: 'bas' } },
      appelAction: { texte: 'Réserve', destination: '   ' },
    }));
    expect(sans.some((x) => x.nature === 'lien')).toBe(false);
  });

  it('3.7 le texte de fin ne s’affiche QUE sur les dernières secondes', () => {
    const c = preparerCouches(sources({
      profil: {
        ...profilBase(),
        texte: { ...profilBase().texte, libre: 'Places limitées', dureeSecondes: 3 },
      },
    }));
    const fin = c.find((x) => x.nature === 'fin')!;
    expect(fin.debutSecondes).toBe(27);
    expect(fin.finSecondes).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Bornes et validation', () => {
  it('4.1 un texte trop long est tronqué, pas refusé', () => {
    // Refuser le rendu entier pour deux mots de trop serait disproportionné ;
    // laisser 2 000 caractères couvrir l'image perdrait la vidéo.
    const long = 'a'.repeat(500);
    expect(texteRetenu(long, 'hook')).toHaveLength(LONGUEURS_MAX.hook);
  });

  it('4.2 un texte vide ou blanc n’est pas un texte', () => {
    for (const v of ['', '   ', '\n\t ', null, undefined, 42, {}]) {
      expect(texteRetenu(v, 'cta'), String(v)).toBeNull();
    }
  });

  it('4.3 les caractères de contrôle sont retirés', () => {
    const avecControle = `Hook${String.fromCharCode(7)}suite`;
    expect(texteRetenu(avecControle, 'hook')).toBe('Hooksuite');
  });

  it('4.4 une couleur invalide retombe sur une valeur sûre', () => {
    expect(couleurValide('#ffffff')).toBe(true);
    for (const v of ['red', '#fff', 'rgb(1,2,3)', '', null, '#gggggg']) {
      expect(couleurValide(v), String(v)).toBe(false);
    }
    const c = preparerCouches(sources({
      profil: {
        ...profilBase(),
        couleurs: { primaire: 'red', accent: null, texte: 'not-a-color' },
      },
    }));
    expect(c[0].couleur).toBe('#ffffff');
  });

  it('4.5 une durée aberrante est bornée par la durée du montage', () => {
    const c = preparerCouches(sources({
      profil: {
        ...profilBase(),
        texte: { ...profilBase().texte, debutSecondes: 999, dureeSecondes: 999 },
      },
    }));
    expect(c[0].debutSecondes).toBeLessThanOrEqual(30);
    expect(c[0].finSecondes).toBeLessThanOrEqual(30);
  });

  it('4.6 un montage de durée nulle ne dessine rien', () => {
    expect(preparerCouches(sources({ dureeTotaleSecondes: 0 }))).toEqual([]);
  });

  it('4.7 le vocabulaire est fermé', () => {
    expect(NATURES_TEXTE).toEqual(['hook', 'titre', 'cta', 'lien', 'fin']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Marges sûres et formats', () => {
  const marges = { haut: 100, bas: 120 };

  it('5.1 9:16 — le texte reste dans les marges', () => {
    for (const ancre of ['haut', 'centre', 'bas'] as const) {
      const y = positionY(ancre, 1920, 80, marges);
      expect(y, ancre).toBeGreaterThanOrEqual(marges.haut);
      expect(y + 80, ancre).toBeLessThanOrEqual(1920 - marges.bas);
    }
  });

  it('5.2 16:9 — la même ancre tient sur un cadre bas', () => {
    for (const ancre of ['haut', 'centre', 'bas'] as const) {
      const y = positionY(ancre, 1080, 60, marges);
      expect(y, ancre).toBeGreaterThanOrEqual(marges.haut);
      expect(y + 60, ancre).toBeLessThanOrEqual(1080 - marges.bas);
    }
  });

  it('5.3 1:1 — idem', () => {
    for (const ancre of ['haut', 'centre', 'bas'] as const) {
      const y = positionY(ancre, 1080, 60, marges);
      expect(y, ancre).toBeGreaterThanOrEqual(marges.haut);
    }
  });

  it('5.4 un cadre trop petit ne pousse jamais le texte hors image', () => {
    // ⚠️ LE CAS QUI SORT DU CADRE : marges plus grandes que la place. On ne
    // dessine pas au-dessus du bord haut, quoi qu'il arrive.
    const y = positionY('bas', 200, 80, { haut: 100, bas: 100 });
    expect(y).toBeGreaterThanOrEqual(100);
  });

  it('5.5 la taille est en POURCENTAGE de la hauteur, pas en pixels fixes', () => {
    /* Des pixels pensés pour 1080×1920 donneraient un hook minuscule en
       16:9 — la même valeur doit tenir dans les trois formats. */
    const c = preparerCouches(sources());
    expect(c[0].taillePct).toBeGreaterThan(0);
    expect(c[0].taillePct).toBeLessThan(20);
    expect(RENDU).toContain('(hauteur * c.taillePct) / 100');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. L’identité du rendu suit le texte', () => {
  const recette = null;
  const profilAvecTexte = {
    texte: { actif: true, titre: 'Bouge', sousTitre: null, libre: null,
      position: 'bas' as const, debutSecondes: 0, dureeSecondes: 3 },
  };

  it('6.1 changer le message du CTA change l’identité', () => {
    /* ⚠️ LE MESSAGE VIENT DE L'OBJECTIF, donc ne passe ni par le profil ni
       par la recette. Sans lui dans l'empreinte, « Réserve ta place » →
       « Derniers jours » resservirait la vidéo d'hier, avec l'ancien texte,
       sans qu'aucune erreur ne le dise. */
    const a = methodeRendu(recette, profilAvecTexte, { texte: 'Réserve ta place', destination: null });
    const b = methodeRendu(recette, profilAvecTexte, { texte: 'Derniers jours', destination: null });
    expect(a).not.toBe(b);
  });

  it('6.2 changer le lien change l’identité', () => {
    const a = methodeRendu(recette, profilAvecTexte, { texte: 'Réserve', destination: 'a.com' });
    const b = methodeRendu(recette, profilAvecTexte, { texte: 'Réserve', destination: 'b.com' });
    expect(a).not.toBe(b);
  });

  it('6.3 changer un texte du profil change l’identité', () => {
    const a = methodeRendu(recette, profilAvecTexte);
    const b = methodeRendu(recette, {
      texte: { ...profilAvecTexte.texte, titre: 'Danse' },
    });
    expect(a).not.toBe(b);
  });

  it('6.4 un CTA écrit sur un profil vide ne retombe PAS sur l’identité historique', () => {
    // Un compte sans style mais avec un objectif produit désormais une vidéo
    // AVEC du texte : la rendre sous l'identité historique resservirait un
    // montage muet.
    const historique = methodeRendu(null, null);
    const avecCta = methodeRendu(null, null, { texte: 'Réserve', destination: null });
    expect(avecCta).not.toBe(historique);
  });

  it('6.5 sans appel à l’action, l’empreinte d’hier est inchangée', () => {
    /* ⚠️ LA RÉTRO-COMPATIBILITÉ, MESURÉE. Les rendus produits avant ce lot
       doivent rester réutilisables : leur identité ne doit pas bouger. */
    expect(methodeRendu(recette, profilAvecTexte))
      .toBe(methodeRendu(recette, profilAvecTexte, null));
  });

  it('6.6 l’empreinte des couches distingue deux mises en page', () => {
    const a = empreinteCouches(preparerCouches(sources()));
    const b = empreinteCouches(preparerCouches(sources({
      profil: { ...profilBase(), texte: { ...profilBase().texte, position: 'haut' } },
    })));
    expect(a).not.toBe(b);
    expect(empreinteCouches([])).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Manuel et automatique partagent le même texte', () => {
  it('7.1 les deux chemins lisent le même profil et le même objectif', () => {
    const auto = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
    const manuel = lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');
    for (const src of [auto, manuel]) {
      expect(src).toContain('lireProfilCreatifUtilisateur');
      expect(src).toContain('appelAction');
    }
    expect(auto).toContain('objectif.appelAction');
    expect(manuel).toContain('objectifEffectifUtilisateur(userId)');
  });

  it('7.2 les deux passent le message dans l’identité', () => {
    const auto = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
    const manuel = lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');
    /* ⚠️ A_3e3 : LE CHEMIN AUTOMATIQUE PASSE LE PROFIL *EFFECTIF*, celui
       dont les choix variables ont ete resolus. Le message du CTA, lui, y est
       toujours — c'est ce que ce test tient. Passer la POLITIQUE au lieu des
       choix ferait deux videos aux looks differents sous la meme identite. */
    expect(auto).toContain('methodeRendu(d.recette, profilEffectif, appelAction)');
    expect(auto).toContain('profil: profilEffectif');
    expect(manuel).toContain('methodeRendu(recette, profil, appelAction)');
  });

  it('7.3 une seule préparation de couches dans tout le dépôt', () => {
    // Deux préparations divergeraient : le manuel afficherait un texte que
    // l'automatique ne connaîtrait pas.
    expect((RENDU.match(/preparerCouches\(/g) ?? []).length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Dégradation honnête', () => {
  it('8.0 aucun `node:fs` dans le module que le navigateur atteint', () => {
    /* ⚠️ MESURÉ, PAS SUPPOSÉ. `rendu-style` importe `rendu-texte`, et
       `rendu-style` est atteint de proche en proche par `AutopilotPanel` et
       `AssistantWizard` — deux composants CLIENT. Une seule arête vers
       `node:fs` a fait échouer le build entier de ce lot :
       « UnhandledSchemeError: Reading from "node:fs" ». */
    // Le module EXPLIQUE la règle en commentaire : c'est le CODE qu'on lit.
    expect(sansProse(TEXTE)).not.toContain('node:fs');
    expect(sansProse(POLICES)).toContain("from 'node:fs'");
    expect(lire('src/lib/autopilot/analyse/rendu-style.ts'))
      .not.toContain('rendu-polices');
  });

  it('8.1 sans police sur la machine, la couche est sautée et TRACÉE', () => {
    /* ⚠️ PAS D'ÉCHEC DE RENDU POUR UNE POLICE MANQUANTE. Un poste de
       développement sans `fonts-liberation` doit pouvoir produire un montage.
       Mais le silence serait pire : `usage.textesNonRendus` dit ce qui
       manque, exactement comme `usage.transitionsNonRendues` le fait déjà. */
    expect(RENDU).toContain('textesNonRendus');
    expect(RENDU).toContain('usage.textesNonRendus = textesNonRendus');
  });

  it('8.2 le texte est dessiné APRÈS le bandeau et le logo', () => {
    // Un CTA dont le texte passerait sous son propre fond serait invisible.
    const cta = STYLE.indexOf('drawbox=x=');
    const texte = STYLE.indexOf('filtreDrawtext({');
    expect(cta).toBeGreaterThan(-1);
    expect(texte).toBeGreaterThan(cta);
  });

  it('8.3 l’en-tête qui interdisait `drawtext` explique ce qui a changé', () => {
    /* Le fichier disait « AUCUN TEXTE, AUCUNE POLICE » faute de licence. La
       raison était juste ; la contredire en silence aurait laissé un
       commentaire faux au-dessus du code qu'il décrit. */
    expect(STYLE).toContain("CE N'EST PLUS CE QUI SE PASSE");
    expect(STYLE).toContain('Liberation');
  });
});
