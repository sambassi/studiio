import { describe, it, expect } from 'vitest';
import {
  metadataPourEnregistrement, type ValeursWizard,
} from '../lib/creer/postMetadata/from-wizard';
import { mergePostMetadata } from '../lib/creer/postMetadata';
import { toWizardDraft } from '../lib/creer/postMetadata/to-wizard';

/**
 * PROVENANCE : une valeur lue dans une clé n'est réécrite que dans CETTE clé.
 *
 * Le piège que ces tests ferment est une confusion de vocabulaire entre deux
 * producteurs, documentée dans le compositeur lui-même :
 *
 *   BIG  text -> `design.ctaMainText` ET `branding.watermarkText`
 *   Sub  text -> `design.ctaSubTextDesign` ET `branding.ctaText`
 *
 * Autrement dit `branding.ctaText` porte la PETITE ligne, pas le gros CTA.
 * L'assistant la lisait et l'affichait comme CTA principal, puis la réécrivait
 * à cet endroit : le gros texte d'un post était remplacé par sa petite ligne —
 * sans rien afficher, sans erreur, et sans retour possible, la colonne `jsonb`
 * n'ayant pas d'historique.
 *
 * Les deux adaptateurs passent désormais par le RÉSOLVEUR CANONIQUE, qui
 * tranche par la FORME des clés et non par leur nom. Sur le post ci-dessous,
 * le gros texte est donc `design.ctaMainText` (« MARQUE ») et la petite ligne
 * `design.ctaSubText` (« SUIVEZ-NOUS ») — et c'est bien dans CES clés-là que
 * l'écriture retourne.
 *
 * La règle est donc double :
 *
 *   1. AUCUNE SYNCHRONISATION entre deux clés au prétexte qu'elles se
 *      ressembleraient. `watermarkText` ne se déduit de rien.
 *   2. SEUL CE QUE L'UTILISATEUR A CHANGÉ PART. Ouvrir puis enregistrer sans
 *      rien toucher doit rendre un objet profondément identique.
 */

/** Post produit par l'éditeur avancé : les deux conventions y coexistent. */
const META_AVANCE = {
  subtitle: 'sous-titre',
  theme: 'sport',
  cards: [{ emoji: 'Flame', label: 'A', value: '1', description: 'd' }],
  branding: {
    accentColor: '#7C3AED',
    ctaText: 'SUIVEZ-NOUS',
    ctaSubText: 'LIEN EN BIO',
    watermarkText: 'MARQUE',
  },
  design: {
    ctaMainText: 'MARQUE',
    ctaSubText: 'SUIVEZ-NOUS',
    font: 'Anton',
    siteText: { text: 'studiio.pro', opacity: 0.5 },
  },
  // Clé que personne ne déclare : elle doit traverser intacte.
  cron_publish_results: [{ ok: true }],
};

/**
 * Ce que le parcours porte à l'écran juste après le chargement.
 *
 * `Draft.generated` est typé `unknown` — le brouillon est relu depuis le
 * stockage, donc rien n'y est garanti. On le rétrécit ici plutôt que de le
 * supposer.
 */
interface ContenuAffiche { subtitle?: string; cta?: string; ctaSub?: string }

function valeursChargees(): ValeursWizard {
  const draft = toWizardDraft({ id: 'p1', title: 'TITRE', metadata: META_AVANCE });
  const contenu = (draft.generated ?? {}) as ContenuAffiche;
  return {
    subtitle: contenu.subtitle,
    theme: draft.themeId,
    ctaText: contenu.cta,
    ctaSubText: contenu.ctaSub,
  };
}

describe('A. ouvrir puis enregistrer sans rien modifier', () => {
  it('ne produit AUCUNE écriture de metadata', () => {
    const base = valeursChargees();
    const envoi = metadataPourEnregistrement(META_AVANCE, base, base);
    expect(envoi).toEqual({});
  });

  it('après fusion serveur, l\'objet est profondément identique', () => {
    const base = valeursChargees();
    const envoi = metadataPourEnregistrement(META_AVANCE, base, base);
    const apres = mergePostMetadata(META_AVANCE, envoi);
    expect(apres).toEqual(META_AVANCE);
  });

  it('« MARQUE » reste aux deux emplacements où il vivait', () => {
    const base = valeursChargees();
    const apres = mergePostMetadata(
      META_AVANCE,
      metadataPourEnregistrement(META_AVANCE, base, base),
    ) as Record<string, any>;
    expect(apres.branding.watermarkText).toBe('MARQUE');
    expect(apres.design.ctaMainText).toBe('MARQUE');
  });

  it('aucune clé ajoutée, supprimée ni déplacée', () => {
    const base = valeursChargees();
    const apres = mergePostMetadata(
      META_AVANCE,
      metadataPourEnregistrement(META_AVANCE, base, base),
    ) as Record<string, any>;
    expect(Object.keys(apres).sort()).toEqual(Object.keys(META_AVANCE).sort());
    expect(Object.keys(apres.branding).sort()).toEqual(Object.keys(META_AVANCE.branding).sort());
    expect(Object.keys(apres.design).sort()).toEqual(Object.keys(META_AVANCE.design).sort());
  });
});

describe('B. modifier uniquement le CTA principal affiché', () => {
  it('seule la clé D\'OÙ IL VIENT change', () => {
    const base = valeursChargees();
    const envoi = metadataPourEnregistrement(
      META_AVANCE, { ...base, ctaText: 'NOUVEAU' }, base,
    ) as Record<string, any>;
    // La provenance du GROS texte sur cette forme est `design.ctaMainText`.
    expect(envoi.design.ctaMainText).toBe('NOUVEAU');
    // `mergePostMetadata` fusionne au PREMIER NIVEAU : un `design` envoyé
    // remplace le bloc entier. Les voisins doivent donc y figurer — mais avec
    // leur valeur D'ORIGINE, jamais dérivée du CTA. C'est la distinction qui
    // compte : recopier n'est pas synchroniser.
    expect(envoi.design.ctaSubText).toBe('SUIVEZ-NOUS');
    expect(envoi.design.font).toBe('Anton');
    expect(envoi.design.siteText).toEqual({ text: 'studiio.pro', opacity: 0.5 });
    // `branding` n'a aucune raison de partir : rien de ce qu'il porte n'a bougé.
    // Son `watermarkText` reste donc sur l'ancienne valeur — non synchronisé.
    expect(envoi).not.toHaveProperty('branding');
  });

  it('le filigrane et le CTA secondaire restent strictement inchangés', () => {
    const base = valeursChargees();
    const apres = mergePostMetadata(
      META_AVANCE,
      metadataPourEnregistrement(META_AVANCE, { ...base, ctaText: 'NOUVEAU' }, base),
    ) as Record<string, any>;
    expect(apres.design.ctaMainText).toBe('NOUVEAU');
    // Aucune synchronisation : le jumeau historique garde sa valeur.
    expect(apres.branding.watermarkText).toBe('MARQUE');
    expect(apres.branding.ctaText).toBe('SUIVEZ-NOUS');
    expect(apres.branding.ctaSubText).toBe('LIEN EN BIO');
    // La petite ligne ne bouge pas — c'est l'écrasement que ce lot ferme.
    expect(apres.design.ctaSubText).toBe('SUIVEZ-NOUS');
    expect(apres.design.siteText).toEqual({ text: 'studiio.pro', opacity: 0.5 });
  });
});

describe('C. modifier uniquement le CTA secondaire affiché', () => {
  it('le filigrane et le CTA principal ne bougent pas', () => {
    const base = valeursChargees();
    const apres = mergePostMetadata(
      META_AVANCE,
      metadataPourEnregistrement(META_AVANCE, { ...base, ctaSubText: 'AUTRE' }, base),
    ) as Record<string, any>;
    // La provenance de la PETITE ligne sur cette forme est `design.ctaSubText`.
    expect(apres.design.ctaSubText).toBe('AUTRE');
    // Le gros texte et ses jumeaux historiques ne bougent pas.
    expect(apres.design.ctaMainText).toBe('MARQUE');
    expect(apres.branding.watermarkText).toBe('MARQUE');
    expect(apres.branding.ctaText).toBe('SUIVEZ-NOUS');
    expect(apres.branding.ctaSubText).toBe('LIEN EN BIO');
    expect(apres.design.siteText).toEqual({ text: 'studiio.pro', opacity: 0.5 });
  });
});

describe('D. le filigrane ne se déduit de rien', () => {
  it('même en changeant les quatre clés voisines, il n\'est jamais écrit', () => {
    const base = valeursChargees();
    const envoi = metadataPourEnregistrement(
      META_AVANCE,
      { ...base, ctaText: 'X', ctaSubText: 'Y', subtitle: 'Z', theme: 'nutrition' },
      base,
    ) as Record<string, any>;
    // Le VRAI filigrane — `design.siteText` — n'est jamais écrit, quoi qu'il
    // arrive aux quatre clés voisines.
    expect(envoi.design.siteText).toEqual({ text: 'studiio.pro', opacity: 0.5 });
    // `branding` n'a AUCUNE raison de partir : aucune des trois clés qu'il
    // porte n'est la provenance d'un des deux CTA sur cette forme. Le dire
    // ainsi, plutôt que par un `?.` complaisant, est ce qui rend l'assertion
    // vraie : `watermarkText` n'est pas synchronisé, il n'est pas envoyé.
    expect(envoi).not.toHaveProperty('branding');
    // Et les deux textes ne s'inversent pas en chemin : chacun atterrit dans
    // SA provenance, avec SA valeur.
    expect(envoi.design.ctaMainText).toBe('X');
    expect(envoi.design.ctaSubText).toBe('Y');
    for (const nouvelle of ['X', 'Y', 'Z']) {
      expect(envoi.design.siteText.text).not.toBe(nouvelle);
    }
  });
});

describe('E. valeurs falsy et clés inconnues', () => {
  it('un sous-titre vidé exprès part bien vide', () => {
    const base = valeursChargees();
    const envoi = metadataPourEnregistrement(
      META_AVANCE, { ...base, subtitle: '' }, base,
    ) as Record<string, any>;
    expect(envoi.subtitle).toBe('');
  });

  it('les clés que personne ne déclare survivent', () => {
    const base = valeursChargees();
    const apres = mergePostMetadata(
      META_AVANCE,
      metadataPourEnregistrement(META_AVANCE, { ...base, subtitle: '' }, base),
    ) as Record<string, any>;
    expect(apres.cron_publish_results).toEqual([{ ok: true }]);
    expect(apres.design.siteText).toEqual({ text: 'studiio.pro', opacity: 0.5 });
    expect(apres.design.font).toBe('Anton');
  });

  it('ne modifie ni la metadata existante, ni les valeurs reçues', () => {
    const base = valeursChargees();
    const copie = JSON.parse(JSON.stringify(META_AVANCE));
    metadataPourEnregistrement(META_AVANCE, { ...base, ctaText: 'X' }, base);
    expect(META_AVANCE).toEqual(copie);
  });
});
