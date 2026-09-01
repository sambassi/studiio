// @vitest-environment node
/**
 * M3-H (H1) — LE CONTRAT DU RENDU.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE, AVANT TOUTE EXÉCUTION COÛTEUSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-H exécute une décision qu'il ne prend pas. Quatre défauts coûteraient
 * cher, et ce sont eux que ces tests visent :
 *
 *   1. LAISSER LE NAVIGATEUR PILOTER LE RENDU. Un `crf`, un `crop` ou une
 *      `cle` acceptés du client contourneraient toute la chaîne M3-C → M3-G
 *      et injecteraient des valeurs dans une ligne de commande.
 *   2. REFAIRE UNE DÉCISION DE M3-G. Une tolérance de coupe ou une
 *      heuristique de recadrage dans ce contrat serait le signe qu'une
 *      décision persistée a été recalculée.
 *   3. POSER DES CONSTANTES MAGIQUES. Chaque borne doit se déduire d'une
 *      mesure ou d'une constante amont ; une valeur écrite à la main cesse
 *      silencieusement d'être vraie à la première retouche.
 *   4. CONFONDRE LES DURÉES DE VIE. La péremption protège le travail, la TTL
 *      protège un accès au stockage : les lier aurait prolongé une signature
 *      pendant vingt minutes où plus rien ne l'utilise.
 *
 * ⚠️ AUCUN FFMPEG, AUCUN STOCKAGE, AUCUN RENDU. H1 ne contient que des
 * constantes et des fonctions pures ; rien ici n'exécute quoi que ce soit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  METHODE_RENDU, CRF_RENDU, PRESET_RENDU, PIXEL_FORMAT_RENDU,
  AUDIO_BITRATE_RENDU, AUDIO_FREQUENCE_RENDU, CONTENT_TYPE_RENDU,
  BUCKET_RENDUS_MONTAGE,
  DUREE_RENDU_MAX_SECONDES, SOURCES_MAX,
  OCTETS_PAR_SECONDE_ESTIMES, RENDU_OCTETS_MAX, ESPACE_TEMPORAIRE_MAX_OCTETS,
  TIMEOUT_TRANSFERT_SOURCE_MS, TIMEOUT_TELEVERSEMENT_RENDU_MS,
  TIMEOUT_MESURE_MS, AMORCE_RENDU_MS, FACTEUR_ENCODAGE, TIMEOUT_ENCODAGE_MIN_MS,
  timeoutEncodage, budgetRendu, BUDGET_RENDU_MAX_MS,
  MARGE_PEREMPTION_MS, PEREMPTION_RENDU_MS, TTL_SOURCE_RENDU_SECONDES,
  BUDGET_PHASE_SOURCE_MS, COMPOSANT_CLE,
  TRAME_AAC_SECONDES, ECHANTILLONS_TRAME_AAC, toleranceDuree, TOLERANCE_FPS,
  dureeConforme, resolutionConforme,
  cleRendu, cleValide,
  ETATS_RENDU, ETAPES_RENDU, MOTIFS_RENDU, MOTIF_RENDU_INTERROMPU,
  etatRenduValide, etapeRenduValide, motifRenduValide,
  renduMaterialiseValide, planRendable,
  CORPS_RENDU_ATTENDU_VIDE, CHAMPS_INTERDITS_RENDU,
  type IdentiteRendu,
} from '@/lib/autopilot/analyse/rendu-contrat';
import {
  CLIP_OCTETS_MAX, TIMEOUT_TELEVERSEMENT_MS, PRESET, PIXEL_FORMAT,
  AUDIO_BITRATE, AUDIO_FREQUENCE, CRF, PEREMPTION_SET_MS,
} from '@/lib/autopilot/analyse/clip-contrat';
import {
  DUREE_CIBLE_MAX_SECONDES, PLANS_MAX, DUREE_PLAN_MIN_SECONDES,
} from '@/lib/autopilot/analyse/montage-contrat';
import { ALLOWED_BUCKETS } from '@/lib/storage/buckets';

const SRC = resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu-contrat.ts');
const source = () => readFileSync(SRC, 'utf8');
const sourceSansCommentaires = () => source()
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/**
 * La source, PRIVÉE de la liste des champs refusés.
 *
 * `CHAMPS_INTERDITS_RENDU` cite légitimement `musicUrl`, `crop`, `codec` — ce
 * sont précisément les noms que la route rejettera. Balayer la source entière
 * confondrait « ce module interdit musicUrl » avec « ce module fait de la
 * musique », et le test rougirait pour la raison inverse de son intention.
 */
const codeSansInterdictions = () => sourceSansCommentaires()
  .replace(/export const CHAMPS_INTERDITS_RENDU = \[[\s\S]*?\] as const;/, '');

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const RID = '4dbcd5a6-2e7b-4150-b43b-e318bb403198';

// ═════════════════════════════════════════════════════════════════════════
describe('1-4. L’identité : nommée, versionnée, décidée par le serveur', () => {
  it('la méthode de rendu est nommée et VERSIONNÉE', () => {
    expect(METHODE_RENDU).toBe('x264-crf23-concat-v1');
    // Un nom versionné : une valeur mesurée autrement donnera `v2`, et les
    // rendus précédents ne seront pas réutilisés à tort.
    expect(METHODE_RENDU).toMatch(/-v\d+$/);
    expect(METHODE_RENDU.length).toBeLessThanOrEqual(40);
  });

  it('l’identité est MINIMALE : le plan porte déjà le reste', () => {
    // ⚠️ TROIS CHAMPS. Le plan porte déjà, dans SON identité persistée, le
    // jeu de clips et sa version, l'analyse, m3e-v1, x264-crf23-v1, m3g-v1,
    // le format et la durée cible. Les recopier ici les ferait exister à deux
    // endroits, avec la certitude qu'ils divergeraient un jour.
    const identite: IdentiteRendu = {
      montagePlanId: '11111111-1111-4111-8111-111111111111',
      montagePlanVersion: 1,
      methodeRendu: METHODE_RENDU,
    };
    expect(Object.keys(identite).sort())
      .toEqual(['methodeRendu', 'montagePlanId', 'montagePlanVersion']);

    // Et le contrat ne redéclare aucun champ du plan.
    const src = sourceSansCommentaires();
    const bloc = /export interface IdentiteRendu \{([^}]*)\}/.exec(src)![1];
    for (const interdit of ['clipSetId', 'candidateSetId', 'analysisId',
      'algorithme', 'methodeMaterialisation', 'algorithmePlan', 'format',
      'dureeCibleSecondes']) {
      expect(bloc, `IdentiteRendu ne doit pas porter ${interdit}`).not.toContain(interdit);
    }
  });

  it('la méthode et l’encodage sont FIXÉS CÔTÉ SERVEUR, jamais reçus', () => {
    // Aucune de ces valeurs n'est lue depuis un corps de requête : ce sont
    // des constantes du module, et les noms correspondants sont refusés.
    for (const interdit of ['methode', 'methodeRendu', 'crf', 'preset', 'codec']) {
      expect(CHAMPS_INTERDITS_RENDU as readonly string[]).toContain(interdit);
    }
    const src = sourceSansCommentaires();
    expect(src).not.toMatch(/req\.|request\.|body|corps\./);
  });

  it('LE CRF EST CELUI QUE LE DÉPÔT A MESURÉ, pas celui qu’on suppose', () => {
    // ⚠️ LE TEST QUI EMPÊCHE DE REFAIRE L'ERREUR. Une première rédaction
    // fixait CRF 20 au motif qu'un second encodage empile la perte. Le dépôt
    // portait déjà la mesure qui tranche, sur ce rush et à cette résolution :
    // « 23,6 Mo en CRF 23 contre 33,0 Mo en CRF 20 — trente pour cent de
    // moins, pour une différence INVISIBLE à 1080p ».
    expect(CRF).toBe(23);
    expect(CRF_RENDU).toBe(CRF);
    const clipContrat = readFileSync(
      resolve(process.cwd(), 'src/lib/autopilot/analyse/clip-contrat.ts'), 'utf8',
    );
    expect(clipContrat).toContain('23,6 Mo en CRF 23 contre 33,0 Mo en');
    // Le nom reste DISTINCT de celui de M3-F : deux colonnes, deux opérations.
    expect(METHODE_RENDU).not.toBe('x264-crf23-v1');
    expect(METHODE_RENDU).toContain('concat');
    // Tout le reste est repris de M3-F sans changement : les clips en
    // sortent, et en changer sans mesure serait de l'optimisation
    // opportuniste.
    expect(PRESET_RENDU).toBe(PRESET);
    expect(PIXEL_FORMAT_RENDU).toBe(PIXEL_FORMAT);
    expect(AUDIO_BITRATE_RENDU).toBe(AUDIO_BITRATE);
    expect(AUDIO_FREQUENCE_RENDU).toBe(AUDIO_FREQUENCE);
    expect(CONTENT_TYPE_RENDU).toBe('video/mp4');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('5-7. La clé de stockage : fabriquée, jamais reçue', () => {
  it('la clé est FABRIQUÉE et déterministe', () => {
    const cle = cleRendu(UID, RID);
    expect(cle).toBe(`${UID}/autopilote/montages/${RID}/montage.mp4`);
    // Déterministe : le même rendu rend la même clé, ce qui permet de
    // retrouver l'objet d'un rendu interrompu sans le relire en base.
    expect(cleRendu(UID, RID)).toBe(cle);
    // Le préfixe utilisateur EST la preuve de propriété.
    expect(cle.startsWith(`${UID}/`)).toBe(true);
    expect(cle.endsWith('.mp4')).toBe(true);
  });

  it('une clé ne porte NI `://` NI traversée `..`', () => {
    expect(cleValide(cleRendu(UID, RID), UID)).toBe(true);
    // Une URL dans un champ de clé est le signe qu'une signature a été
    // persistée quelque part.
    expect(cleValide(`https://minio/${UID}/x.mp4`, UID)).toBe(false);
    expect(cleValide(`${UID}/autopilote/../autre/x.mp4`, UID)).toBe(false);
    // `A/../B/x` satisfait le préfixe tout en désignant l'espace de B.
    expect(cleValide('autre/autopilote/montages/x/montage.mp4', UID)).toBe(false);
    expect(cleValide('', UID)).toBe(false);
    expect(cleValide(null, UID)).toBe(false);
    expect(cleValide(42, UID)).toBe(false);
  });

  it('la fabrication REFUSE un composant malformé, avant de concaténer', () => {
    // Les deux composants viennent de la session et de la base — mais une
    // fabrication qui fait confiance à ses entrées n'est sûre que tant que
    // cette provenance ne change pas. `cleValide` ne relirait la clé qu'APRÈS
    // que l'objet ait été écrit.
    expect(COMPOSANT_CLE.test(UID)).toBe(true);
    for (const hostile of ['..', '../autre', 'a/b', '', 'x'.repeat(65),
      'a:b', 'https://x', 'a b']) {
      expect(() => cleRendu(UID, hostile), `renduId « ${hostile} »`).toThrow();
      expect(() => cleRendu(hostile, RID), `userId « ${hostile} »`).toThrow();
    }
    // Et une clé ainsi refusée n'aurait de toute façon pas passé la relecture.
    expect(cleValide(`${UID}/autopilote/montages/../autre/montage.mp4`, UID)).toBe(false);
  });

  it('le compartiment est celui des vidéos, et il est autorisé', () => {
    expect(BUCKET_RENDUS_MONTAGE).toBe('videos');
    expect(ALLOWED_BUCKETS).toContain(BUCKET_RENDUS_MONTAGE);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('8-14. Les bornes : toutes DÉRIVÉES, aucune magique', () => {
  it('les bornes amont sont REPRISES de M3-F et M3-G, jamais redéclarées', () => {
    expect(DUREE_RENDU_MAX_SECONDES).toBe(DUREE_CIBLE_MAX_SECONDES);
    expect(SOURCES_MAX).toBe(PLANS_MAX);
    // Le contrat importe ces valeurs plutôt que d'en écrire d'autres :
    // deux plafonds divergeraient au premier ajustement.
    const src = source();
    expect(src).toContain("from './montage-contrat'");
    expect(src).toContain("from './clip-contrat'");
  });

  it('le poids maximal est EXTRAPOLÉ d’une mesure réelle', () => {
    // M3-F a produit 23 504 275 octets pour 26,934 s à CRF 23, soit ~0,87
    // Mo/s. M3-H encode aux mêmes paramètres.
    // Aucun facteur correctif : M3-H encode aux MÊMES paramètres que M3-F.
    expect(OCTETS_PAR_SECONDE_ESTIMES).toBe(Math.ceil(23_504_275 / 26.934));
    expect(RENDU_OCTETS_MAX).toBe(2 * OCTETS_PAR_SECONDE_ESTIMES * DUREE_RENDU_MAX_SECONDES);
    // Le double de l'extrapolation : une scène très détaillée dépasse la
    // moyenne d'un rush de démonstration, et un plafond serré transformerait
    // une vidéo valide en `resultat_invalide`.
    expect(RENDU_OCTETS_MAX).toBeGreaterThan(OCTETS_PAR_SECONDE_ESTIMES * DUREE_RENDU_MAX_SECONDES);
    expect(RENDU_OCTETS_MAX).toBeGreaterThan(CLIP_OCTETS_MAX);
  });

  it('l’espace temporaire couvre les sources ET la sortie', () => {
    expect(ESPACE_TEMPORAIRE_MAX_OCTETS)
      .toBe(SOURCES_MAX * CLIP_OCTETS_MAX + RENDU_OCTETS_MAX);
  });

  it('le téléversement final est DÉRIVÉ du débit plancher de M3-F', () => {
    // M3-F accorde 60 s pour 64 Mio, soit ~1,07 Mio/s garanti. Le même
    // plancher appliqué à un fichier quatre fois plus gros donne la valeur
    // ci-dessous ; garder 60 s aurait coupé un téléversement sain.
    expect(TIMEOUT_TELEVERSEMENT_RENDU_MS)
      .toBe(Math.ceil(TIMEOUT_TELEVERSEMENT_MS * (RENDU_OCTETS_MAX / CLIP_OCTETS_MAX)));
    expect(TIMEOUT_TELEVERSEMENT_RENDU_MS).toBeGreaterThan(TIMEOUT_TELEVERSEMENT_MS);
    // Le téléchargement d'une source, lui, est la MÊME opération que le
    // téléversement d'un clip : même stockage, même plafond de 64 Mio.
    expect(TIMEOUT_TRANSFERT_SOURCE_MS).toBe(TIMEOUT_TELEVERSEMENT_MS);
  });

  it('le délai d’encodage est FONCTION de la durée, pas une constante', () => {
    // Accorder à un montage de cinq secondes le délai d'un montage de deux
    // minutes retarderait de plusieurs minutes le diagnostic d'un blocage.
    expect(timeoutEncodage(120)).toBe(120 * FACTEUR_ENCODAGE * 1000);
    expect(timeoutEncodage(25)).toBe(25 * FACTEUR_ENCODAGE * 1000);
    expect(timeoutEncodage(25)).toBeLessThan(timeoutEncodage(120));
    // Un plancher : un rendu d'une seconde doit quand même démarrer x264.
    expect(timeoutEncodage(1)).toBe(TIMEOUT_ENCODAGE_MIN_MS);
    expect(timeoutEncodage(0)).toBe(TIMEOUT_ENCODAGE_MIN_MS);
    expect(timeoutEncodage(Number.NaN)).toBe(TIMEOUT_ENCODAGE_MIN_MS);

    // ⚠️ ÉTALONNÉ SUR UNE MESURE. M3-F a fait 26,934 s de vidéo en 38 201 ms
    // tout compris, soit ~1,42× le temps réel. Six fois laisse plus de
    // quatre fois cette marge.
    expect(FACTEUR_ENCODAGE).toBeGreaterThan(38.201 / 26.934);
    expect(FACTEUR_ENCODAGE).toBe(6);
  });

  it('le budget est une SOMME des étapes, pas un nombre', () => {
    const attendu = (d: number) => AMORCE_RENDU_MS
      + SOURCES_MAX * TIMEOUT_TRANSFERT_SOURCE_MS
      + timeoutEncodage(d) + TIMEOUT_MESURE_MS + TIMEOUT_TELEVERSEMENT_RENDU_MS;
    expect(budgetRendu(25)).toBe(attendu(25));
    expect(budgetRendu(120)).toBe(attendu(120));
    expect(BUDGET_RENDU_MAX_MS).toBe(budgetRendu(DUREE_RENDU_MAX_SECONDES));
    // Le pire cas croît avec la durée : c'est bien un budget, pas un plafond.
    expect(budgetRendu(120)).toBeGreaterThan(budgetRendu(25));

    // La formule est celle de la source, pas un nombre recopié à côté.
    const src = sourceSansCommentaires();
    expect(src).toMatch(/AMORCE_RENDU_MS\s*\+\s*SOURCES_MAX \* TIMEOUT_TRANSFERT_SOURCE_MS/);
  });

  it('LA PÉREMPTION DÉPASSE STRICTEMENT LE PIRE CAS', () => {
    // ⚠️ L'INVARIANT. Une péremption sous le budget fermerait un rendu encore
    // vivant, et un second ffmpeg partirait sur les mêmes octets.
    expect(PEREMPTION_RENDU_MS).toBeGreaterThan(BUDGET_RENDU_MAX_MS);
    expect(PEREMPTION_RENDU_MS).toBe(BUDGET_RENDU_MAX_MS + MARGE_PEREMPTION_MS);
    expect(MARGE_PEREMPTION_MS).toBeGreaterThan(0);
    // Et elle dépasse aussi le pire cas de n'importe quelle durée admissible.
    for (const d of [1, 25, 60, DUREE_RENDU_MAX_SECONDES]) {
      expect(PEREMPTION_RENDU_MS).toBeGreaterThan(budgetRendu(d));
    }
  });

  it('LA PÉREMPTION N’EST PAS RECOPIÉE DE M3-F', () => {
    // M3-F vaut trente minutes parce que SON pire cas vaut dix-huit ; celui
    // de M3-H est différent, et lui emprunter sa valeur aurait été un nombre
    // sans rapport avec le travail qu'il protège.
    //
    // La valeur de M3-F est importée, jamais réévaluée depuis sa source : une
    // évaluation dynamique de texte du dépôt serait un vecteur d'exécution
    // pour un contenu qu'un test n'a aucune raison d'interpréter.
    expect(PEREMPTION_SET_MS).toBe(30 * 60 * 1000);
    expect(PEREMPTION_RENDU_MS).not.toBe(PEREMPTION_SET_MS);
    expect(sourceSansCommentaires()).not.toContain('PEREMPTION_SET_MS');
  });

  it('LA TTL DES SOURCES NE SUIT PAS LA PÉREMPTION', () => {
    // ⚠️ DEUX BESOINS DIFFÉRENTS. Les signatures ne servent qu'au
    // téléchargement : les clips descendent d'abord, puis ffmpeg travaille
    // sur des fichiers locaux. Les faire vivre aussi longtemps que le rendu
    // prolongerait un accès au stockage pendant vingt minutes inutiles.
    expect(BUDGET_PHASE_SOURCE_MS)
      .toBe(AMORCE_RENDU_MS + SOURCES_MAX * TIMEOUT_TRANSFERT_SOURCE_MS);
    expect(TTL_SOURCE_RENDU_SECONDES)
      .toBe(Math.ceil((BUDGET_PHASE_SOURCE_MS + MARGE_PEREMPTION_MS) / 1000));
    expect(TTL_SOURCE_RENDU_SECONDES * 1000).toBeLessThan(PEREMPTION_RENDU_MS);
    // Mais elle couvre bien toute la phase qu'elle protège.
    expect(TTL_SOURCE_RENDU_SECONDES * 1000).toBeGreaterThan(BUDGET_PHASE_SOURCE_MS);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('15-18. Les tolérances : issues du SUPPORT, pas d’une préférence', () => {
  it('la tolérance de durée vient des quanta image ET audio', () => {
    expect(ECHANTILLONS_TRAME_AAC).toBe(1024);
    expect(TRAME_AAC_SECONDES).toBeCloseTo(1024 / 48_000, 9);

    // Le plus grossier des deux gouverne : à 30 i/s, l'image (33,3 ms)
    // dépasse la trame AAC (21,3 ms).
    expect(toleranceDuree(30, 1)).toBeCloseTo(1 / 30, 3);
    // À 60 i/s, l'image passe sous la trame AAC, qui prend le relais.
    expect(toleranceDuree(60, 1)).toBeCloseTo(TRAME_AAC_SECONDES, 3);

    // ⚠️ ELLE S'ACCUMULE AVEC LE NOMBRE DE PLANS : chaque frontière arrondit
    // une fois. Une tolérance fixe serait trop lâche à deux plans et trop
    // serrée à six.
    expect(toleranceDuree(30, 5)).toBeCloseTo(5 / 30, 3);
    expect(toleranceDuree(30, 5)).toBeGreaterThan(toleranceDuree(30, 2));

    // Des entrées absurdes ne produisent pas une tolérance absurde.
    expect(toleranceDuree(0, 5)).toBeGreaterThan(0);
    expect(toleranceDuree(Number.NaN, Number.NaN)).toBeGreaterThan(0);
  });

  it('LE CAS DE RÉFÉRENCE : 25,000 s sur 5 plans à 30 i/s', () => {
    // Le plan réel validé en production. Tolérance 166,7 ms.
    const tol = toleranceDuree(30, 5);
    expect(tol).toBeCloseTo(0.167, 3);
    // Physiquement équivalent malgré le quantum : conforme.
    expect(dureeConforme(25.000, 25, 30, 5)).toBe(true);
    expect(dureeConforme(24.95, 25, 30, 5)).toBe(true);
    expect(dureeConforme(25.08, 25, 30, 5)).toBe(true);
    // Au-delà, ce n'est plus un arrondi de support : c'est un plan mal rendu.
    expect(dureeConforme(24.5, 25, 30, 5)).toBe(false);
    expect(dureeConforme(26, 25, 30, 5)).toBe(false);
    expect(dureeConforme(0, 25, 30, 5)).toBe(false);
    expect(dureeConforme(null, 25, 30, 5)).toBe(false);
  });

  it('LA TOLÉRANCE EST DÉMONTRÉE : assez large, et assez serrée', () => {
    // ─────────────────────────────────────────────────────────────────────
    // ASSEZ LARGE ? C'est une BORNE SUPÉRIEURE, pas une estimation.
    // ─────────────────────────────────────────────────────────────────────
    // `trim` coupe sur une frontière d'image : un segment de durée d rend un
    // nombre entier d'images, donc une erreur dans [0, 1/fps). Les segments
    // sont mis bout à bout, si bien que le pire cas cumulé vaut N × quantum.
    // Il n'est atteint que si CHAQUE segment tombe entre deux images — sur le
    // plan réel, trois des cinq durées (5 s, 8 s, 8 s à 30 i/s) sont des
    // multiples exacts d'une image et n'apportent aucune erreur.
    const quantum = Math.max(1 / 30, TRAME_AAC_SECONDES);
    expect(toleranceDuree(30, 5)).toBeCloseTo(5 * quantum, 3);

    // ─────────────────────────────────────────────────────────────────────
    // ASSEZ SERRÉE ? Le plus petit défaut RÉEL reste très au-dessus.
    // ─────────────────────────────────────────────────────────────────────
    // ⚠️ C'EST CE QUI REND LA TOLÉRANCE DÉFENDABLE. M3-G impose qu'un plan
    // dure au moins `DUREE_PLAN_MIN_SECONDES` : le plus petit défaut possible
    // — un plan omis, tronqué ou dupliqué — déplace donc la durée finale d'au
    // moins une seconde. Même au nombre maximal de plans, la tolérance reste
    // une fraction de cette seconde, et un tel défaut est détecté.
    expect(toleranceDuree(30, SOURCES_MAX)).toBeLessThan(DUREE_PLAN_MIN_SECONDES);
    expect(toleranceDuree(24, SOURCES_MAX)).toBeLessThan(DUREE_PLAN_MIN_SECONDES);
    // Avec une marge d'au moins quatre fois, y compris au pire cas — à 24 i/s
    // sur six plans, le rapport vaut exactement quatre, et c'est le plancher.
    expect(DUREE_PLAN_MIN_SECONDES / toleranceDuree(24, SOURCES_MAX))
      .toBeGreaterThanOrEqual(4);
    expect(DUREE_PLAN_MIN_SECONDES / toleranceDuree(30, SOURCES_MAX))
      .toBeGreaterThan(4);

    // Un plan manquant sur le montage réel est bien vu comme non conforme.
    expect(dureeConforme(25 - DUREE_PLAN_MIN_SECONDES, 25, 30, 5)).toBe(false);
    // Et un simple arrondi de support reste conforme.
    expect(dureeConforme(25 + quantum, 25, 30, 5)).toBe(true);
  });

  it('LA RÉSOLUTION N’A AUCUNE TOLÉRANCE', () => {
    // `scale` produit exactement les dimensions demandées. Un pixel d'écart
    // signifierait que le recadrage de M3-G n'a pas été appliqué tel quel.
    expect(resolutionConforme(1080, 1920, 1080, 1920)).toBe(true);
    expect(resolutionConforme(1081, 1920, 1080, 1920)).toBe(false);
    expect(resolutionConforme(1080, 1919, 1080, 1920)).toBe(false);
    expect(resolutionConforme(null, 1920, 1080, 1920)).toBe(false);
    // La cadence, elle, tolère la conversion de fraction de ffprobe.
    expect(TOLERANCE_FPS).toBeLessThan(0.01);
    expect(TOLERANCE_FPS).toBeGreaterThan(0);
  });

  it('AUCUNE TOLÉRANCE DE MONTAGE : ce contrat ne rejuge rien', () => {
    // ⚠️ LE TEST QUI EMPÊCHE M3-H DE REDEVENIR M3-G. Une tolérance de coupe,
    // une garde de durée, une heuristique de recadrage ici signifieraient
    // qu'une décision persistée a été recalculée.
    const src = sourceSansCommentaires();
    for (const interdit of ['TOLERANCE_SECONDES', 'gardeDuree', 'recadrer',
      'STRATEGIES_RECADRAGE', 'planifierMontage', 'coupeMaterialisable',
      'DUREE_PLAN_MIN', 'RACCORD']) {
      expect(src, `M3-H ne doit pas contenir ${interdit}`).not.toContain(interdit);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('19-23. Les vocabulaires fermés', () => {
  it('les états sont fermés', () => {
    expect(ETATS_RENDU).toEqual(['en_attente', 'en_cours', 'reussie', 'echouee', 'annulee']);
    expect(etatRenduValide('reussie')).toBe(true);
    expect(etatRenduValide('rendering')).toBe(false);
    expect(etatRenduValide('')).toBe(false);
    expect(etatRenduValide(null)).toBe(false);
  });

  it('les étapes sont QUATRE frontières techniques réelles', () => {
    // Chacune a ses propres modes d'échec ; un cinquième palier décoratif
    // n'apporterait aucun diagnostic que les quatre ne donnent déjà.
    expect(ETAPES_RENDU).toEqual(['source', 'encodage', 'mesure', 'televersement']);
    expect(ETAPES_RENDU).toHaveLength(4);
    expect(etapeRenduValide('encodage')).toBe(true);
    expect(etapeRenduValide('preparation')).toBe(false);
    expect(etapeRenduValide('finalisation')).toBe(false);
  });

  it('les motifs sont fermés, utiles, et sans sortie brute', () => {
    expect(MOTIFS_RENDU).toEqual([
      'plan_non_conforme', 'source_inaccessible', 'clip_illisible', 'outil_absent',
      'encodage_echoue', 'delai_depasse', 'resultat_invalide',
      'televersement_echoue', 'capacite_saturee', 'rendu_interrompu',
    ]);
    expect(motifRenduValide('encodage_echoue')).toBe(true);
    expect(MOTIF_RENDU_INTERROMPU).toBe('rendu_interrompu');

    // ⚠️ `plan_introuvable` N'EST PAS UN MOTIF. Un plan inconnu — ou
    // appartenant à autrui — est un 404 de la route, jamais une ligne
    // persistée. Un motif ne décrit que l'échec d'un travail COMMENCÉ.
    expect(MOTIFS_RENDU as readonly string[]).not.toContain('plan_introuvable');
    // Ni un fourre-tout que rien ne permettrait de diagnostiquer.
    expect(MOTIFS_RENDU as readonly string[]).not.toContain('rendu_echoue');
    expect(MOTIFS_RENDU as readonly string[]).not.toContain('erreur');

    // Chaque étape a au moins un motif qui lui correspond.
    for (const m of MOTIFS_RENDU) expect(m.length).toBeLessThanOrEqual(40);
  });

  it('un résultat relu est REVALIDÉ, clé comprise', () => {
    const bon = {
      bucket: 'videos', cle: cleRendu(UID, RID), octets: 12345,
      dureeMesureeSecondes: 25.02, largeur: 1080, hauteur: 1920,
      fpsMesure: 30, codecVideo: 'h264', aAudio: true, codecAudio: 'aac',
    };
    expect(renduMaterialiseValide(bon, UID)).toBe(true);
    expect(renduMaterialiseValide({ ...bon, cle: 'https://minio/x.mp4' }, UID)).toBe(false);
    expect(renduMaterialiseValide({ ...bon, octets: 0 }, UID)).toBe(false);
    expect(renduMaterialiseValide({ ...bon, largeur: 0 }, UID)).toBe(false);
    expect(renduMaterialiseValide({ ...bon, codecVideo: '' }, UID)).toBe(false);
    expect(renduMaterialiseValide({ ...bon, aAudio: 'oui' }, UID)).toBe(false);
    // Une clé qui appartient à quelqu'un d'autre ne passe pas.
    expect(renduMaterialiseValide(bon, 'autre-utilisateur')).toBe(false);
    expect(renduMaterialiseValide(null, UID)).toBe(false);
  });

  it('un plan est jugé EXÉCUTABLE, jamais rejugé sur le fond', () => {
    const plan = {
      plans: [1, 2, 3, 4, 5], dureeTotaleSecondes: 25,
      largeurCible: 1080, hauteurCible: 1920, fps: 30,
    };
    expect(planRendable(plan)).toBe(true);
    expect(planRendable({ ...plan, plans: [] })).toBe(false);
    expect(planRendable({ ...plan, plans: new Array(SOURCES_MAX + 1).fill(1) })).toBe(false);
    expect(planRendable({ ...plan, dureeTotaleSecondes: 0 })).toBe(false);
    expect(planRendable({ ...plan, dureeTotaleSecondes: DUREE_RENDU_MAX_SECONDES + 1 })).toBe(false);
    expect(planRendable({ ...plan, fps: 0 })).toBe(false);
    expect(planRendable({ ...plan, largeurCible: null })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('24-30. Ce que le contrat n’accepte ni n’importe', () => {
  it('LE CORPS ATTENDU EST VIDE, et tout paramètre de rendu est REFUSÉ', () => {
    // ⚠️ Contrairement à M3-G, où le format et la durée cible étaient de
    // vraies demandes de l'utilisateur, il n'existe ici AUCUN paramètre de
    // rendu légitime : tout est lu dans le plan persisté.
    expect(CORPS_RENDU_ATTENDU_VIDE).toBe(true);
    for (const interdit of ['clips', 'plans', 'debutSecondes', 'finSecondes',
      'recadrage', 'crop', 'largeur', 'hauteur', 'width', 'height', 'fps',
      'codec', 'crf', 'preset', 'audio', 'bucket', 'cle', 'cleObjet', 'url',
      'args', 'ffmpeg', 'composition', 'duree', 'methode', 'force',
      'regenerate', 'userId', 'user_id']) {
      expect(CHAMPS_INTERDITS_RENDU as readonly string[],
        `« ${interdit} » doit être refusé`).toContain(interdit);
    }
    // Aucun doublon dans la liste.
    expect(new Set(CHAMPS_INTERDITS_RENDU).size).toBe(CHAMPS_INTERDITS_RENDU.length);
  });

  it('AUCUN crédit, AUCUNE facturation', () => {
    const src = sourceSansCommentaires();
    expect(src).not.toMatch(/@\/lib\/credits|credit_transactions|debiter|deduireCredits/);
    expect(src).not.toMatch(/from '@\/lib\/rendus|tarifs_rendu|transaction_id/);
  });

  it('AUCUN fournisseur, AUCUN modèle de langage, AUCUN appel sortant', () => {
    const src = sourceSansCommentaires();
    expect(src).not.toMatch(/anthropic|groq|openai|claude|gpt/i);
    expect(src).not.toMatch(/\bfetch\s*\(|axios|https?:\/\//);
  });

  it('AUCUN `render_jobs`, `rendus`, `videos` ni `scheduled_posts`', () => {
    const src = sourceSansCommentaires();
    expect(src).not.toContain('render_jobs');
    expect(src).not.toContain('composition_id');
    expect(src).not.toContain('input_props');
    expect(src).not.toContain('output_url');
    expect(src).not.toMatch(/from\('rendus'\)|from\('videos'\)|scheduled_posts/);
  });

  it('AUCUNE exécution : H1 ne contient que des constantes et du calcul pur', () => {
    const src = sourceSansCommentaires();
    // Pas de processus, pas de disque, pas de réseau, pas de base.
    expect(src).not.toMatch(/execFile|spawn|child_process|ffmpeg\(|ffprobe\(/);
    expect(src).not.toMatch(/readFile|writeFile|mkdtemp|unlink|rmdir/);
    expect(src).not.toMatch(/supabase|clientMinio|putObject|presignedGetObject/);
    expect(src).not.toMatch(/remotion|renderMedia|renderVideo/i);
    // Ni horloge : un contrat qui lit l'heure n'est plus déterministe.
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(/);
  });

  it('AUCUNE anticipation de M3-I ni de l’habillage', () => {
    const src = codeSansInterdictions();
    // ⚠️ DES MOTS ENTIERS, PAS DES SOUS-CHAÎNES. « lut » vit dans
    // « resolution » et « absolute » ; chercher la sous-chaîne ferait rougir
    // le test sur du vocabulaire parfaitement légitime.
    for (const interdit of ['sous-titre', 'subtitle', 'musicUrl', 'watermark',
      'thumbnail', 'miniature', 'publish', 'publier', 'lut', 'scheduled']) {
      const motEntier = new RegExp(`\\b${interdit.replace('-', '.')}\\b`, 'i');
      expect(src, `M3-H (H1) ne doit pas anticiper ${interdit}`).not.toMatch(motEntier);
    }
  });

  it('AUCUN fichier M3-A à M3-G n’est modifié par ce lot', () => {
    // H1 ne crée qu'un contrat ; il LIT M3-F et M3-G sans les réécrire.
    const src = source();
    expect(src).toContain("from './clip-contrat'");
    expect(src).toContain("from './montage-contrat'");
    // Et il ne redéfinit aucune de leurs constantes structurantes.
    const sansCommentaires = sourceSansCommentaires();
    expect(sansCommentaires).not.toMatch(/export const (CLIPS_MAX|SET_SECONDES_MAX|PLANS_MAX) =/);
    expect(sansCommentaires).not.toMatch(/export const (ALGORITHME_PLAN|METHODE_MATERIALISATION) =/);
  });
});
