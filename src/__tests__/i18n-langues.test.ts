/**
 * LANGUES — repli par clé, et aucune langue proposée à moitié traduite.
 *
 * Trois règles tenues ici, chacune apprise d'un défaut réel :
 *
 *  1. Une clé manquante ne doit JAMAIS afficher son chemin technique. C'est
 *     ce que faisait `useTranslations` (`return path`) : un catalogue
 *     incomplet montrait `billing.transactionHistory` à l'écran.
 *  2. Une langue n'est proposée dans le sélecteur que si elle est
 *     réellement traduite (`SEUIL_AFFICHAGE_LANGUE`).
 *  3. Une langue qui a dépassé le seuil sans être ajoutée au sélecteur est
 *     signalée : le travail de traduction ne doit pas rester invisible.
 */
import { describe, expect, it } from 'vitest';
import {
  SEUIL_AFFICHAGE_LANGUE, locales, localeFlags, localeIntl, localeIso639_3,
  localeNames, localesProposees, languesCompletes, defaultLocale, type Locale,
} from '@/i18n/config';
import { cheminsDeCles, couverture, fusionnerMessages } from '@/i18n/fusion';

import fr from '../../messages/fr.json';
import en from '../../messages/en.json';
import de from '../../messages/de.json';
import wo from '../../messages/wo.json';
import ln from '../../messages/ln.json';
import sw from '../../messages/sw.json';
import bm from '../../messages/bm.json';
import bas from '../../messages/bas.json';
import ht from '../../messages/ht.json';

const CATALOGUES: Record<Locale, Record<string, unknown>> = {
  fr: fr as never, en: en as never, de: de as never, wo: wo as never,
  ln: ln as never, sw: sw as never, bm: bm as never, bas: bas as never, ht: ht as never,
};

describe('déclaration des langues', () => {
  it('chaque langue déclarée a un catalogue, un nom, un drapeau et une étiquette Intl', () => {
    for (const l of locales) {
      expect(CATALOGUES[l], l).toBeTruthy();
      expect(localeNames[l], l).toBeTruthy();
      expect(localeFlags[l], l).toBeTruthy();
      expect(localeIntl[l], l).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('les langues partielles portent leur code ISO 639-3, qui lève l’ambiguïté du code à deux lettres', () => {
    for (const l of locales) {
      if (languesCompletes.includes(l)) continue;
      expect(localeIso639_3[l], l).toMatch(/^[a-z]{3}$/);
    }
  });

  it('le français est la langue par défaut et le socle de repli', () => {
    expect(defaultLocale).toBe('fr');
    expect(localesProposees).toContain('fr');
  });
});

describe('repli par clé', () => {
  const clesFr = cheminsDeCles(fr as never);

  it('toute langue fusionnée sur le français couvre TOUTES les clés', () => {
    for (const l of locales) {
      const fusion = fusionnerMessages(fr as never, CATALOGUES[l]);
      expect(cheminsDeCles(fusion), l).toEqual(expect.arrayContaining(clesFr));
    }
  });

  it('une traduction présente gagne sur le français', () => {
    const fusion = fusionnerMessages({ paiement: { prix: 'Prix', credits: 'Crédits' } }, { paiement: { prix: 'Njëg' } });
    expect(fusion).toEqual({ paiement: { prix: 'Njëg', credits: 'Crédits' } });
  });

  it('une chaîne vide n’est pas une traduction : le français est conservé', () => {
    const fusion = fusionnerMessages({ a: 'Bonjour', b: 'Merci' }, { a: '', b: '   ' });
    expect(fusion).toEqual({ a: 'Bonjour', b: 'Merci' });
  });

  it('aucune valeur fusionnée n’est un chemin de clé technique', () => {
    for (const l of locales) {
      const fusion = fusionnerMessages(fr as never, CATALOGUES[l]);
      for (const chemin of clesFr) {
        const valeur = chemin.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], fusion);
        expect(typeof valeur === 'string' || typeof valeur === 'object', `${l} → ${chemin}`).toBe(true);
        if (typeof valeur === 'string') expect(valeur, `${l} → ${chemin}`).not.toBe(chemin);
      }
    }
  });
});

describe('seuil d’affichage', () => {
  it('toute langue PROPOSÉE est réellement traduite', () => {
    for (const l of localesProposees) {
      const c = l === 'fr' ? 1 : couverture(fr as never, CATALOGUES[l]);
      expect(c, `${l} : couverture ${Math.round(c * 100)} %`).toBeGreaterThanOrEqual(SEUIL_AFFICHAGE_LANGUE);
    }
  });

  it('une langue non proposée est sous le seuil — sinon il faut l’ajouter au sélecteur', () => {
    for (const l of locales) {
      if (localesProposees.includes(l)) continue;
      const c = couverture(fr as never, CATALOGUES[l]);
      expect(c, `${l} atteint ${Math.round(c * 100)} % : à ajouter à localesProposees`).toBeLessThan(SEUIL_AFFICHAGE_LANGUE);
    }
  });

  it('les six langues partielles portent au moins le terme repris d’afroboost', () => {
    for (const l of ['wo', 'ln', 'sw', 'bm', 'bas', 'ht'] as Locale[]) {
      const prix = (CATALOGUES[l].paiement as { prix?: unknown } | undefined)?.prix;
      expect(typeof prix, l).toBe('string');
      expect(String(prix).trim(), l).not.toBe('');
      // Et ce n'est pas le mot français recopié.
      expect(String(prix), l).not.toBe('Prix');
    }
  });
});

describe('vocabulaire du commerce', () => {
  it('les trois langues complètes ont le même jeu de clés de paiement', () => {
    const clesFr = cheminsDeCles((fr as never as { paiement: Record<string, unknown> }).paiement);
    for (const l of languesCompletes) {
      const bloc = (CATALOGUES[l] as { paiement?: Record<string, unknown> }).paiement;
      expect(bloc, l).toBeTruthy();
      expect(cheminsDeCles(bloc as Record<string, unknown>), l).toEqual(clesFr);
    }
  });

  it('couvre abonnement, recharge, solde insuffisant, frais, historique et types de transaction', () => {
    const p = (fr as never as { paiement: Record<string, unknown> }).paiement;
    for (const cle of ['abonnement', 'rechargeTitre', 'soldeInsuffisant', 'frais', 'historique', 'manque', 'operationCout']) {
      expect(p[cle], cle).toBeTruthy();
    }
    expect(cheminsDeCles(p.types as Record<string, unknown>)).toEqual(
      ['abonnement', 'achat', 'bonus', 'remboursement', 'rendu'],
    );
  });

  it('les montants interpolés passent par un paramètre, jamais par une concaténation figée', () => {
    const p = (fr as never as { paiement: Record<string, string> }).paiement;
    expect(p.manque).toContain('{count}');
    expect(p.operationCout).toContain('{count}');
    expect(p.tauxDu).toContain('{date}');
  });
});
