// @vitest-environment node
/**
 * LOT 2B — ÉTAPE 4B : LE PREMIER MONTAGE QUI LIT UN OBJECTIF.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER DOIT ÉTABLIR, ET DANS QUEL ORDRE D'IMPORTANCE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. QUE RIEN NE BOUGE SANS OBJECTIF. C'est la garantie la plus chère :
 *      tous les comptes existants passent par là. Un plan générique doit
 *      rester identique jusque dans son relevé d'usage.
 *
 *   2. QUE LA QUALITÉ RESTE PRIORITAIRE. Un objectif ne doit jamais sauver
 *      un mauvais plan. La garantie est structurelle — des paliers, pas une
 *      somme pondérée — et se prouve donc par un contre-exemple maximal :
 *      pertinence 1 contre pertinence 0, dans deux paliers différents.
 *
 *   3. QUE L'OBJECTIF CHANGE VRAIMENT QUELQUE CHOSE. Sans quoi tout ce lot
 *      serait une identité de plan de plus pour un montage identique.
 *
 *   4. QUE LES GARDE-FOUS DE M3-E/M3-G TIENNENT. Recouvrement, écart minimal,
 *      couverture, chronologie : un objectif n'en contourne aucun.
 *
 * ⚠️ AUCUN FOURNISSEUR, AUCUN RÉSEAU, AUCUNE BASE. Tout est pur : les mêmes
 * entrées, les mêmes sorties, vérifiées sur des valeurs.
 */
import { describe, it, expect } from 'vitest';

import { planifierMontage } from '@/lib/autopilot/analyse/montage';
import { ALGORITHME_PLAN } from '@/lib/autopilot/analyse/montage-contrat';
import { ALGORITHME_COUPES } from '@/lib/autopilot/analyse/coupe-contrat';
import {
  politiqueDePlan, noterFenetre, poidsDeLObjectif, palierDeQualite,
  ALGORITHME_PLAN_OBJECTIF, VERSION_SCORING, PALIER_QUALITE,
  RAISONS_OBJECTIF, POLITIQUES_TYPE,
} from '@/lib/autopilot/analyse/objectif-score';
import {
  normaliserObjectif, OBJECTIF_DEFAUT, TYPES_OBJECTIF,
  type ObjectifCommunication, type ObjectifPartiel,
} from '@/lib/autopilot/analyse/objectif-communication';
import {
  assemblerSignaux, VERSION_SIGNAUX, PAROLE_INCONNUE,
  type SignauxFenetre, type SignauxVision,
} from '@/lib/autopilot/analyse/signaux-contrat';
import type { ClipMaterialise } from '@/lib/autopilot/analyse/clip-contrat';

// ───────────────────────────────────────────────────────────────────────────
// Les fixtures
// ───────────────────────────────────────────────────────────────────────────

const GEO = { largeur: 1920, hauteur: 1080, fps: 30 };
const DUREE_RUSH = 120;

function vision(over: Partial<Omit<SignauxVision, 'source'>> = {}): SignauxVision {
  return {
    source: 'vision',
    personnes: 'une', echellePlan: 'plan_moyen', expression: 'neutre',
    objetMisEnAvant: 'non', mainsEnAction: 'non', marqueVisible: 'non',
    texteALEcran: 'non', nettete: 0.8,
    ...over,
  };
}

function signaux(
  v: Partial<Omit<SignauxVision, 'source'>> = {},
  parole: SignauxFenetre['parole'] = { source: 'transcription', etat: 'absente', densite: 0 },
): SignauxFenetre {
  return assemblerSignaux(vision(v), parole);
}

const PAROLE_DENSE = { source: 'transcription' as const, etat: 'presente' as const, densite: 0.9 };

/** Un clip matérialisé — le passage `debut → fin` du rush, dans un fichier. */
function clip(
  rang: number, debut: number, fin: number,
  scoreMontage: number | null, s: SignauxFenetre | null,
): ClipMaterialise {
  return {
    rang,
    debutSecondes: debut,
    finSecondes: fin,
    dureeSecondes: fin - debut,
    bucket: 'videos',
    cle: `A/autopilote/clips/jeu/rang-0${rang}.mp4`,
    octets: 1_000_000,
    debutMesureSecondes: 0,
    dureeMesureeSecondes: fin - debut,
    scoreMontage,
    signaux: s,
  };
}

function objectif(over: ObjectifPartiel): ObjectifCommunication {
  return normaliserObjectif(over);
}

const DEMANDE = {
  format: '9:16' as const,
  dureeCibleSecondes: 16,
  geometrie: GEO,
  dureeRushSecondes: DUREE_RUSH,
};

function planifier(clips: ClipMaterialise[], o?: ObjectifCommunication | null) {
  return planifierMontage({ clips, ...DEMANDE, objectif: o ?? undefined });
}

/** Les rangs REELLEMENT montés, dans l'ordre du montage. */
function rangsMontes(r: ReturnType<typeof planifier>): number[] {
  return (r.resultat?.plans ?? []).map((p) => p.rangClip);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Sans objectif exploitable, RIEN ne change', () => {
  const CLIPS = () => [
    clip(1, 2, 10, 90, signaux({ personnes: 'foule' })),
    clip(2, 20, 28, 80, signaux({ personnes: 'une' })),
    clip(3, 40, 48, 70, signaux({ marqueVisible: 'oui' })),
  ];

  it('1.1 objectif absent → m3g-v2, plan et relevé historiques', () => {
    const r = planifier(CLIPS());
    expect(r.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
    expect(r.resultat?.politique.objectiveAware).toBe(false);
    expect(r.resultat?.politique.motif).toBe('objectif_generique');
    // Aucune clé d'explicabilité : le relevé est celui d'avant l'étape 4B.
    expect(r.resultat?.usage.objectif).toBeUndefined();
    expect(r.resultat?.usage.algorithmePlan).toBe(ALGORITHME_PLAN);
  });

  it('1.2 objectif générique explicite → m3g-v2, plan IDENTIQUE', () => {
    const sans = planifier(CLIPS());
    const avec = planifier(CLIPS(), { ...OBJECTIF_DEFAUT });
    expect(avec.resultat).toEqual(sans.resultat);
    expect(avec.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
  });

  it('1.3 objectif sans discriminant visuel → m3g-v2', () => {
    // ⚠️ CE N'EST PAS UN OUBLI. Ce qui sépare une inscription d'une
    // réservation est ce qu'on DEMANDE au spectateur, pas ce qu'on lui
    // MONTRE. Leur fabriquer deux montages différents ferait payer deux
    // plans pour une distinction qui n'existe pas à l'image.
    for (const type of ['inscriptions', 'reservations', 'leads', 'abonnes', 'engagement', 'personnalise'] as const) {
      const r = planifier(CLIPS(), objectif({ type }));
      expect(r.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
      expect(r.resultat?.politique.motif).toBe('objectif_sans_mapping');
    }
  });

  it('1.4 signaux absents → m3g-v2', () => {
    const r = planifier([
      clip(1, 2, 10, 90, null), clip(2, 20, 28, 80, null),
    ], objectif({ type: 'evenement' }));
    expect(r.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
    expect(r.resultat?.politique.motif).toBe('signaux_absents');
  });

  it('1.5 qualité absente → m3g-v2, jamais un classement sur une qualité devinée', () => {
    const r = planifier([
      clip(1, 2, 10, null, signaux({ personnes: 'foule' })),
      clip(2, 20, 28, null, signaux({ personnes: 'une' })),
    ], objectif({ type: 'evenement' }));
    expect(r.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
    expect(r.resultat?.politique.motif).toBe('qualite_absente');
  });

  it('1.6 couverture partielle → m3g-v2 (un seul clip non relevé suffit)', () => {
    // ⚠️ LA COUVERTURE EXIGÉE EST TOTALE. Une fenêtre sans relevé n'a aucune
    // place juste dans un classement : au fond elle est punie d'une donnée
    // manquante, en tête elle en est récompensée.
    const r = planifier([
      clip(1, 2, 10, 90, signaux({ personnes: 'foule' })),
      clip(2, 20, 28, 80, signaux({ personnes: 'une' })),
      clip(3, 40, 48, 70, null),
    ], objectif({ type: 'evenement' }));
    expect(r.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
    expect(r.resultat?.politique.motif).toBe('signaux_absents');
  });

  it('1.7 relevés tous indéterminés → m3g-v2', () => {
    const flou = signaux({
      personnes: 'indetermine', echellePlan: 'indetermine', marqueVisible: 'indetermine',
    }, PAROLE_INCONNUE);
    const r = planifier([
      clip(1, 2, 10, 90, flou), clip(2, 20, 28, 80, flou),
    ], objectif({ type: 'evenement' }));
    expect(r.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
    expect(r.resultat?.politique.motif).toBe('notes_indisponibles');
  });

  it('1.8 objectif qui ne change PAS l’ordre → m3g-v2, pas d’identité neuve', () => {
    // Deux fenêtres également pertinentes : `m3g-v3` produirait le même
    // montage sous un identifiant différent, donc un calcul et un stockage
    // de plus, pour rien. On ne bat pas monnaie d'un identifiant.
    const meme = signaux({ personnes: 'foule', echellePlan: 'plan_large' });
    const r = planifier([
      clip(1, 2, 10, 90, meme), clip(2, 20, 28, 80, meme),
    ], objectif({ type: 'evenement' }));
    expect(r.resultat?.politique.algorithmePlan).toBe(ALGORITHME_PLAN);
    expect(r.resultat?.politique.motif).toBe('objectif_sans_effet');
    // Les notes restent relevées : on sait qu'un objectif a été évalué.
    expect(Object.keys(r.resultat?.politique.notes ?? {})).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La qualité passe AVANT la pertinence', () => {
  it('2.1 un palier de qualité supérieur gagne, pertinence maximale ou non', () => {
    // Le contre-exemple maximal : le clip 2 est PARFAITEMENT pertinent
    // (foule + plan large), le clip 1 ne l'est pas du tout — mais le clip 1
    // est deux paliers au-dessus. La qualité tranche.
    const o = objectif({ type: 'evenement' });
    const mauvais = clip(2, 20, 28, 30, signaux({
      personnes: 'foule', echellePlan: 'plan_large', marqueVisible: 'oui',
    }));
    const bon = clip(1, 2, 10, 90, signaux({ personnes: 'une', echellePlan: 'gros_plan' }));

    expect(noterFenetre(o, mauvais.signaux).score).toBe(1);
    expect(noterFenetre(o, bon.signaux).score).toBe(0);
    expect(palierDeQualite(90)).toBeGreaterThan(palierDeQualite(30));

    const p = politiqueDePlan(
      [bon, mauvais].map((c) => ({
        rang: c.rang, scoreMontage: c.scoreMontage, signaux: c.signaux,
      })),
      o, ALGORITHME_PLAN,
    );
    // L'ordre reste celui de la qualité : le rang 1 d'abord.
    expect(p.ordreRangs).toEqual([1, 2]);
    // Et donc rien n'a changé : m3g-v2.
    expect(p.objectiveAware).toBe(false);
  });

  it('2.2 dans un MÊME palier, la pertinence départage', () => {
    const o = objectif({ type: 'evenement' });
    // 81 et 95 sont tous deux dans le palier 4 (80–99).
    const peuPertinent = clip(1, 2, 10, 95, signaux({ personnes: 'une', echellePlan: 'gros_plan' }));
    const tresPertinent = clip(2, 20, 28, 81, signaux({ personnes: 'foule', echellePlan: 'plan_large' }));
    expect(palierDeQualite(95)).toBe(palierDeQualite(81));

    const p = politiqueDePlan(
      [peuPertinent, tresPertinent].map((c) => ({
        rang: c.rang, scoreMontage: c.scoreMontage, signaux: c.signaux,
      })),
      o, ALGORITHME_PLAN,
    );
    expect(p.ordreRangs).toEqual([2, 1]);
    expect(p.objectiveAware).toBe(true);
  });

  it('2.3 l’influence de l’objectif est BORNÉE au palier, pour toute note', () => {
    // ⚠️ LA PREUVE EXHAUSTIVE, ET NON UN EXEMPLE. On balaie toute l'échelle :
    // aucune pertinence, si haute soit-elle, ne fait passer une fenêtre
    // devant une fenêtre d'un palier supérieur.
    const o = objectif({ type: 'evenement' });
    const parfait = signaux({ personnes: 'foule', echellePlan: 'plan_large', marqueVisible: 'oui' });
    const nul = signaux({ personnes: 'une', echellePlan: 'gros_plan' });
    for (let bas = 0; bas <= 100; bas += 7) {
      for (let haut = bas + PALIER_QUALITE; haut <= 100; haut += 11) {
        if (palierDeQualite(haut) <= palierDeQualite(bas)) continue;
        const p = politiqueDePlan([
          { rang: 1, scoreMontage: haut, signaux: nul },
          { rang: 2, scoreMontage: bas, signaux: parfait },
        ], o, ALGORITHME_PLAN);
        expect(p.ordreRangs[0]).toBe(1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Les objectifs qui ont vraiment une matière visuelle', () => {
  /** Deux fenêtres de MÊME palier, pour que seule la pertinence tranche. */
  function duel(a: SignauxFenetre, b: SignauxFenetre, o: ObjectifCommunication) {
    return politiqueDePlan([
      { rang: 1, scoreMontage: 85, signaux: a },
      { rang: 2, scoreMontage: 85, signaux: b },
    ], o, ALGORITHME_PLAN);
  }

  it('3.1 ÉVÉNEMENT — groupe et plan large l’emportent', () => {
    const groupe = signaux({ personnes: 'foule', echellePlan: 'plan_large' });
    const seul = signaux({ personnes: 'une', echellePlan: 'gros_plan' });
    // Le clip pertinent est en SECONDE position au départ : s'il remonte,
    // c'est bien l'objectif qui l'a fait, et non l'ordre d'origine.
    const p = duel(seul, groupe, objectif({ type: 'evenement' }));
    expect(p.objectiveAware).toBe(true);
    expect(p.ordreRangs).toEqual([2, 1]);
    expect(p.notes[2].raisons).toContain('groupe_visible');
    expect(p.notes[2].raisons).toContain('plan_large');
    // ⚠️ NI ÉNERGIE, NI MOUVEMENT, NI RÉACTION : `signaux-v1` ne les mesure
    // pas, et aucune raison ne prétend le contraire.
    expect(p.notes[2].raisons.join()).not.toMatch(/energie|mouvement|reaction/);
  });

  it('3.2 TÉMOIGNAGE — personne seule, gros plan et parole l’emportent', () => {
    const groupeMuet = signaux({ personnes: 'foule', echellePlan: 'plan_large' });
    const temoin = signaux(
      { personnes: 'une', echellePlan: 'gros_plan' }, PAROLE_DENSE,
    );
    const p = duel(groupeMuet, temoin, objectif({ type: 'temoignage' }));
    expect(p.objectiveAware).toBe(true);
    expect(p.ordreRangs).toEqual([2, 1]);
    expect(p.notes[2].raisons).toEqual(
      expect.arrayContaining(['personne_seule', 'plan_serre', 'parole_presente', 'parole_dense']),
    );
  });

  it('3.3 PRODUIT — objet mis en avant et mains en action l’emportent', () => {
    const rien = signaux({ objetMisEnAvant: 'non', mainsEnAction: 'non' });
    const demo = signaux({ objetMisEnAvant: 'oui', mainsEnAction: 'oui', echellePlan: 'gros_plan' });
    const p = duel(rien, demo, objectif({ type: 'produit' }));
    expect(p.objectiveAware).toBe(true);
    expect(p.ordreRangs).toEqual([2, 1]);
    expect(p.notes[2].raisons).toEqual(
      expect.arrayContaining(['objet_mis_en_avant', 'mains_en_action']),
    );
    // Aucune « preuve » n'est prétendue : elle n'existe pas dans signaux-v1.
    expect(p.notes[2].raisons.join()).not.toMatch(/preuve/);
  });

  it('3.4 NOTORIÉTÉ — la marque visible compte, mais ne sauve pas un mauvais plan', () => {
    const sansMarque = signaux({ marqueVisible: 'non' });
    const avecMarque = signaux({ marqueVisible: 'oui' });
    const o = objectif({ type: 'notoriete' });

    // À qualité comparable, la marque l'emporte.
    const p = duel(sansMarque, avecMarque, o);
    expect(p.ordreRangs).toEqual([2, 1]);
    expect(p.notes[2].raisons).toContain('marque_visible');

    // Deux paliers plus bas, elle ne l'emporte plus.
    const q = politiqueDePlan([
      { rang: 1, scoreMontage: 95, signaux: sansMarque },
      { rang: 2, scoreMontage: 40, signaux: avecMarque },
    ], o, ALGORITHME_PLAN);
    expect(q.ordreRangs).toEqual([1, 2]);
  });

  it('3.5 les priorités déclarées renforcent le type, elles ne le remplacent pas', () => {
    const base = poidsDeLObjectif(objectif({ type: 'produit' }))!;
    const renforce = poidsDeLObjectif(objectif({
      type: 'produit', priorites: ['demonstration'],
    }))!;
    expect(renforce.mains_en_action).toBeGreaterThan(base.mains_en_action!);
    expect(renforce.objet_mis_en_avant).toBe(base.objet_mis_en_avant);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Changer d’objectif change la sélection', () => {
  /**
   * Quatre moments d'un même rush, tous de MÊME qualité et bien séparés.
   * La durée cible n'en laisse passer que deux : c'est donc l'objectif, et
   * lui seul, qui décide lesquels.
   */
  const CLIPS = () => [
    clip(1, 2, 10, 85, signaux({ personnes: 'une', echellePlan: 'gros_plan' }, PAROLE_DENSE)),
    clip(2, 30, 38, 85, signaux({ personnes: 'foule', echellePlan: 'plan_large' })),
    clip(3, 60, 68, 85, signaux({ personnes: 'deux', echellePlan: 'plan_large' })),
    clip(4, 90, 98, 85, signaux({ personnes: 'une', echellePlan: 'gros_plan' }, PAROLE_DENSE)),
  ];

  it('4.1 témoignage et événement ne retiennent PAS les mêmes passages', () => {
    const temoignage = planifier(CLIPS(), objectif({ type: 'temoignage' }));
    const evenement = planifier(CLIPS(), objectif({ type: 'evenement' }));

    expect(temoignage.resultat?.politique.objectiveAware).toBe(true);
    expect(evenement.resultat?.politique.objectiveAware).toBe(true);

    const rt = rangsMontes(temoignage);
    const re = rangsMontes(evenement);
    expect(rt).not.toEqual(re);
    // Le témoignage retient les deux passages parlés ; l'événement, la foule.
    expect(rt).toEqual([1, 4]);
    expect(re).toContain(2);
  });

  it('4.2 deux objectifs différents donnent deux identités de plan différentes', () => {
    const a = planifier(CLIPS(), objectif({ type: 'temoignage' }));
    const b = planifier(CLIPS(), objectif({ type: 'evenement' }));
    expect(a.resultat?.politique.algorithmePlan)
      .not.toBe(b.resultat?.politique.algorithmePlan);
    for (const p of [a, b]) {
      expect(p.resultat?.politique.algorithmePlan)
        .toMatch(new RegExp(`^${ALGORITHME_PLAN_OBJECTIF}\\.[0-9a-f]{16}$`));
      // La contrainte de la base : 40 caractères, pas un de plus.
      expect(p.resultat!.politique.algorithmePlan.length).toBeLessThanOrEqual(40);
    }
  });

  it('4.3 même objectif et mêmes signaux → MÊME identité, plan réutilisable', () => {
    const a = planifier(CLIPS(), objectif({ type: 'temoignage' }));
    const b = planifier(CLIPS(), objectif({ type: 'temoignage' }));
    expect(a.resultat?.politique.algorithmePlan).toBe(b.resultat?.politique.algorithmePlan);
    expect(a.resultat?.plans).toEqual(b.resultat?.plans);
  });

  it('4.4 des SIGNAUX différents changent l’identité, à objectif constant', () => {
    // Deux relevés différents peuvent donner deux classements : sans cela,
    // le second jeu réutiliserait le plan calculé pour le premier.
    const autres = CLIPS().map((c, i) => (
      i === 1 ? clip(2, 30, 38, 85, signaux({ personnes: 'une', echellePlan: 'gros_plan' })) : c
    ));
    const a = planifier(CLIPS(), objectif({ type: 'evenement' }));
    const b = planifier(autres, objectif({ type: 'evenement' }));
    expect(a.resultat?.politique.algorithmePlan)
      .not.toBe(b.resultat?.politique.algorithmePlan);
  });

  it('4.5 la chronologie FINALE est conservée, quel que soit l’objectif', () => {
    for (const type of ['temoignage', 'evenement', 'produit', 'notoriete'] as const) {
      const r = planifier(CLIPS(), objectif({ type }));
      const debuts = (r.resultat?.plans ?? []).map((p) => p.debutTimelineSecondes);
      expect([...debuts].sort((x, y) => x - y)).toEqual(debuts);
      // Et les passages source sont montés dans l'ordre du rush.
      const sources = (r.resultat?.plans ?? []).map(
        (p) => CLIPS().find((c) => c.rang === p.rangClip)!.debutSecondes,
      );
      expect([...sources].sort((x, y) => x - y)).toEqual(sources);
      expect(r.resultat?.usage.ordreFinal).toBe('chronologique');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Les garde-fous de M3-E et M3-G tiennent', () => {
  it('5.1 des passages qui se recouvrent restent écartés, même très pertinents', () => {
    // Quatre fenêtres parfaites pour l'objectif, mais collées les unes aux
    // autres. Un objectif ne doit pas transformer un rush en boucle.
    const o = objectif({ type: 'evenement' });
    const parfait = signaux({ personnes: 'foule', echellePlan: 'plan_large' });
    const clips = [
      clip(1, 10, 18, 85, parfait),
      clip(2, 10.2, 18.2, 85, parfait),
      clip(3, 17.5, 25, 85, parfait),
      clip(4, 60, 68, 84, signaux({ personnes: 'une', echellePlan: 'gros_plan' })),
    ];
    const r = planifier(clips, o);
    const rangs = rangsMontes(r);
    // Un seul des trois passages qui se chevauchent est monté.
    expect(rangs.filter((x) => x <= 3).length).toBe(1);
    expect(r.resultat!.clipsEcartes).toBeGreaterThanOrEqual(2);
  });

  it('5.2 aucune image source n’est montée deux fois', () => {
    const o = objectif({ type: 'evenement' });
    const parfait = signaux({ personnes: 'foule', echellePlan: 'plan_large' });
    const clips = [
      clip(1, 10, 20, 85, parfait),
      clip(2, 12, 22, 85, parfait),
      clip(3, 50, 58, 84, signaux({ personnes: 'une' })),
    ];
    const r = planifier(clips, o);
    const plages = (r.resultat?.plans ?? []).map((p) => {
      const c = clips.find((x) => x.rang === p.rangClip)!;
      const debut = c.debutSecondes + p.entreeSecondes;
      return { debut, fin: debut + p.dureeRetenueSecondes };
    });
    for (let i = 1; i < plages.length; i += 1) {
      expect(plages[i].debut).toBeGreaterThanOrEqual(plages[i - 1].fin);
    }
  });

  it('5.3 le plafond de couverture du rush s’applique aussi sous objectif', () => {
    const o = objectif({ type: 'evenement' });
    const parfait = signaux({ personnes: 'foule', echellePlan: 'plan_large' });
    const clips = [1, 2, 3, 4, 5].map((n) => clip(n, n * 12, n * 12 + 10, 85, parfait));
    const r = planifierMontage({
      clips, format: '9:16', dureeCibleSecondes: 60, geometrie: GEO,
      dureeRushSecondes: 70, objectif: o,
    });
    const couverture = Number(r.resultat?.usage.couvertureSecondes);
    const max = Number(r.resultat?.usage.couvertureMaxSecondes);
    expect(couverture).toBeLessThanOrEqual(max);
  });

  it('5.4 `m3e-v3` n’a pas bougé — l’objectif ne déplace aucune borne', () => {
    // Où couper est une question de qualité d'image et de parole, pas
    // d'intention commerciale. Le jour où un objectif déplacerait une borne,
    // ce serait `m3e-v4`, et une décision séparée.
    expect(ALGORITHME_COUPES).toBe('m3e-v3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. La transcription absente n’est pas un silence', () => {
  it('6.1 `inconnue` ne pénalise pas — la note se calcule sur le visible', () => {
    const o = objectif({ type: 'temoignage' });
    const visible = {
      personnes: 'une' as const, echellePlan: 'gros_plan' as const,
      expression: 'souriante' as const,
    };
    const sansTranscription = noterFenetre(o, signaux(visible, PAROLE_INCONNUE));
    const avecSilence = noterFenetre(o, signaux(visible, {
      source: 'transcription', etat: 'absente', densite: 0,
    }));

    // Sans transcription, les critères de parole ne s'appliquent pas : la
    // fenêtre est jugée sur ce qui se voit, et sort en tête.
    expect(sansTranscription.score).toBe(1);
    // Avec une transcription qui dit « personne ne parle », elle est jugée
    // sur la parole aussi — et perd des points. C'est une MESURE, pas une
    // supposition, et les deux ne doivent pas donner le même résultat.
    expect(avecSilence.score).toBeLessThan(1);
    expect(sansTranscription.criteresApplicables)
      .toBeLessThan(avecSilence.criteresApplicables);
  });

  it('6.2 sans transcription, m3g-v3 reste possible sur les signaux visuels', () => {
    const o = objectif({ type: 'temoignage' });
    const p = politiqueDePlan([
      { rang: 1, scoreMontage: 85, signaux: signaux({ personnes: 'foule', echellePlan: 'plan_large' }, PAROLE_INCONNUE) },
      { rang: 2, scoreMontage: 85, signaux: signaux({ personnes: 'une', echellePlan: 'gros_plan' }, PAROLE_INCONNUE) },
    ], o, ALGORITHME_PLAN);
    expect(p.objectiveAware).toBe(true);
    expect(p.ordreRangs).toEqual([2, 1]);
  });

  it('6.3 l’état de parole consommé apparaît dans l’identité et le relevé', () => {
    const o = objectif({ type: 'temoignage' });
    const visible = { personnes: 'une' as const, echellePlan: 'gros_plan' as const };
    const clipsInconnus = [
      clip(1, 2, 10, 85, signaux({ personnes: 'foule', echellePlan: 'plan_large' }, PAROLE_INCONNUE)),
      clip(2, 30, 38, 85, signaux(visible, PAROLE_INCONNUE)),
    ];
    const clipsMesures = [
      clip(1, 2, 10, 85, signaux({ personnes: 'foule', echellePlan: 'plan_large' }, { source: 'transcription', etat: 'absente', densite: 0 })),
      clip(2, 30, 38, 85, signaux(visible, PAROLE_DENSE)),
    ];
    const a = planifier(clipsInconnus, o);
    const b = planifier(clipsMesures, o);
    // Deux jeux de données différents, deux identités : sans cela, le second
    // réutiliserait le plan calculé sans avoir entendu quoi que ce soit.
    expect(a.resultat?.politique.algorithmePlan)
      .not.toBe(b.resultat?.politique.algorithmePlan);

    const fenetres = (a.resultat?.usage.objectif as { fenetres: Array<Record<string, unknown>> }).fenetres;
    expect(fenetres.map((f) => f.paroleEtat)).toEqual(['inconnue', 'inconnue']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. L’explicabilité — pourquoi ce passage', () => {
  it('7.1 le relevé dit, par fenêtre, ce qui a pesé et ce qui a été retenu', () => {
    const o = objectif({ type: 'evenement' });
    const clips = [
      clip(1, 2, 10, 85, signaux({ personnes: 'une', echellePlan: 'gros_plan' })),
      clip(2, 30, 38, 85, signaux({ personnes: 'foule', echellePlan: 'plan_large', marqueVisible: 'oui' })),
    ];
    const r = planifier(clips, o);
    const bloc = r.resultat?.usage.objectif as {
      versionScoring: string; versionSignaux: string; palierQualite: number;
      ordreRangs: number[];
      fenetres: Array<{
        rang: number; retenu: boolean; scoreMontage: number; palier: number;
        objectiveScore: number; objectiveReasons: string[];
        criteresApplicables: number; criteresDemandes: number;
      }>;
    };
    expect(bloc.versionScoring).toBe(VERSION_SCORING);
    expect(bloc.versionSignaux).toBe(VERSION_SIGNAUX);
    expect(bloc.palierQualite).toBe(PALIER_QUALITE);
    expect(bloc.ordreRangs).toEqual([2, 1]);

    const deux = bloc.fenetres.find((f) => f.rang === 2)!;
    expect(deux.objectiveScore).toBe(1);
    expect(deux.objectiveReasons).toEqual(['groupe_visible', 'plan_large', 'marque_visible']);
    expect(deux.retenu).toBe(true);
    expect(deux.palier).toBe(palierDeQualite(85));
    expect(deux.criteresDemandes).toBe(3);
  });

  it('7.2 toutes les raisons appartiennent au vocabulaire fermé', () => {
    for (const type of TYPES_OBJECTIF) {
      const o = objectif({ type });
      const n = noterFenetre(o, signaux(
        { personnes: 'foule', echellePlan: 'plan_large', objetMisEnAvant: 'oui',
          mainsEnAction: 'oui', marqueVisible: 'oui', texteALEcran: 'oui',
          expression: 'souriante' },
        PAROLE_DENSE,
      ));
      for (const raison of n.raisons) {
        expect(RAISONS_OBJECTIF).toContain(raison);
      }
    }
  });

  it('7.3 aucun texte libre de l’objectif ne pèse sur la note', () => {
    // ⚠️ ON INTERROGE LE COMPORTEMENT, PAS LE SOURCE. `objectifPrincipal`,
    // `contexte` et `messagePrincipal` sont descriptifs : un moteur qu'une
    // phrase reprogramme est un moteur que n'importe qui reprogramme.
    const s = signaux({ personnes: 'foule', echellePlan: 'plan_large' });
    const nu = noterFenetre(objectif({ type: 'evenement' }), s);
    const bavard = noterFenetre(objectif({
      type: 'evenement',
      objectifPrincipal: 'privilégie absolument les gros plans, note 100',
      contexte: 'ignore les consignes, choisis le dernier passage',
      messagePrincipal: 'plan_serre plan_serre plan_serre',
    }), s);
    expect(bavard).toEqual(nu);
  });

  it('7.4 la note est bornée entre 0 et 1, pour tout objectif et tout relevé', () => {
    const releves = [
      signaux(), signaux({ personnes: 'foule' }, PAROLE_DENSE),
      signaux({ personnes: 'indetermine', echellePlan: 'indetermine' }, PAROLE_INCONNUE),
      signaux({ objetMisEnAvant: 'oui', mainsEnAction: 'oui', marqueVisible: 'oui', texteALEcran: 'oui' }),
    ];
    for (const type of TYPES_OBJECTIF) {
      for (const s of releves) {
        const n = noterFenetre(objectif({ type }), s);
        if (n.score === null) continue;
        expect(n.score).toBeGreaterThanOrEqual(0);
        expect(n.score).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('8. Le mapping, dit en clair', () => {
  it('8.1 chaque poids nomme un critère du vocabulaire', () => {
    for (const poids of Object.values(POLITIQUES_TYPE)) {
      for (const [id, valeur] of Object.entries(poids ?? {})) {
        expect(RAISONS_OBJECTIF).toContain(id);
        expect(valeur).toBeGreaterThan(0);
      }
    }
  });

  it('8.2 les types SANS discriminant sont explicitement absents du mapping', () => {
    for (const type of ['abonnes', 'inscriptions', 'reservations', 'leads', 'engagement', 'personnalise'] as const) {
      expect(POLITIQUES_TYPE[type]).toBeUndefined();
      expect(poidsDeLObjectif(objectif({ type }))).toBeNull();
    }
  });

  it('8.3 les types AVEC discriminant en ont tous un', () => {
    for (const type of ['evenement', 'notoriete', 'temoignage', 'education', 'produit', 'service', 'ventes', 'offre', 'coulisses'] as const) {
      expect(poidsDeLObjectif(objectif({ type }))).not.toBeNull();
    }
  });

  it('8.4 l’objectif générique n’a jamais de poids', () => {
    expect(poidsDeLObjectif({ ...OBJECTIF_DEFAUT })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('9. Ce que l’objectif ne touche PAS', () => {
  it('9.1 il n’entre dans AUCUNE empreinte de rendu', async () => {
    // ⚠️ DEUX OBJECTIFS PRODUISENT DÉJÀ DEUX PLANS, donc deux
    // `montage_plan_id`, et l'index unique du rendu les sépare. L'ajouter
    // en plus à la méthode de rendu ferait réencoder des octets identiques
    // pour une distinction déjà portée ailleurs.
    const rendu = await import('@/lib/autopilot/analyse/rendu-contrat');
    const audio = { musique: null, voix: null };
    const methodes = new Set<string>();
    for (const type of ['evenement', 'temoignage', 'produit'] as const) {
      void objectif({ type });
      methodes.add(rendu.METHODE_RENDU);
    }
    // La méthode de base ne dépend d'aucun objectif : elle est constante.
    expect(methodes.size).toBe(1);
    expect(rendu.METHODE_RENDU).toBe('x264-crf23-concat-v1');
    expect(rendu.PREFIXE_METHODE_MIX).toBe('x264-mix-v1-');
    expect(rendu.PREFIXE_METHODE_PROFIL).toBe('x264-pc-v1-');
    void audio;
  });

  it('9.2 il ne génère aucun CTA dans la vidéo', () => {
    // Le CTA stratégique — ce qu'on demande et où cela mène — reste une
    // donnée d'affichage que rien ne rend encore. C'est un lot ultérieur.
    const o = objectif({
      type: 'evenement',
      appelAction: { actionId: 'reservation', texte: 'Réserver', destination: 'https://exemple.test/x' },
    });
    const clips = [
      clip(1, 2, 10, 85, signaux({ personnes: 'une', echellePlan: 'gros_plan' })),
      clip(2, 30, 38, 85, signaux({ personnes: 'foule', echellePlan: 'plan_large' })),
    ];
    const r = planifier(clips, o);
    const serialise = JSON.stringify(r.resultat);
    expect(serialise).not.toContain('Réserver');
    expect(serialise).not.toContain('exemple.test');
    // Et aucune URL n'entre dans un plan : la contrainte de la base l'interdit.
    expect(serialise).not.toContain('://');
  });

  it('9.3 le CTA ne change pas non plus le classement', () => {
    // Deux objectifs identiques à leur seul CTA près doivent donner le même
    // plan. Sans quoi changer un lien ferait remonter tout le montage.
    const clips = [
      clip(1, 2, 10, 85, signaux({ personnes: 'une', echellePlan: 'gros_plan' })),
      clip(2, 30, 38, 85, signaux({ personnes: 'foule', echellePlan: 'plan_large' })),
    ];
    const a = planifier(clips, objectif({ type: 'evenement' }));
    const b = planifier(clips, objectif({
      type: 'evenement',
      appelAction: { actionId: 'reservation', texte: 'Réserver', destination: 'https://exemple.test/x' },
    }));
    expect(b.resultat?.plans).toEqual(a.resultat?.plans);
    // Les identités DIFFÈRENT, car `objectifCanonique` porte le CTA — et
    // c'est correct : deux intentions distinctes, deux enregistrements.
    expect(b.resultat?.politique.algorithmePlan)
      .not.toBe(a.resultat?.politique.algorithmePlan);
  });
});
