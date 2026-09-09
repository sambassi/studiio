/**
 * A_0 — LA PASSERELLE ENTRE LES DEUX AUTOPILOTES.
 *
 * ---------------------------------------------------------------------------
 * LE FAIT QUE CE LOT CORRIGE
 * ---------------------------------------------------------------------------
 *
 * Studiio avait DEUX chaînes de création qui ne se parlaient pas : le cron
 * « template » (Remotion, un rush, quatre séquences) et la chaîne M3 (analyse
 * → candidats → coupes → clips → plan → FFmpeg), qui porte toute
 * l'intelligence éditoriale et ne partait qu'à la main. Deux moteurs, deux
 * qualités, pour le même produit.
 *
 * ⚠️ CE QUE CES TESTS TIENNENT EN PRIORITÉ : que le défaut par défaut soit
 * l'ANCIEN comportement. Une passerelle qui changerait la production de tous
 * les comptes le jour de sa livraison ne serait pas une passerelle, ce serait
 * une bascule — et personne n'aurait pu comparer les deux moteurs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MOTEURS_AUTOPILOTE, MOTEUR_DEFAUT, moteurDepuisConfig,
  REPLIS, REPLI_DEFAUT, repliDepuisConfig, MOTIFS_M3,
} from '@/lib/autopilot/automatique/contrat';

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

/**
 * Le fichier SANS sa prose.
 *
 * ⚠️ INDISPENSABLE ICI, ET PAS UN CONFORT. Ces modules EXPLIQUENT en
 * commentaire ce qu'ils refusent de faire — « le client utilise
 * `credentials: same-origin` », « `rush_urls` reste au gabarit ». Chercher
 * ces chaînes dans le fichier entier fait échouer un test sur la phrase qui
 * documente précisément le comportement qu'il vérifie.
 */
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const CRON = lire('src/app/api/cron/autopilot/route.ts');
const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
const BANQUE = lire('src/lib/autopilot/automatique/rush-banque.ts');

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le défaut est l’ancien comportement', () => {
  it('1.1 sans choix, le moteur reste le gabarit historique', () => {
    expect(MOTEUR_DEFAUT).toBe('legacy_template');
    expect(moteurDepuisConfig(undefined)).toBe('legacy_template');
    expect(moteurDepuisConfig(null)).toBe('legacy_template');
    expect(moteurDepuisConfig({})).toBe('legacy_template');
  });

  it('1.2 une valeur inconnue ne devient pas un moteur', () => {
    // ⚠️ LA VALEUR VIENT D'UN JSONB. Elle a pu être écrite par une version
    // antérieure, une main, un import. Elle n'est jamais crue sur parole.
    for (const brut of [{ moteur: 'M3' }, { moteur: 'gpt' }, { moteur: 42 },
      { moteur: null }, { moteur: ['m3'] }]) {
      expect(moteurDepuisConfig(brut), JSON.stringify(brut)).toBe('legacy_template');
    }
  });

  it('1.3 le moteur M3 ne s’active que sur une valeur exacte', () => {
    expect(moteurDepuisConfig({ moteur: 'm3' })).toBe('m3');
    expect(MOTEURS_AUTOPILOTE).toEqual(['legacy_template', 'm3']);
  });

  it('1.4 aucune migration : le choix vit dans le jsonb déjà présent', () => {
    // Une colonne pour un drapeau de transition serait une migration à
    // défaire le jour où M3 devient le seul moteur.
    expect(CRON).toContain('moteurDepuisConfig(config.designStyle)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Aucun repli silencieux', () => {
  it('2.1 sans choix explicite, aucun repli', () => {
    expect(REPLI_DEFAUT).toBe('aucun');
    expect(repliDepuisConfig({})).toBe('aucun');
    expect(REPLIS).toEqual(['aucun', 'template_si_ignore']);
  });

  it('2.2 un ÉCHEC ne retombe jamais sur le gabarit', () => {
    /* ⚠️ LA DISTINCTION QUI COMPTE. « Ignoré » veut dire « rien à monter » —
       un repli s'y défend. « Échoué » veut dire que quelque chose a cassé :
       le masquer par une vidéo gabarit rendrait la panne invisible. */
    const code = sansProse(CRON);
    const bloc = code.slice(code.indexOf("issue.sorte === 'echec'"));
    expect(bloc.slice(0, 300)).toContain('continue;');
    expect(bloc.slice(0, 300)).not.toContain('template_si_ignore');
  });

  it('2.3 le repli n’existe que pour « ignoré », et il est explicite', () => {
    expect(CRON).toContain("repliDepuisConfig(config.designStyle) !== 'template_si_ignore'");
  });

  it('2.4 les trois issues sont comptées séparément dans le rapport', () => {
    for (const c of ['m3Reussis', 'm3Ignores', 'm3Echecs']) expect(CRON).toContain(c);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le mode review est préservé', () => {
  it('3.1 le statut vient de `toPostRow`, comme le chemin historique', () => {
    // ⚠️ AUCUN STATUT ÉCRIT À LA MAIN dans la branche M3 : `statusForMode`
    // reste seul juge, donc `review` → `draft`, et rien ne se publie.
    const bloc = CRON.slice(CRON.indexOf("moteur: 'm3'") - 2000,
      CRON.indexOf("moteur: 'm3'") + 2000);
    expect(bloc).toContain('toPostRow(');
    expect(bloc).not.toContain("status: 'scheduled'");
    expect(bloc).not.toContain("status: '");
  });

  it('3.2 aucune publication sociale n’est déclenchée', () => {
    for (const interdit of ['publierSur', 'publishTo', '/api/social/publish']) {
      expect(CHAINE).not.toContain(interdit);
      expect(BANQUE).not.toContain(interdit);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. L’idempotence survit', () => {
  it('4.1 le jeton de créneau est écrit et mémorisé comme avant', () => {
    const bloc = CRON.slice(CRON.indexOf("moteur: 'm3'"),
      CRON.indexOf("moteur: 'm3'") + 1500);
    expect(bloc).toContain('slotKey: jeton');
    expect(CRON.slice(CRON.indexOf("moteur: 'm3'"))).toContain('dejaFaits.add(jeton)');
  });

  it('4.2 la référence de débit distingue les deux moteurs', () => {
    /* Le débit historique est référencé sur `jobId`, qui contient un
       horodatage : deux tentatives donnent deux références. La branche M3
       est référencée sur le RENDU, qui est stable — donc rejouer le même
       rendu ne débite pas deux fois. */
    expect(CRON).toContain("referenceOperation('autopilote', `m3-${issue.renduId}`)");
  });

  it('4.3 M3 réutilise clips, plan et rendu au lieu de refaire', () => {
    // Les trois lectures « identique » sont ce qui rend la chaîne rejouable
    // sans brûler du CPU ni changer les clés de stockage.
    for (const f of ['lireSetReussiIdentique', 'lirePlanIdentique',
      'lireRenduReussiIdentique']) {
      expect(CHAINE, f).toContain(f);
    }
  });

  it('4.4 deux montages d’un même cycle ne repartent pas du même rush', () => {
    expect(CRON).toContain('rushesM3Utilises');
    expect(BANQUE).toContain('evites');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Aucune session n’est simulée, aucune route n’est appelée', () => {
  it('5.1 la passerelle n’ouvre aucun navigateur et ne fait aucun fetch', () => {
    /* ⚠️ LE PENDANT SERVEUR DE `chaine-passerelle`, PAS SON CLIENT.
       Celui-ci utilise `fetch` relatif + `credentials: same-origin` — un
       cookie qu'un cron n'a pas. Simuler une session serait contourner
       l'authentification ; on appelle donc les services directement. */
    for (const interdit of ['fetch(', 'playwright', 'puppeteer', 'localhost',
      'credentials:', 'auth()', 'next/headers', 'cookies(']) {
      expect(sansProse(CHAINE), interdit).not.toContain(interdit);
    }
  });

  it('5.2 les services reçoivent `userId` en clair', () => {
    expect(CHAINE).toContain('const { userId } = d;');
    expect(BANQUE).toContain('userId: string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Aucune règle éditoriale n’est réécrite', () => {
  it('6.1 la passerelle ORDONNE, elle ne décide pas', () => {
    /* Chaque décision vient de sa fonction d'origine. Si l'une d'elles
       disparaissait de ce fichier, c'est que la passerelle aurait commencé à
       décider elle-même — exactement ce qu'on refuse. */
    for (const f of ['calerCoupes', 'politiqueDePlan', 'planifierMontage',
      'rendreEtPublier', 'objectifEffectifUtilisateur', 'materialiserSet']) {
      expect(CHAINE, f).toContain(f);
    }
  });

  it('6.2 aucune constante d’algorithme n’est recopiée', () => {
    // Les identités doivent venir des contrats, jamais d'une chaîne écrite
    // ici : une recopie diverge au premier changement de version.
    expect(CHAINE).toContain('ALGORITHME_COUPES');
    expect(CHAINE).toContain('ALGORITHME_PLAN');
    expect(CHAINE).toContain('METHODE_MATERIALISATION');
    expect(CHAINE).not.toMatch(/'m3[a-z]-v\d/);
  });

  it('6.3 l’objectif est celui du compte, et il n’est pas modifié', () => {
    expect(CHAINE).toContain('objectifEffectifUtilisateur(userId)');
    // Aucune écriture d'objectif : le cron applique, il ne décide pas.
    expect(CHAINE).not.toContain('enregistrerObjectif');
  });

  it('6.4 la recette audio est celle du profil, silence initial compris', () => {
    expect(CRON).toContain('audioDepuisStyle(config.designStyle)');
    expect(CHAINE).toContain('recette');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Les deux banques de rushes', () => {
  it('7.1 M3 lit la banque canonique, pas les URL du gabarit', () => {
    expect(BANQUE).toContain("from('rushes')");
    expect(sansProse(BANQUE)).not.toContain('rush_urls');
  });

  it('7.2 seuls les rushes vérifiés sont montés', () => {
    expect(BANQUE).toContain("eq('etat', 'verifie')");
  });

  it('7.3 aucune donnée n’est migrée, aucune colonne ajoutée', () => {
    for (const interdit of ['insert(', 'update(', 'delete(', 'alter ']) {
      expect(BANQUE.toLowerCase(), interdit).not.toContain(interdit);
    }
  });

  it('7.4 il faut une analyse ET des candidats réussis', () => {
    expect(BANQUE).toContain("analyse.etat !== 'reussie'");
    expect(BANQUE).toContain("generation.etat !== 'reussie'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Le vocabulaire des issues', () => {
  it('8.1 les motifs sont une liste fermée', () => {
    /* A_0b a ajouté les états intermédiaires : « en cours » n'est ni une
       réussite ni un échec, et « échouée » n'est pas « absente ». Sans cette
       distinction, une analyse lancée deux minutes plus tôt par un humain
       serait comptée comme une panne à chaque cycle. */
    /* A_8f en ajoute deux, et l'ordre compte : la liste est comparee telle
       quelle pour qu'un ajout soit un GESTE, jamais un effet de bord. « Le
       clone etait demande et n'a pas pu servir » est un etat UTILISATEUR
       normal — pas une panne —, d'ou un motif nomme plutot qu'un repli
       silencieux vers une video ordinaire. */
    expect(MOTIFS_M3).toEqual([
      'aucun_rush_analyse', 'analyse_absente', 'analyse_en_cours',
      'analyse_echouee', 'candidats_absents', 'candidats_en_cours',
      'candidats_echoues', 'coupes_vides', 'clips_echoues', 'plan_impossible',
      'rendu_echoue', 'socle_absent',
      'jumeau_non_pret', 'jumeau_indisponible',
    ]);
  });

  it('8.2 le format est validé, jamais forcé', () => {
    // ⚠️ UN `as` AURAIT FAIT ENTRER « portrait » DANS UN VOCABULAIRE FERMÉ,
    // et l'erreur serait ressortie au rendu, trois minutes plus loin.
    expect(CRON).toContain('!formatValide(montage.format)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. L’ancien Autopilote est intact', () => {
  it('9.1 le chemin gabarit est toujours là, entier', () => {
    for (const f of ['renderAndUpload', 'buildAutopilotDesign',
      'buildAutopilotVoices', 'pickRush', 'rushEncorePresent',
      'pickCustomPoster', 'preparePosts']) {
      expect(CRON, f).toContain(f);
    }
  });

  it('9.2 l’aiguillage est AVANT la fabrication, pas à sa place', () => {
    const aiguillage = CRON.indexOf("moteurDepuisConfig(config.designStyle) === 'm3'");
    const gabarit = CRON.indexOf('rushEncorePresent(rushUrl)');
    expect(aiguillage).toBeGreaterThan(-1);
    expect(gabarit).toBeGreaterThan(aiguillage);
  });

  it('9.3 le débit et l’insertion historiques ne sont pas touchés', () => {
    expect(CRON).toContain("referenceOperation('autopilote', jobId)");
    expect(CRON).toContain('toPostRow({ userId, post: postUtilise, config, videoUrl, metadata })');
  });
});
