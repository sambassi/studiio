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
 * L'assistant, lui, lit `branding.ctaText` et l'affiche comme CTA principal.
 * Tant qu'il se contentait de lire, cela n'avait aucune conséquence. En
 * réécrivant `watermarkText` depuis cette valeur, il remplaçait le gros texte
 * d'un post par sa petite ligne — sans rien afficher, sans erreur, et sans
 * retour possible : la colonne `jsonb` n'a pas d'historique.
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
    expect(envoi.branding.ctaText).toBe('NOUVEAU');
    // `mergePostMetadata` fusionne au PREMIER NIVEAU : un `branding` envoyé
    // remplace le bloc entier. Les voisins doivent donc y figurer — mais avec
    // leur valeur D'ORIGINE, jamais dérivée du CTA. C'est la distinction qui
    // compte : recopier n'est pas synchroniser.
    expect(envoi.branding.watermarkText).toBe('MARQUE');
    expect(envoi.branding.watermarkText).not.toBe('NOUVEAU');
    // `design` n'a aucune raison de partir : rien de ce qu'il porte n'a bougé.
    expect(envoi).not.toHaveProperty('design');
  });

  it('le filigrane et le CTA secondaire restent strictement inchangés', () => {
    const base = valeursChargees();
    const apres = mergePostMetadata(
      META_AVANCE,
      metadataPourEnregistrement(META_AVANCE, { ...base, ctaText: 'NOUVEAU' }, base),
    ) as Record<string, any>;
    expect(apres.branding.watermarkText).toBe('MARQUE');
    expect(apres.design.ctaMainText).toBe('MARQUE');
    expect(apres.branding.ctaSubText).toBe('LIEN EN BIO');
    expect(apres.design.ctaSubText).toBe('SUIVEZ-NOUS');
  });
});

describe('C. modifier uniquement le CTA secondaire affiché', () => {
  it('le filigrane et le CTA principal ne bougent pas', () => {
    const base = valeursChargees();
    const apres = mergePostMetadata(
      META_AVANCE,
      metadataPourEnregistrement(META_AVANCE, { ...base, ctaSubText: 'AUTRE' }, base),
    ) as Record<string, any>;
    expect(apres.branding.ctaSubText).toBe('AUTRE');
    expect(apres.branding.watermarkText).toBe('MARQUE');
    expect(apres.design.ctaMainText).toBe('MARQUE');
    expect(apres.branding.ctaText).toBe('SUIVEZ-NOUS');
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
    // Les deux clés peuvent VOYAGER (la fusion est de surface), mais jamais
    // avec la valeur d'une autre : elles gardent exactement ce qu'elles avaient.
    expect(envoi.branding.watermarkText).toBe('MARQUE');
    expect(envoi.design?.ctaMainText ?? 'MARQUE').toBe('MARQUE');
    for (const nouvelle of ['X', 'Y', 'Z']) {
      expect(envoi.branding.watermarkText).not.toBe(nouvelle);
      expect(envoi.design?.ctaMainText).not.toBe(nouvelle);
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
