/**
 * Contrat du resolveur canonique des trois textes : CTA principal, CTA
 * secondaire, filigrane.
 *
 * Ces tests encodent la conclusion de l'audit : les trois concepts sont
 * INDEPENDANTS. Le filigrane n'est jamais un repli de CTA, et un CTA n'ecrase
 * jamais le filigrane — quelle que soit la convention du producteur.
 *
 * Aucune fixture n'est modifiee : les jeux d'essai existants sont relus tels
 * quels, et les formes supplementaires sont construites ici.
 */

import { describe, it, expect } from 'vitest';
import {
  resoudreTextes,
  detecterProducteur,
  ecrireTexte,
  DEFAUTS_COMPOSITEUR,
} from '@/lib/creer/textesCanoniques';
import type { ChampTexte } from '@/lib/creer/textesCanoniques';
import {
  ADVANCED_METADATA,
  ASSISTANT_METADATA,
  LEGACY_PARTIAL_METADATA,
  EDGE_METADATA,
} from './fixtures/canonical-design';

/**
 * Le cas de regression demande : les trois textes sont VOLONTAIREMENT
 * differents, sur la forme jumelee que produit l'editeur avance
 * (`watermarkText` recopie le gros CTA). Le filigrane doit survivre.
 */
const REGRESSION_TROIS_TEXTES: Record<string, unknown> = {
  type: 'infographic',
  branding: {
    accentColor: '#a855f7',
    ctaText: 'LIEN EN BIO',
    ctaSubText: 'LIEN EN BIO',
    watermarkText: 'SUIVEZ-NOUS',
    borderEnabled: false,
    borderColor: null,
  },
  design: {
    ctaMainText: 'SUIVEZ-NOUS',
    ctaSubText: 'LIEN EN BIO',
    siteText: { text: 'MARQUE', enabled: true, sequences: ['titre', 'cta'] },
  },
};

/** Ancienne forme `creer-avance` SANS `design.ctaMainText`. */
const AVANCE_HERITE: Record<string, unknown> = {
  type: 'infographic',
  branding: {
    ctaText: 'CHAT POUR PLUS D INFOS',
    ctaSubText: 'LIEN EN BIO',
    watermarkText: 'MARQUE',
  },
};

/** Copie profonde de reference, pour prouver l'absence de mutation. */
function empreinte(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val === undefined ? '__indefini__' : val));
}

describe('resoudreTextes — trois concepts independants', () => {
  it('1. trois valeurs differentes restent differentes', () => {
    const r = resoudreTextes(REGRESSION_TROIS_TEXTES);
    expect(r.ctaPrincipal.valeur).toBe('SUIVEZ-NOUS');
    expect(r.ctaSecondaire.valeur).toBe('LIEN EN BIO');
    expect(r.filigrane.valeur).toBe('MARQUE');
    const distinctes = new Set([
      r.ctaPrincipal.valeur,
      r.ctaSecondaire.valeur,
      r.filigrane.valeur,
    ]);
    expect(distinctes.size).toBe(3);
  });

  it('2. le filigrane n\'est JAMAIS lu comme CTA, ni le CTA comme filigrane', () => {
    // ADVANCED : `watermarkText` vaut `ctaMainText` — c'est le GROS CTA, pas
    // un filigrane. Le filigrane doit venir de `siteText`, et de lui seul.
    const a = resoudreTextes(ADVANCED_METADATA);
    expect(a.ctaPrincipal.valeur).toBe('MARQUE');
    expect(a.filigrane.valeur).toBe('exemple.test');
    expect(a.filigrane.valeur).not.toBe(a.ctaPrincipal.valeur);
    expect(a.filigrane.cle).toBe('design.siteText.text');

    // Aucune resolution ne doit jamais citer `branding.watermarkText` comme
    // origine du filigrane, sur AUCUNE fixture.
    for (const m of [ADVANCED_METADATA, ASSISTANT_METADATA, LEGACY_PARTIAL_METADATA, EDGE_METADATA, AVANCE_HERITE]) {
      expect(resoudreTextes(m).filigrane.cle).not.toBe('branding.watermarkText');
    }

    // Et sans `siteText`, le filigrane est ABSENT — jamais emprunte au CTA.
    const f = resoudreTextes(AVANCE_HERITE).filigrane;
    expect(f.present).toBe(false);
    expect(f.valeur).toBeNull();
  });
});

describe('ecrireTexte — modifier un champ n\'en touche aucun autre', () => {
  it('3. modifier le CTA principal ne change ni le secondaire ni le filigrane', () => {
    const avant = resoudreTextes(REGRESSION_TROIS_TEXTES);
    const apres = resoudreTextes(
      ecrireTexte(REGRESSION_TROIS_TEXTES, 'ctaPrincipal', 'RESERVEZ MAINTENANT'),
    );
    expect(apres.ctaPrincipal.valeur).toBe('RESERVEZ MAINTENANT');
    expect(apres.ctaSecondaire.valeur).toBe(avant.ctaSecondaire.valeur);
    expect(apres.filigrane.valeur).toBe(avant.filigrane.valeur);
  });

  it('4. modifier le CTA secondaire ne change ni le principal ni le filigrane', () => {
    const avant = resoudreTextes(REGRESSION_TROIS_TEXTES);
    const apres = resoudreTextes(
      ecrireTexte(REGRESSION_TROIS_TEXTES, 'ctaSecondaire', 'Lien dans la bio'),
    );
    expect(apres.ctaSecondaire.valeur).toBe('Lien dans la bio');
    expect(apres.ctaPrincipal.valeur).toBe(avant.ctaPrincipal.valeur);
    expect(apres.filigrane.valeur).toBe(avant.filigrane.valeur);
  });

  it('5. modifier le filigrane ne change aucun CTA', () => {
    const avant = resoudreTextes(REGRESSION_TROIS_TEXTES);
    const apres = resoudreTextes(
      ecrireTexte(REGRESSION_TROIS_TEXTES, 'filigrane', 'Afroboost'),
    );
    expect(apres.filigrane.valeur).toBe('Afroboost');
    expect(apres.ctaPrincipal.valeur).toBe(avant.ctaPrincipal.valeur);
    expect(apres.ctaSecondaire.valeur).toBe(avant.ctaSecondaire.valeur);
  });

  it('ecrit dans la CLE D\'ORIGINE, et jamais dans watermarkText', () => {
    const m = ecrireTexte(REGRESSION_TROIS_TEXTES, 'ctaPrincipal', 'RESERVEZ') as {
      branding: Record<string, unknown>;
      design: Record<string, unknown>;
    };
    expect(m.design.ctaMainText).toBe('RESERVEZ');
    // `watermarkText` garde sa valeur d'origine : le resolveur ne le REECRIT
    // pas, et ne le supprime pas non plus.
    expect(m.branding.watermarkText).toBe('SUIVEZ-NOUS');
  });

  it('ecrit dans la cle canonique quand aucune cle ne portait la valeur', () => {
    const m = ecrireTexte(AVANCE_HERITE, 'filigrane', 'Afroboost') as {
      design: Record<string, unknown>;
    };
    const siteText = m.design.siteText as Record<string, unknown>;
    expect(siteText.text).toBe('Afroboost');
    expect(resoudreTextes(m).filigrane.valeur).toBe('Afroboost');
  });

  it('preserve les cles inconnues, a tous les niveaux', () => {
    const m = ecrireTexte(EDGE_METADATA, 'ctaPrincipal', 'NOUVEAU') as Record<string, unknown>;
    expect(m.champInconnuRacine).toEqual(EDGE_METADATA.champInconnuRacine);
    expect(m.cron_publish_results).toEqual(EDGE_METADATA.cron_publish_results);
    expect(m.timezone).toBe('Europe/Paris');
    const design = m.design as Record<string, unknown>;
    const designSource = EDGE_METADATA.design as Record<string, unknown>;
    expect(design.champInconnuDansDesign).toEqual(designSource.champInconnuDansDesign);
  });
});

describe('anciennes metadata', () => {
  it('6. anciennes metadata completes — editeur avance jumele', () => {
    const r = resoudreTextes(ADVANCED_METADATA);
    expect(detecterProducteur(ADVANCED_METADATA)).toBe('jumele');
    expect(r.ctaPrincipal).toMatchObject({ valeur: 'MARQUE', cle: 'design.ctaMainText', present: true, parDefaut: false });
    expect(r.ctaSecondaire).toMatchObject({ valeur: 'CHAT POUR PLUS D INFOS', cle: 'design.ctaSubText', present: true });
    expect(r.filigrane).toMatchObject({ valeur: 'exemple.test', cle: 'design.siteText.text', present: true, actif: true });

    // Assistant : meme jumelage, filigrane distinct.
    const a = resoudreTextes(ASSISTANT_METADATA);
    expect(detecterProducteur(ASSISTANT_METADATA)).toBe('jumele');
    expect(a.ctaPrincipal.valeur).toBe('Decouvrir');
    expect(a.ctaSecondaire.valeur).toBe('Lien en bio');
    expect(a.filigrane.valeur).toBe('Studiio.pro');
  });

  it('6bis. ancienne forme avance SANS design.ctaMainText', () => {
    expect(detecterProducteur(AVANCE_HERITE)).toBe('avance-herite');
    const r = resoudreTextes(AVANCE_HERITE);
    // Le GROS texte de ces posts vit sous `watermarkText` : c'est un CTA mal
    // nomme, pas un filigrane.
    expect(r.ctaPrincipal).toMatchObject({ valeur: 'MARQUE', cle: 'branding.watermarkText' });
    // Et la PETITE ligne vit sous `branding.ctaText`.
    expect(r.ctaSecondaire).toMatchObject({ valeur: 'CHAT POUR PLUS D INFOS', cle: 'branding.ctaText' });
    expect(r.filigrane.present).toBe(false);
  });

  it('7. anciennes metadata partielles et chaines vides volontaires', () => {
    // LEGACY : aucune cle de texte. Rien n'est invente.
    const l = resoudreTextes(LEGACY_PARTIAL_METADATA);
    expect(detecterProducteur(LEGACY_PARTIAL_METADATA)).toBe('canonique');
    for (const t of [l.ctaPrincipal, l.ctaSecondaire, l.filigrane]) {
      expect(t.present).toBe(false);
      expect(t.parDefaut).toBe(false);
      expect(t.valeur).toBeNull();
      expect(t.cle).toBeNull();
    }

    // EDGE : `branding.ctaText` vaut '' — une chaine vide VOLONTAIRE. Elle
    // reste presente et n'ouvre aucun repli (le piege du `||`).
    const e = resoudreTextes(EDGE_METADATA);
    expect(e.ctaPrincipal).toMatchObject({ valeur: '', cle: 'branding.ctaText', present: true, parDefaut: false });
    expect(e.ctaSecondaire.present).toBe(false);
    expect(e.filigrane.present).toBe(false);
  });

  it('7bis. les defauts ne sont appliques QUE si l\'appelant les fournit', () => {
    const sans = resoudreTextes(LEGACY_PARTIAL_METADATA);
    expect(sans.ctaPrincipal.valeur).toBeNull();

    const avec = resoudreTextes(LEGACY_PARTIAL_METADATA, { defauts: DEFAUTS_COMPOSITEUR });
    expect(avec.ctaPrincipal).toMatchObject({
      valeur: DEFAUTS_COMPOSITEUR.ctaPrincipal,
      cle: null,
      present: false,
      parDefaut: true,
    });

    // Une chaine vide volontaire n'est PAS remplacee par un defaut.
    const vide = resoudreTextes(EDGE_METADATA, { defauts: DEFAUTS_COMPOSITEUR });
    expect(vide.ctaPrincipal.valeur).toBe('');
    expect(vide.ctaPrincipal.parDefaut).toBe(false);
  });
});

describe('purete', () => {
  it('8. aucune mutation de l\'objet source, provenance exacte', () => {
    const sources = [ADVANCED_METADATA, ASSISTANT_METADATA, LEGACY_PARTIAL_METADATA, EDGE_METADATA, REGRESSION_TROIS_TEXTES];
    const avant = sources.map(empreinte);

    for (const m of sources) {
      resoudreTextes(m);
      resoudreTextes(m, { defauts: DEFAUTS_COMPOSITEUR });
      detecterProducteur(m);
      ecrireTexte(m, 'ctaPrincipal', 'X');
      ecrireTexte(m, 'ctaSecondaire', 'Y');
      ecrireTexte(m, 'filigrane', 'Z');
    }

    expect(sources.map(empreinte)).toEqual(avant);
  });

  it('8bis. aller-retour sans modification : metadata inchangee', () => {
    for (const m of [ADVANCED_METADATA, ASSISTANT_METADATA, REGRESSION_TROIS_TEXTES]) {
      const r = resoudreTextes(m);
      const rendu = ecrireTexte(
        ecrireTexte(
          ecrireTexte(m, 'ctaPrincipal', r.ctaPrincipal.valeur as string),
          'ctaSecondaire',
          r.ctaSecondaire.valeur as string,
        ),
        'filigrane',
        r.filigrane.valeur as string,
      );
      expect(empreinte(rendu)).toBe(empreinte(m));
    }
  });

  it('10. ecrireTexte n\'ecrit que dans une provenance autorisee', () => {
    const base: Record<string, unknown> = {
      design: { ctaMainText: 'A', ctaSubTextDesign: 'B' },
      branding: { ctaText: 'C' },
    };

    // Un champ hors contrat echoue BRUYAMMENT au lieu de retomber sur une
    // cle arbitraire. `__proto__` et `constructor` ne sont pas des proprietes
    // propres de la table des cles canoniques : ils sont donc rejetes.
    for (const hostile of ['__proto__', 'constructor', 'prototype', 'toString', 'inconnu']) {
      expect(() => ecrireTexte(base, hostile as ChampTexte, 'POLLUE')).toThrow(TypeError);
    }

    // Aucun prototype n'est atteint, ni par le champ ni par la metadata.
    const parLaMetadata = JSON.parse(
      '{"design":{"ctaMainText":"A","__proto__":{"POLLUE":1}},"branding":{}}',
    );
    ecrireTexte(parLaMetadata, 'ctaPrincipal', 'X');
    expect(({} as Record<string, unknown>).POLLUE).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).POLLUE).toBeUndefined();

    // Et les seules cibles possibles restent les six cles du contrat.
    const cibles = (['ctaPrincipal', 'ctaSecondaire', 'filigrane'] as const).map((c) => {
      const m = ecrireTexte(base, c, 'V') as { design: Record<string, unknown>; branding: Record<string, unknown> };
      return JSON.stringify({ d: m.design, b: m.branding });
    });
    expect(cibles).toHaveLength(3);
    expect(new Set(cibles).size).toBe(3);
  });

  it('tolere les entrees non conformes sans lever', () => {
    for (const mauvais of [null, undefined, 42, 'texte', [], { branding: null }, { design: 7 }]) {
      const r = resoudreTextes(mauvais);
      expect(r.ctaPrincipal.present).toBe(false);
      expect(r.filigrane.present).toBe(false);
      expect(detecterProducteur(mauvais)).toBe('canonique');
    }
  });
});
