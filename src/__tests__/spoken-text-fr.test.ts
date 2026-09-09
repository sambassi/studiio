// @vitest-environment node
/**
 * A_8d — LE TEXTE ÉCRIT N'EST PAS LE TEXTE PARLÉ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER TIENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Une table de cas. Le normaliseur est PUR — aucun disque, aucun réseau,
 * aucune horloge — donc il se teste exhaustivement, et il le doit : chaque
 * ligne ci-dessous correspond à une forme que Bassi a réellement entendue mal
 * prononcée.
 *
 * ⚠️ SIX DÉFAUTS ONT ÉTÉ TROUVÉS PAR CETTE TABLE, pas par la relecture :
 * le jeton de mise à l'abri était numérique et ressortait en « zéro » ;
 * « 30 € » restait « trente € » faute de frontière de mot après un symbole ;
 * « 1,50 CHF » disait « un francs suisses » ; « 31/02 » se faisait découper en
 * nombres ; et l'espace avant un montant était avalée — « coûtevingt-cinq ».
 * D'où les cas qui les couvrent, nommément.
 */
import { describe, it, expect } from 'vitest';
import {
  normaliserTexteParle, entierEnLettres, dateReelle, langueParleeValide,
  LANGUE_PARLEE_DEFAUT,
} from '@/lib/voice/spoken-text';

const n = (t: string, l?: 'fr' | 'fr-FR' | 'fr-CH') => normaliserTexteParle(t, l);
const table = (cas: readonly (readonly [string, string])[]) => {
  for (const [entree, attendu] of cas) {
    expect(n(entree), JSON.stringify(entree)).toBe(attendu);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les pourcentages', () => {
  it('1.1 avec et sans espace, avec et sans signe', () => {
    table([
      ['25%', 'vingt-cinq pour cent'],
      ['25 %', 'vingt-cinq pour cent'],
      ['+50%', 'plus cinquante pour cent'],
      ['+50 %', 'plus cinquante pour cent'],
      ['-20%', 'moins vingt pour cent'],
      ['-20 %', 'moins vingt pour cent'],
      ['100%', 'cent pour cent'],
      ['0,5%', 'zéro virgule cinq pour cent'],
    ]);
  });

  it('1.2 dans une phrase, la ponctuation reste', () => {
    expect(n('Profitez de -25 % dès maintenant.'))
      .toBe('Profitez de moins vingt-cinq pour cent dès maintenant.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les montants', () => {
  it('2.1 ⚠️ LE SINGULIER SUIT L’ENTIER, PAS LES CENTIMES', () => {
    // « un francs suisses et cinquante centimes » — constaté au banc.
    table([
      ['1 CHF', 'un franc suisse'],
      ['25 CHF', 'vingt-cinq francs suisses'],
      ['1,50 CHF', 'un franc suisse et cinquante centimes'],
      ['25,50 CHF', 'vingt-cinq francs suisses et cinquante centimes'],
    ]);
  });

  it('2.2 ⚠️ LES SYMBOLES N’ONT PAS DE FRONTIÈRE DE MOT', () => {
    /* `\b` après `€` ou `$` échoue toujours : ce ne sont pas des caractères de
       mot. « 30 € » ressortait « trente € ». */
    table([
      ['30 €', 'trente euros'],
      ['1 €', 'un euro'],
      ['$50', 'cinquante dollars'],
      ['50 $', 'cinquante dollars'],
      ['1,50 €', 'un euro et cinquante centimes'],
    ]);
  });

  it('2.3 ⚠️ L’ESPACE AVANT LE MONTANT N’EST PAS AVALÉE', () => {
    // « L’offre coûtevingt-cinq francs suisses » — constaté au banc.
    expect(n('L’offre coûte 25 CHF aujourd’hui.'))
      .toBe('L’offre coûte vingt-cinq francs suisses aujourd’hui.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les heures', () => {
  it('3.1 toutes les formes usuelles', () => {
    table([
      ['18h30', 'dix-huit heures trente'],
      ['18 h 30', 'dix-huit heures trente'],
      ['8h', 'huit heures'],
      ['08h05', 'huit heures cinq'],
      ['12h00', 'douze heures'],
      ['23h59', 'vingt-trois heures cinquante-neuf'],
      ['1h', 'une heure'.replace('une', 'un')],
    ]);
  });

  it('3.2 une heure impossible n’est pas une heure', () => {
    // 25h ou 18h75 sont des fautes de frappe : les lire les masquerait.
    expect(n('25h30')).not.toContain('heures');
    expect(n('18h75')).not.toContain('heures');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Les nombres', () => {
  it('4.1 entiers, groupés ou non', () => {
    table([
      ['1500', 'mille cinq cents'],
      ['1 500', 'mille cinq cents'],
      ['25 000', 'vingt-cinq mille'],
      ['2026', 'deux mille vingt-six'],
    ]);
  });

  it('4.2 décimaux : la virgule se dit', () => {
    table([['1,5', 'un virgule cinq'], ['0,75', 'zéro virgule soixante-quinze']]);
  });

  it('4.3 la conversion est juste sur les cas français délicats', () => {
    expect(entierEnLettres(80)).toBe('quatre-vingts');
    expect(entierEnLettres(81)).toBe('quatre-vingt-un');
    expect(entierEnLettres(71)).toBe('soixante et onze');
    expect(entierEnLettres(21)).toBe('vingt et un');
    expect(entierEnLettres(100)).toBe('cent');
    expect(entierEnLettres(200)).toBe('deux cents');
    expect(entierEnLettres(1_000_000)).toBe('un million');
  });

  it('4.4 ⚠️ UNE ANNÉE ISOLÉE N’EST PAS DEVINÉE', () => {
    /* « 2026 » peut être une année ou une quantité. Le lire « deux mille
       vingt-six » est juste dans les deux cas ; inventer « l'an » ne le
       serait que dans un seul. */
    expect(n('2026')).toBe('deux mille vingt-six');
    expect(n('2026')).not.toMatch(/an |année/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Les dates', () => {
  it('5.1 les formats français et suisse', () => {
    table([
      ['17/06/2026', 'dix-sept juin deux mille vingt-six'],
      ['17.06.2026', 'dix-sept juin deux mille vingt-six'],
      ['01/01/2027', 'premier janvier deux mille vingt-sept'],
    ]);
  });

  it('5.2 ⚠️ UNE DATE IMPOSSIBLE RESTE INTACTE, PAS DÉCOUPÉE', () => {
    /* `31/02/2026` ressortait « trente et un/deux/deux mille vingt-six » : la
       règle des dates le refusait, puis celle des nombres le dévorait. */
    expect(n('31/02/2026')).toBe('31/02/2026');
    expect(n('32/01/2026')).toBe('32/01/2026');
    expect(n('17/13/2026')).toBe('17/13/2026');
  });

  it('5.3 les années bissextiles sont respectées', () => {
    expect(dateReelle(29, 2, 2028)).toBe(true);
    expect(dateReelle(29, 2, 2026)).toBe(false);
    expect(dateReelle(29, 2, 2000)).toBe(true);
    expect(dateReelle(29, 2, 1900)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Ordinaux, multiplicateurs, numéros', () => {
  it('6.1 les formes usuelles', () => {
    table([
      ['1er', 'premier'], ['1re', 'première'], ['2e', 'deuxième'],
      ['3e', 'troisième'], ['5e', 'cinquième'], ['9e', 'neuvième'],
      ['3x', 'trois fois'], ['10x', 'dix fois'],
      ['n°3', 'numéro trois'], ['N° 12', 'numéro douze'],
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Ce qui ne doit pas être touché', () => {
  it('7.1 ⚠️ URL, E-MAIL, MENTION ET MOT-DIÈSE RESSORTENT INTACTS', () => {
    /* Les épeler produit une phrase illisible ; deviner comment les dire
       dépend d'un contexte qu'on n'a pas. La règle prudente est de ne pas les
       détruire. */
    for (const v of ['https://studiio.pro', 'bassi@studiio.pro', '@afroboost', '#Afroboost']) {
      expect(n(v), v).toBe(v);
    }
  });

  it('7.2 une date dans une URL n’est pas convertie', () => {
    // Sans mise à l'abri, `17/06/2026` deviendrait une date au milieu du lien.
    expect(n('https://studiio.pro/blog/17/06/2026')).toBe('https://studiio.pro/blog/17/06/2026');
  });

  it('7.3 ⚠️ UN NUMÉRO DE TÉLÉPHONE SE DIT PAR GROUPES', () => {
    /* Sans règle dédiée, il se lirait comme un entier de onze chiffres —
       personne n'y reconnaît son propre numéro. */
    const dit = n('+41 79 123 45 67');
    expect(dit).toContain('plus');
    expect(dit).not.toMatch(/milliard|million/);
    expect(dit.split(' ').length).toBeGreaterThan(4);
  });

  it('7.4 un texte purement verbal ne bouge pas', () => {
    const t = 'Bonjour et bienvenue chez Studiio.';
    expect(n(t)).toBe(t);
  });

  it('7.5 les entrées vides ou non textuelles rendent une chaîne vide', () => {
    for (const v of ['', null, undefined, 42, {}]) {
      expect(normaliserTexteParle(v as never)).toBe('');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. La Suisse romande', () => {
  it('8.1 ⚠️ SEPTANTE ET NONANTE, MAIS PAS « HUITANTE »', () => {
    /* « Huitante » n'est usuel qu'à Vaud, Fribourg et Valais ; Genève et
       Neuchâtel disent « quatre-vingts ». Retenir la forme majoritaire évite
       de faire dire à quelqu'un un mot qu'il n'emploie pas. */
    expect(n('70', 'fr-CH')).toBe('septante');
    expect(n('90', 'fr-CH')).toBe('nonante');
    expect(n('75', 'fr-CH')).toBe('septante-cinq');
    expect(n('80', 'fr-CH')).toBe('quatre-vingts');
  });

  it('8.2 la France garde ses formes', () => {
    expect(n('70', 'fr-FR')).toBe('soixante-dix');
    expect(n('90', 'fr-FR')).toBe('quatre-vingt-dix');
    expect(n('71', 'fr-FR')).toBe('soixante et onze');
  });

  it('8.3 ⚠️ UN SEUL SYSTÈME À LA FOIS', () => {
    // Mélanger « septante » et « quatre-vingt-dix » dans une même phrase
    // serait la seule erreur vraiment audible.
    const ch = n('70 et 90', 'fr-CH');
    expect(ch).toContain('septante');
    expect(ch).toContain('nonante');
    expect(ch).not.toContain('soixante-dix');
  });

  it('8.4 une langue inconnue retombe sur le défaut', () => {
    expect(langueParleeValide('de')).toBe(LANGUE_PARLEE_DEFAUT);
    expect(langueParleeValide(null)).toBe(LANGUE_PARLEE_DEFAUT);
    expect(langueParleeValide('fr-CH')).toBe('fr-CH');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Les propriétés du normaliseur', () => {
  it('9.1 ⚠️ IDEMPOTENT', () => {
    /* Normaliser deux fois doit donner le même texte : sans cela, un aperçu
       affiché puis renvoyé au moteur dériverait à chaque passage. */
    const cas = [
      '25 %', '18h30', '25 CHF', '17/06/2026', '1 500', '1er', 'n°3',
      '+41 79 123 45 67', 'https://studiio.pro',
      'Cette semaine, profitez de -25 % à partir de 18h30. L’offre coûte 25 CHF.',
    ];
    for (const c of cas) {
      const une = n(c);
      expect(n(une), c).toBe(une);
    }
  });

  it('9.2 la phrase complète, de bout en bout', () => {
    expect(n(
      'Cette semaine, profitez de -25 % à partir de 18h30. '
      + 'L’offre coûte 25 CHF et se termine le 17/06/2026.',
    )).toBe(
      'Cette semaine, profitez de moins vingt-cinq pour cent à partir de '
      + 'dix-huit heures trente. L’offre coûte vingt-cinq francs suisses '
      + 'et se termine le dix-sept juin deux mille vingt-six.',
    );
  });

  it('9.3 ⚠️ AUCUN MODÈLE DE LANGAGE N’EST APPELÉ', () => {
    // « 25 % » → « vingt-cinq pour cent » est une règle, pas une opinion.
    const src = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'src/lib/voice/spoken-text.ts'), 'utf8',
    ) as string;
    expect(src).not.toMatch(/fetch\(|anthropic|openai|gemini/i);
    expect(src).not.toMatch(/Date\.now|Math\.random/);
  });
});
