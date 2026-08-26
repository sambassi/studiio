/**
 * L'ADAPTATEUR DE L'ASSISTANT, ALIGNE SUR LE CONTRAT CANONIQUE.
 *
 * ── CE QUE CES TESTS ENCODENT ────────────────────────────────────────────
 *
 * Avant ce lot, `to-wizard` lisait `branding.ctaText` comme CTA principal et
 * `from-wizard` y reecrivait. Or cette cle ne porte le GROS texte que chez
 * l'Assistant et l'Autopilote : chez `creer-avance` et l'Agent IA elle porte la
 * PETITE ligne (`creer-avance/page.tsx:5258`, `api/agent/generate:216`), et le
 * compositeur la peint en petit (`video-composer.ts:2807`).
 *
 * Deux consequences mesurees sur les formes reelles :
 *
 *   1. INVERSION A L'ECRAN sur 4 formes sur 6 — le champ « CTA » affichait la
 *      petite ligne.
 *   2. ECRASEMENT de `branding.ctaText` sur les SIX — la cle que le
 *      compositeur peint en petite ligne. Au pixel, la petite ligne changeait
 *      sur trois des six ; ailleurs `design.ctaSubText` masquait la casse.
 *   3. MODIFICATION INVISIBLE sur les SIX — le nouveau gros texte n'atteignait
 *      jamais le rendu, qui lit `design.ctaMainText` en premier (`:2806`).
 *
 * Perte silencieuse, sur une colonne `jsonb` sans historique.
 *
 * Les deux adaptateurs passent donc par le resolveur canonique : la lecture
 * prend `resoudreTextes`, l'ecriture vise la PROVENANCE de la valeur relue.
 * Aucune ancienne cle n'est deplacee, synchronisee ni supprimee.
 */

import { describe, it, expect } from 'vitest';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';
import { metadataPourEnregistrement } from '@/lib/creer/postMetadata/from-wizard';
import { mergePostMetadata } from '@/lib/creer/postMetadata/to-post';
import { resoudreTextes } from '@/lib/creer/textesCanoniques';

/** Sentinelle de cle inconnue, presente dans chaque forme. */
const INCONNU = { garde: ['a', { b: 1 }] };

/**
 * Les six formes couvertes.
 *
 * QUATRE sont reconstruites depuis les producteurs reels, ligne par ligne :
 * `assistant`, `creer-avance`, `avance-herite`, `autopilote`.
 *
 * DEUX sont defensives, et le disent : `calendrier` ajoute les marqueurs d'un
 * montage deja rendu, et `jumele` place `design.ctaSubTextDesign` en base —
 * ce qu'AUCUN producteur ne fait aujourd'hui (cette cle ne vit que dans les
 * options du compositeur, `creer-avance:5048`). Elle exerce l'echelon 1 de la
 * cascade du secondaire, qui serait sinon jamais teste.
 */
const FORMES: ReadonlyArray<{
  readonly nom: string;
  readonly gros: string;
  readonly petit: string | null;
  readonly metadata: Record<string, unknown>;
}> = [
  {
    // AssistantWizard.tsx:6058-6099
    nom: 'assistant',
    gros: 'RESERVEZ MAINTENANT',
    petit: 'Lien en bio',
    metadata: {
      subtitle: 'sous-titre',
      champInconnu: INCONNU,
      branding: {
        accentColor: '#7C3AED',
        ctaText: 'RESERVEZ MAINTENANT',
        ctaSubText: 'Lien en bio',
        watermarkText: 'RESERVEZ MAINTENANT',
      },
      design: {
        ctaMainText: 'RESERVEZ MAINTENANT',
        ctaSubText: 'Lien en bio',
        font: 'Anton',
        siteText: { text: 'Studiio.pro', enabled: true, sequences: ['titre', 'cta'] },
      },
    },
  },
  {
    // creer-avance/page.tsx:5258-5309 — `branding.ctaText` y porte la PETITE ligne
    nom: 'creer-avance',
    gros: 'AFROBOOST',
    petit: "CHAT POUR PLUS D'INFOS",
    metadata: {
      champInconnu: INCONNU,
      branding: {
        accentColor: '#a855f7',
        ctaText: "CHAT POUR PLUS D'INFOS",
        ctaSubText: 'LIEN EN BIO',
        watermarkText: 'AFROBOOST',
      },
      design: {
        ctaMainText: 'AFROBOOST',
        ctaSubText: "CHAT POUR PLUS D'INFOS",
        font: 'Bebas Neue',
        siteText: { text: 'Afroboost.com', enabled: true },
      },
    },
  },
  {
    // api/agent/generate/route.ts:215-217 — aucun `design`
    nom: 'avance-herite',
    gros: 'AFROBOOST',
    petit: "CHAT POUR PLUS D'INFOS",
    metadata: {
      champInconnu: INCONNU,
      branding: {
        accentColor: '#7C3AED',
        watermarkText: 'AFROBOOST',
        ctaText: "CHAT POUR PLUS D'INFOS",
        ctaSubText: 'LIEN EN BIO',
      },
    },
  },
  {
    // DEFENSIVE : forme jumelee portant la petite ligne sous
    // `design.ctaSubTextDesign` — echelon 1 de la cascade, qu'aucun producteur
    // ne persiste aujourd'hui.
    nom: 'jumele',
    gros: 'SUIVEZ-NOUS',
    petit: 'Lien en bio',
    metadata: {
      champInconnu: INCONNU,
      branding: {
        ctaText: 'Lien en bio',
        watermarkText: 'SUIVEZ-NOUS',
      },
      design: {
        ctaMainText: 'SUIVEZ-NOUS',
        ctaSubTextDesign: 'Lien en bio',
        siteText: { text: 'MARQUE', enabled: true },
      },
    },
  },
  {
    // calendar/page.tsx:806 — les textes traversent a l'identique
    nom: 'calendrier',
    gros: 'AFROBOOST',
    petit: "CHAT POUR PLUS D'INFOS",
    metadata: {
      champInconnu: INCONNU,
      renderedVideoUrl: 'https://exemple/montage.webm',
      composerVersion: 'v38',
      branding: {
        ctaText: "CHAT POUR PLUS D'INFOS",
        ctaSubText: 'LIEN EN BIO',
        watermarkText: 'AFROBOOST',
      },
      design: {
        ctaMainText: 'AFROBOOST',
        ctaSubText: "CHAT POUR PLUS D'INFOS",
        siteText: { text: 'Afroboost.com', enabled: true },
      },
    },
  },
  {
    // autopilot/design.ts:331-344 — une seule valeur dans les trois cles
    nom: 'autopilote',
    gros: 'REJOINS-NOUS',
    petit: null, // ce producteur n'ecrit aucune petite ligne
    metadata: {
      source: 'autopilote',
      champInconnu: INCONNU,
      branding: { ctaText: 'REJOINS-NOUS', watermarkText: 'REJOINS-NOUS' },
      design: {
        ctaMainText: 'REJOINS-NOUS',
        siteText: { enabled: true, text: 'Studiio.pro' },
      },
    },
  },
];

/** Ce que `construireValeurs` produit pour les deux textes, cote wizard. */
function valeursDepuis(metadata: Record<string, unknown>) {
  const d = toWizardDraft({ metadata });
  const g = d.generated as { cta: string; ctaSub: string };
  return { ctaText: g.cta, ctaSubText: g.ctaSub };
}

/** Le parcours complet : ecran -> envoi -> fusion serveur. */
function enregistrer(
  metadata: Record<string, unknown>,
  modifs: { ctaText?: string; ctaSubText?: string },
) {
  const chargees = valeursDepuis(metadata);
  const valeurs = { ...chargees, ...modifs };
  const envoi = metadataPourEnregistrement(metadata, valeurs, chargees);
  return { envoi, apres: mergePostMetadata(metadata, envoi) as Record<string, unknown> };
}

describe('adaptateur — lecture alignee sur le resolveur', () => {
  for (const forme of FORMES) {
    it(`${forme.nom} : le champ CTA affiche le GROS texte, pas la petite ligne`, () => {
      const v = valeursDepuis(forme.metadata);
      expect(v.ctaText).toBe(forme.gros);
    });

    it(`${forme.nom} : parite exacte avec resoudreTextes`, () => {
      const attendu = resoudreTextes(forme.metadata);
      const v = valeursDepuis(forme.metadata);
      expect(v.ctaText).toBe(attendu.ctaPrincipal.valeur ?? '');
      expect(v.ctaSubText).toBe(attendu.ctaSecondaire.valeur ?? '');
    });

    it(`${forme.nom} : lire n'ecrit rien`, () => {
      const empreinte = JSON.stringify(forme.metadata);
      toWizardDraft({ metadata: forme.metadata });
      expect(JSON.stringify(forme.metadata)).toBe(empreinte);
    });
  }

  it('la petite ligne remonte quand le producteur en porte une', () => {
    for (const forme of FORMES) {
      const v = valeursDepuis(forme.metadata);
      expect(v.ctaSubText).toBe(forme.petit ?? '');
    }
  });
});

describe('adaptateur — enregistrer sans rien toucher', () => {
  for (const forme of FORMES) {
    it(`${forme.nom} : envoi vide et metadata profondement identique`, () => {
      const { envoi, apres } = enregistrer(forme.metadata, {});
      expect(envoi).toEqual({});
      expect(apres).toStrictEqual(forme.metadata);
    });
  }
});

describe('adaptateur — modifier UN seul texte', () => {
  for (const forme of FORMES) {
    it(`${forme.nom} : le CTA principal seul — la valeur gagne la relecture`, () => {
      const avant = resoudreTextes(forme.metadata);
      const { apres } = enregistrer(forme.metadata, { ctaText: 'NOUVEAU GROS' });
      const relu = resoudreTextes(apres);

      expect(relu.ctaPrincipal.valeur).toBe('NOUVEAU GROS');
      // Le sous-texte NE BOUGE PAS — c'est l'ecrasement que ce lot ferme.
      expect(relu.ctaSecondaire.valeur).toBe(avant.ctaSecondaire.valeur);
      // Le vrai filigrane non plus.
      expect(relu.filigrane.valeur).toBe(avant.filigrane.valeur);
      // Et l'ecran le relit.
      expect(valeursDepuis(apres).ctaText).toBe('NOUVEAU GROS');
    });

    it(`${forme.nom} : le CTA secondaire seul — la valeur gagne la relecture`, () => {
      const avant = resoudreTextes(forme.metadata);
      const { apres } = enregistrer(forme.metadata, { ctaSubText: 'NOUVELLE PETITE' });
      const relu = resoudreTextes(apres);

      expect(relu.ctaSecondaire.valeur).toBe('NOUVELLE PETITE');
      expect(relu.ctaPrincipal.valeur).toBe(avant.ctaPrincipal.valeur);
      expect(relu.filigrane.valeur).toBe(avant.filigrane.valeur);
      expect(valeursDepuis(apres).ctaSubText).toBe('NOUVELLE PETITE');
    });

    it(`${forme.nom} : le vrai filigrane est intact, octet pour octet`, () => {
      for (const modifs of [{ ctaText: 'X' }, { ctaSubText: 'Y' }]) {
        const { apres } = enregistrer(forme.metadata, modifs);
        const designAvant = (forme.metadata.design ?? {}) as Record<string, unknown>;
        const designApres = (apres.design ?? {}) as Record<string, unknown>;
        expect(designApres.siteText).toStrictEqual(designAvant.siteText);
      }
    });

    it(`${forme.nom} : aucune cle historique n'est supprimee`, () => {
      const { apres } = enregistrer(forme.metadata, { ctaText: 'X' });
      for (const bloc of ['branding', 'design'] as const) {
        const source = forme.metadata[bloc] as Record<string, unknown> | undefined;
        if (!source) continue;
        const cible = apres[bloc] as Record<string, unknown>;
        for (const cle of Object.keys(source)) {
          expect(Object.prototype.hasOwnProperty.call(cible, cle)).toBe(true);
        }
      }
      // `design.font` est la victime classique d'une fusion de premier niveau.
      const d = (forme.metadata.design ?? {}) as Record<string, unknown>;
      if (d.font !== undefined) {
        expect((apres.design as Record<string, unknown>).font).toBe(d.font);
      }
    });

    it(`${forme.nom} : les cles inconnues traversent intactes`, () => {
      const { apres } = enregistrer(forme.metadata, { ctaText: 'X' });
      expect(apres.champInconnu).toStrictEqual(INCONNU);
    });

    it(`${forme.nom} : l'objet source n'est jamais mute`, () => {
      const empreinte = JSON.stringify(forme.metadata);
      enregistrer(forme.metadata, { ctaText: 'X', ctaSubText: 'Y' });
      expect(JSON.stringify(forme.metadata)).toBe(empreinte);
    });

    it(`${forme.nom} : la chaine vide est une extinction relue`, () => {
      const { apres } = enregistrer(forme.metadata, { ctaText: '' });
      const relu = resoudreTextes(apres);
      expect(relu.ctaPrincipal.valeur).toBe('');
      expect(relu.ctaPrincipal.present).toBe(true);
      expect(valeursDepuis(apres).ctaText).toBe('');
    });
  }
});

describe('adaptateur — aller-retour ecran -> metadata -> ecran', () => {
  for (const forme of FORMES) {
    it(`${forme.nom} : les deux textes reviennent identiques`, () => {
      const { apres } = enregistrer(forme.metadata, {
        ctaText: 'GROS NEUF',
        ctaSubText: 'PETIT NEUF',
      });
      const v = valeursDepuis(apres);
      expect(v.ctaText).toBe('GROS NEUF');
      expect(v.ctaSubText).toBe('PETIT NEUF');

      // Deuxieme tour : un enregistrement sans modification ne bouge plus rien.
      const second = enregistrer(apres, {});
      expect(second.envoi).toEqual({});
      expect(second.apres).toStrictEqual(apres);
    });
  }
});

describe('adaptateur — creation d\'un contenu neuf', () => {
  it('les deux CTA partent dans les cles canoniques design.*', () => {
    const { apres } = enregistrer({}, { ctaText: 'GROS', ctaSubText: 'PETIT' });
    const relu = resoudreTextes(apres);
    expect(relu.ctaPrincipal.cle).toBe('design.ctaMainText');
    expect(relu.ctaSecondaire.cle).toBe('design.ctaSubText');
    // Le filigrane n'est pas invente, et `watermarkText` n'est pas cree.
    expect(relu.filigrane.valeur).toBeNull();
    const branding = (apres.branding ?? {}) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(branding, 'watermarkText')).toBe(false);
  });
});
