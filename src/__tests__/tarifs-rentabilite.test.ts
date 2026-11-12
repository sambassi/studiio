/**
 * RENTABILITÉ DES TARIFS — ce que la grille en vigueur gagne ou perd.
 *
 * Ces tests ne vérifient pas seulement du code : ils CONSTATENT l'économie
 * réelle de la grille codée (`TARIFS_DEFAUT`) face aux tarifs HeyGen vérifiés
 * (`tarifs-heygen.ts`). Si un prix change, un test tombe — c'est voulu : une
 * décision tarifaire ne doit pas pouvoir passer inaperçue.
 */
import { describe, expect, it } from 'vitest';
import { TARIFS_DEFAUT } from '@/lib/tarifs/catalogue';
import {
  MESSAGE_COUT_NON_VERIFIE,
  SECONDES_AVATAR_PIRE_CAS,
  analyserGrille,
  analyserTarif,
  coutVerifie,
  resumeRentabilite,
} from '@/lib/tarifs/rentabilite';

/** Les deux échelles en discussion, exprimées en CHF par crédit. */
const VALEUR_PRO = 49 / 600;      // abonnement Pro actuel : 0,0817 CHF
const VALEUR_ECHELLE_100 = 0.01;  // hypothèse « 100 crédits = 1 CHF »

describe('coût fournisseur vérifié', () => {
  it('borne la durée d’un avatar au plafond de script du serveur', () => {
    // 1200 caractères à 14 car/s = 86 s. Le pire cas facturable, pas une moyenne.
    expect(SECONDES_AVATAR_PIRE_CAS).toBe(86);
  });

  it('retient le type d’avatar le PLUS cher du moteur, jamais le moins cher', () => {
    // Avatar III : photo 0,99 $/min > twin 0,60 $/min.
    expect(coutVerifie('avatar.avatar_iii').usd).toBeCloseTo((86 / 60) * 0.99, 3);
    // Avatar IV : twin 4,83 $/min > photo 2,31 $/min.
    expect(coutVerifie('avatar.avatar_iv').usd).toBeCloseTo((86 / 60) * 4.83, 3);
    expect(coutVerifie('avatar.avatar_v').usd).toBeCloseTo((86 / 60) * 7.2, 3);
  });

  it('ne déclare JAMAIS zéro un coût non vérifié', () => {
    // wan-2.2-i2v-fast n'a pas de prix sur la grille publique Replicate.
    expect(coutVerifie('ai.image_to_video').usd).toBeNull();
    expect(coutVerifie('ai.image_to_video').source).toBe(MESSAGE_COUT_NON_VERIFIE);
    expect(coutVerifie('audio.full_1000_chars').usd).toBeNull();
  });

  it('reconnaît les rendus locaux comme réellement sans coût fournisseur', () => {
    expect(coutVerifie('render.reel').usd).toBe(0);
    expect(coutVerifie('render.tv').usd).toBe(0);
  });
});

describe('verdict suspendu plutôt que faux', () => {
  it('sans valeur de crédit configurée, aucun verdict', () => {
    const l = analyserTarif('avatar.avatar_v', { prix: TARIFS_DEFAUT, valeurCreditChf: null });
    expect(l.verdict).toBe('inconnu');
    expect(l.revenuChf).toBeNull();
  });

  it('sans taux de change configuré, le taux d’équilibre remplace le verdict', () => {
    const l = analyserTarif('avatar.avatar_v', { prix: TARIFS_DEFAUT, valeurCreditChf: VALEUR_PRO });
    expect(l.verdict).toBe('inconnu');
    expect(l.margeChf).toBeNull();
    // 40 crédits = 3,27 CHF pour 10,32 USD : rentable seulement sous 0,32 CHF/USD.
    expect(l.tauxEquilibreChfParUsd).toBeCloseTo(0.317, 2);
  });

  it('un coût saisi en CHF par l’admin tranche sans aucun taux', () => {
    const l = analyserTarif('avatar.avatar_iv', {
      prix: TARIFS_DEFAUT,
      valeurCreditChf: VALEUR_PRO,
      coutsFournisseur: { 'avatar.avatar_iv': { chf: 6, unite: '1 vidéo' } },
    });
    expect(l.verdict).toBe('perte');
    expect(l.margeChf).toBeCloseTo(40 * VALEUR_PRO - 6, 2);
  });
});

describe('état économique de la grille codée', () => {
  // Taux volontairement FAVORABLE à Studiio : 1 USD = 0,80 CHF. Les pertes
  // constatées ci-dessous tiennent donc a fortiori à un taux plus élevé.
  const taux = 0.8;

  it('Avatar III à 40 crédits couvre son coût', () => {
    const l = analyserTarif('avatar.avatar_iii', { prix: TARIFS_DEFAUT, valeurCreditChf: VALEUR_PRO, tauxChfParUsd: taux });
    expect(l.verdict).toBe('rentable');
  });

  it('Avatar IV, Avatar V et le Jumeau sont vendus à perte à 40 crédits', () => {
    for (const cle of ['avatar.avatar_iv', 'avatar.avatar_v', 'avatar.jumeau'] as const) {
      const l = analyserTarif(cle, { prix: TARIFS_DEFAUT, valeurCreditChf: VALEUR_PRO, tauxChfParUsd: taux });
      expect(l.verdict, cle).toBe('perte');
      expect(l.margeChf, cle).toBeLessThan(0);
    }
  });

  it('l’échelle « 100 crédits = 1 CHF » aggrave la perte si les prix ne sont pas remontés', () => {
    const avant = analyserTarif('avatar.avatar_iii', { prix: TARIFS_DEFAUT, valeurCreditChf: VALEUR_PRO, tauxChfParUsd: taux });
    const apres = analyserTarif('avatar.avatar_iii', { prix: TARIFS_DEFAUT, valeurCreditChf: VALEUR_ECHELLE_100, tauxChfParUsd: taux });
    expect(avant.verdict).toBe('rentable');
    expect(apres.verdict).toBe('perte');
  });

  it('le résumé nomme les tarifs à perte et ceux vendus à l’aveugle', () => {
    const r = resumeRentabilite(analyserGrille({ prix: TARIFS_DEFAUT, valeurCreditChf: VALEUR_PRO, tauxChfParUsd: taux }));
    expect(r.clesEnPerte).toContain('avatar.avatar_v');
    expect(r.clesSansCout).toContain('audio.full_1000_chars');
    expect(r.pertes + r.inconnus + r.rentables).toBe(analyserGrille({ prix: TARIFS_DEFAUT, valeurCreditChf: VALEUR_PRO }).length);
  });
});
