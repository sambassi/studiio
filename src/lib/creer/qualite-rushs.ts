/**
 * M1 — QUALITÉ DES RUSHES : diagnostic MESURÉ, recommandations VISIBLES.
 *
 * Fonction PURE, sans IA, sans nouvel échantillonnage : elle relit les
 * mesures déjà produites par l'analyse d'un rush (`AnalyseRush`, navigateur
 * dans Créer, ffmpeg dans l'Autopilote — même arithmétique `mesurerImage`).
 *
 * ⚠️ CE MODULE NE DÉCIDE RIEN. Il ne change ni le plan (`planMontage`) ni le
 * fichier final : il rend un verdict par rush (`ok | a_verifier |
 * inutilisable`) avec des motifs CHIFFRÉS. C'est l'utilisateur qui écarte un
 * rush (Créer), et l'Autopilote se contente d'écrire le diagnostic.
 *
 * ── Ce que les mesures valent, honnêtement ──────────────────────────────
 * Les images sont réduites à 64×36 avant mesure : la « netteté » (laplacien)
 * y mesure surtout la richesse de détails à grande échelle, qui dépend
 * AUTANT de la scène que de la mise au point. Un plan doux mais net peut
 * valoir 0,07 ; un plan très flou 0,03. D'où des seuils prudents, un
 * plancher ABSOLU croisé avec une comparaison RELATIVE aux autres rushes, et
 * aucun verdict « inutilisable » sur un critère faible isolé.
 *
 * ── Règle de verdict ─────────────────────────────────────────────────────
 *  - chaque motif est `fort` ou `faible` ;
 *  - `inutilisable` : au moins un motif FORT, non neutralisé par une
 *    protection (scène nocturne contrastée, flou avec mouvement) ;
 *  - `a_verifier` : au moins un motif ;
 *  - `ok` sinon.
 * Un motif fort repose toujours sur DEUX mesures concordantes (ex. flou :
 * plancher absolu ET écart aux autres rushes ; noir : luminance ET absence de
 * zones claires).
 */
import { candidatsDuRush, cleSource, SEUILS } from '@/lib/creer/smart-montage';
import type { AnalyseRushQualite, NetteteHD } from '@/lib/creer/nettete-hd';

export const VERSION_QUALITE_RUSHS = 1 as const;

/**
 * Seuils (mesures 0..1 sauf mention). Calibrés le 16/10/2026 sur 6 rushes
 * réels 1080×1920 (2 rushes utilisateur, 4 plans stock) et leurs versions
 * dégradées (ffmpeg) — voir `qualite-rushs.test.ts`.
 */
export const SEUILS_QUALITE = {
  /**
   * Plancher ABSOLU de netteté médiane. Plus doux rush réel mesuré : 0,054
   * (début d'un rush utilisateur) et 0,070 (plan stock) ; rush flouté
   * (`boxblur=20`) : 0,033. Le plancher passe entre les deux, côté prudent.
   */
  netetePlancher: 0.045,
  /**
   * Netteté relative : sous cette fraction de la médiane des AUTRES rushes.
   * Plus bas que le seuil par image du moteur (`SEUILS.flouRelatif`, 0,35) :
   * entre rushes RÉELS nets, la netteté varie déjà d'un facteur 4 (0,071 à
   * 0,30 mesurés, soit un rapport 0,30 au médian) selon la scène. Sous 0,25,
   * l'écart dépasse cette dispersion naturelle.
   */
  neteteRelative: 0.25,
  /** Un rush SEUL, sans point de comparaison : flou fort seulement sous ce plancher extrême. */
  netetePlancherSeul: 0.025,
  /**
   * NETTETÉ QUALITÉ (`netteteHD`, 320×320 — prioritaire quand elle existe).
   * Finesse (détail fin / détail à mi-résolution) : rushes réels nets et
   * plans fixes, plage, interview mesurés 0,586–0,78 ; boxblur 8–10 : 0,33–0,46 ;
   * boxblur 4 : 0,44–0,59. Seuil entre les deux, côté prudent.
   * Navigateur (canvas, lissage « high ») : réels 0,69–0,89, boxblur 8–10
   * 0,37–0,45, boxblur 4 0,48 — mêmes verdicts, marge plus grande.
   */
  finesseFlou: 0.55,
  /**
   * Détail fin (contraste local en 320×320) : un flou très fort (boxblur ≥ 20)
   * remonte la finesse (plus aucun détail à aucune échelle) mais écrase le
   * détail : 0,0024–0,0050 mesurés, contre 0,0192 au minimum pour un rush
   * réel net et 0,0109 pour une plage surexposée.
   */
  detailPlancher: 0.008,
  /** Détail fin relatif aux autres rushes (même logique que `neteteRelative`). */
  detailRelatif: 0.25,
  /** Rush SEUL : flou fort seulement sous ce détail extrême. */
  detailPlancherSeul: 0.005,
  /**
   * Luminance : le serveur lit le plan Y (ffmpeg `format=gray`), le navigateur
   * le RVB du canvas. Écart constaté (16/10) seulement sur des noirs « sous le
   * noir » (Y < 16) qui gardent de la chrominance — typique d'un assombrissement
   * artificiel (`eq=brightness`) : Y=5, chroma neutre → 0 des deux côtés ;
   * Y=5 avec chroma → 0 serveur, 0,063 navigateur. Les niveaux 16–235 sont
   * correctement étendus des deux côtés (Y=16 → 0). Non harmonisé : ces
   * mesures nourrissent aussi `planMontage`, qu'on ne touche pas.
   */
  /** Luminance médiane sous laquelle le rush est « sombre » (à vérifier). */
  luminanceSombre: 0.12,
  /** Luminance médiane sous laquelle l'image est quasi noire (motif fort). */
  luminanceNoire: 0.03,
  /** Luminance médiane au-delà de laquelle le rush est « surexposé » (à vérifier). */
  luminanceSurexposee: 0.85,
  /** Luminance médiane au-delà de laquelle l'image est quasi blanche (motif fort). */
  luminanceCramee: 0.93,
  /**
   * Contraste (écart max − min des 64 blocs de l'empreinte 8×8, médiane du
   * rush) à partir duquel une scène sombre ou claire garde des zones
   * lisibles : nuit avec lumières, contre-jour. Rush assombri uniformément :
   * 0,089 ; nuit contrastée simulée : 0,151.
   */
  contrasteScene: 0.12,
  /** Sous ce contraste, l'image est quasi uniforme (vide) — motif fort. */
  contrasteVide: 0.04,
  /** Différence entre deux images sous laquelle elles sont identiques. */
  mouvementFige: 0.002,
  /** Part d'images identiques à la précédente au-delà de laquelle le rush est figé. */
  partFigee: 0.9,
  /**
   * Mouvement médian à partir duquel un flou uniforme est sans doute un
   * filé / un effet (1/3 du mouvement d'un plan franchement actif).
   */
  mouvementFile: SEUILS.mouvementReference / 3,
  /** Durée en dessous de laquelle aucune analyse n'est possible (s) — `mesurerSourceLue`, `analyserRush`. */
  dureeAnalyseMin: 1,
  /** Durée utile minimale (s) : la longueur minimale d'un extrait du moteur. */
  dureeUtileMin: 1.5,
} as const;

export type VerdictRush = 'ok' | 'a_verifier' | 'inutilisable';
export type CodeMotif = 'flou' | 'trop_sombre' | 'surexpose' | 'quasi_vide' | 'fige' | 'trop_court';

export interface MotifQualite {
  code: CodeMotif;
  gravite: 'fort' | 'faible';
  /** Phrase affichable, chiffrée (« flou : netteté 0,03 contre 0,18 pour vos autres rushes, seuil 0,045 »). */
  texte: string;
  /** La mesure du rush et le seuil franchi. */
  mesure: number;
  seuil: number;
  /** Mesure de comparaison (autres rushes), quand elle existe. */
  reference?: number | null;
}

export interface PassageQualite { depuis: number; jusqua: number; qualite: number }

export interface QualiteRush {
  url: string;
  cle: string;
  verdict: VerdictRush;
  motifs: MotifQualite[];
  /** Protections appliquées (motif fort ramené à « à vérifier »). */
  protections: string[];
  /** Rush choisi explicitement par l'utilisateur : jamais écarté sans le lui dire. */
  choisiParVous: boolean;
  mesures: {
    images: number;
    duree: number;
    nettete: number;
    luminosite: number;
    contraste: number | null;
    mouvement: number;
    partFigee: number;
    dureeUtile: number;
    /** Netteté qualité 320×320 (`nettete-hd.ts`), `null` si non mesurée. */
    netteteHD: NetteteHD | null;
  };
  /** Meilleures fenêtres déjà notées par le moteur (`candidatsDuRush`), 3 au plus. */
  meilleursPassages: PassageQualite[];
}

export interface DiagnosticQualiteRushs {
  version: typeof VERSION_QUALITE_RUSHS;
  rushs: QualiteRush[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mediane = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Nombre à la française, 2 décimales significatives (« 0,21 », « 0,045 »). */
const fr = (n: number, dec = 2) => {
  const p = Math.abs(n) > 0 && Math.abs(n) < 0.1 ? Math.max(dec, 3) : dec;
  return String(Number(n.toFixed(p))).replace('.', ',');
};
const pct = (x: number) => `${Math.round(x * 100)} %`;
/** Mesure affichée face à son seuil : jamais « 0,12 < 0,12 » (une décimale de plus si l'arrondi les confond). */
const frFace = (mesure: number, seuil: number) => (fr(mesure) === fr(seuil) ? String(Number(mesure.toFixed(3))).replace('.', ',') : fr(mesure));

/** Mesures agrégées d'un rush. `null` sans échantillon exploitable. */
function mesurer(a: AnalyseRushQualite) {
  const e = a.echantillons;
  if (!(a.duree > 0) || e.length === 0) return null;
  const nettete = mediane(e.map((x) => x.nettete));
  const luminosite = mediane(e.map((x) => x.luminosite));
  const avecEmpreinte = e.filter((x) => Array.isArray(x.empreinte) && x.empreinte.length > 0);
  // Contraste de scène : non mesuré sans empreinte (analyses anciennes / neutres).
  const contraste = avecEmpreinte.length === e.length
    ? mediane(avecEmpreinte.map((x) => Math.max(...(x.empreinte as number[])) - Math.min(...(x.empreinte as number[]))))
    : null;
  // Le 1er échantillon n'a pas de précédent : mouvement 0 par construction.
  const mouvs = e.slice(1).map((x) => x.mouvement);
  const mouvement = mediane(mouvs);
  const partFigee = mouvs.length ? mouvs.filter((m) => m < SEUILS_QUALITE.mouvementFige).length / mouvs.length : 0;
  // Durée utile : part des images ni noires ni cramées (mêmes seuils que le moteur).
  const bonnes = e.filter((x) => x.luminosite >= SEUILS.noir && x.luminosite <= SEUILS.crame).length / e.length;
  const hd: NetteteHD | null = a.netteteHD && a.netteteHD.images > 0 ? a.netteteHD : null;
  return { images: e.length, duree: a.duree, nettete, luminosite, contraste, mouvement, partFigee, dureeUtile: a.duree * bonnes, hd };
}

/**
 * Diagnostic de qualité de chaque rush. Pur, déterministe.
 *
 * @param analyses mesures déjà calculées (une par rush ; doublons ignorés)
 * @param options.choisisParUtilisateur URL des rushes choisis explicitement
 *   par l'utilisateur (C-MEDIA-MANUAL) : signalés « choisi par vous ».
 */
export function evaluerQualiteRushs(
  analyses: ReadonlyArray<AnalyseRushQualite>,
  options: { choisisParUtilisateur?: Iterable<string> | null } = {},
): DiagnosticQualiteRushs {
  const S = SEUILS_QUALITE;
  const choisis = new Set(Array.from(options.choisisParUtilisateur ?? [], (u) => cleSource(u)));
  const vus = new Set<string>();
  const rushs = analyses
    .filter((a) => { const k = cleSource(a.url); if (vus.has(k)) return false; vus.add(k); return true; })
    .map((a) => ({ a, cle: cleSource(a.url), m: mesurer(a) }))
    .filter((x): x is { a: AnalyseRushQualite; cle: string; m: NonNullable<ReturnType<typeof mesurer>> } => x.m !== null);

  const out: QualiteRush[] = rushs.map(({ a, cle, m }) => {
    const motifs: MotifQualite[] = [];
    const protections: string[] = [];
    const contrastee = m.contraste !== null && m.contraste >= S.contrasteScene;
    const enMouvement = m.mouvement >= S.mouvementFile;

    // ── EXPOSITION ──
    const sombre = m.luminosite < S.luminanceSombre;
    const clair = m.luminosite > S.luminanceSurexposee;
    if (sombre) {
      const noir = m.luminosite < S.luminanceNoire && !contrastee;
      if (m.luminosite < S.luminanceNoire && contrastee) protections.push(`scène sombre mais contrastée (contraste ${fr(m.contraste as number)} ≥ ${fr(S.contrasteScene)}) : nuit possible`);
      motifs.push({
        code: 'trop_sombre', gravite: noir ? 'fort' : 'faible',
        texte: `trop sombre : luminance moyenne ${frFace(m.luminosite, S.luminanceSombre)} < ${fr(S.luminanceSombre)}${noir ? ', image quasi noire' : ''}`,
        mesure: r3(m.luminosite), seuil: S.luminanceSombre,
      });
    } else if (clair) {
      const blanc = m.luminosite > S.luminanceCramee && !contrastee;
      if (m.luminosite > S.luminanceCramee && contrastee) protections.push(`scène claire mais contrastée (contraste ${fr(m.contraste as number)} ≥ ${fr(S.contrasteScene)})`);
      motifs.push({
        code: 'surexpose', gravite: blanc ? 'fort' : 'faible',
        texte: `surexposé : luminance moyenne ${frFace(m.luminosite, S.luminanceSurexposee)} > ${fr(S.luminanceSurexposee)}${blanc ? ', image quasi blanche' : ''}`,
        mesure: r3(m.luminosite), seuil: S.luminanceSurexposee,
      });
    }

    // ── IMAGE VIDE (uniforme) ──
    if (m.contraste !== null && m.contraste < S.contrasteVide) {
      motifs.push({
        code: 'quasi_vide', gravite: 'fort',
        texte: `quasi vide : image uniforme (contraste ${fr(m.contraste)} < ${fr(S.contrasteVide)})`,
        mesure: r3(m.contraste), seuil: S.contrasteVide,
      });
    }

    // ── NETTETÉ ── jugée seulement sur une image bien exposée (le laplacien
    // d'une image noire ou blanche est faible quelle que soit la mise au point).
    if (!sombre && !clair) {
      const autresBienExposes = rushs.filter((x) => x.cle !== cle).map((x) => x.m)
        .filter((x) => x.luminosite >= S.luminanceSombre && x.luminosite <= S.luminanceSurexposee);
      const flou = m.hd
        ? jugerFlouHD(m.hd, autresBienExposes.filter((x) => x.hd).map((x) => (x.hd as NetteteHD).detail))
        : jugerFlou64(m.nettete, autresBienExposes.map((x) => x.nettete));
      if (flou) {
        if (flou.fort && enMouvement) protections.push(`flou avec mouvement (mouvement ${fr(m.mouvement)} ≥ ${fr(S.mouvementFile)}) : filé ou effet possible`);
        motifs.push({ ...flou.motif, gravite: flou.fort && !enMouvement ? 'fort' : 'faible' });
      }
    }

    // ── IMAGE FIGÉE ── jamais un motif fort : un plan fixe peut être voulu.
    if (m.images >= 3 && m.partFigee >= S.partFigee) {
      motifs.push({
        code: 'fige', gravite: 'faible',
        texte: `image figée : ${pct(m.partFigee)} des images identiques à la précédente`,
        mesure: r2(m.partFigee), seuil: S.partFigee,
      });
    }

    // ── DURÉE UTILE ──
    // Les images noires ou cramées sont déjà dites par le motif d'exposition :
    // une scène de nuit n'est pas « 0 s utiles », elle est sombre. La durée
    // est alors jugée sur la durée du rush elle-même.
    const exposition = sombre || clair;
    const dureeJugee = exposition ? m.duree : m.dureeUtile;
    if (dureeJugee < S.dureeUtileMin) {
      motifs.push({
        code: 'trop_court', gravite: 'faible',
        texte: exposition
          ? `trop court : ${fr(dureeJugee, 1)} s (minimum ${fr(S.dureeUtileMin, 1)} s)`
          : `trop court : ${fr(dureeJugee, 1)} s utiles (minimum ${fr(S.dureeUtileMin, 1)} s)`,
        mesure: r2(dureeJugee), seuil: S.dureeUtileMin,
      });
    }

    const verdict: VerdictRush = motifs.some((x) => x.gravite === 'fort') ? 'inutilisable' : motifs.length ? 'a_verifier' : 'ok';
    const meilleursPassages = candidatsDuRush(a, Math.min(2, a.duree))
      .sort((x, y) => y.qualite - x.qualite || x.depuis - y.depuis)
      .slice(0, 3)
      .map((c) => ({ depuis: c.depuis, jusqua: c.jusqua, qualite: c.qualite }));
    return {
      url: a.url, cle, verdict, motifs, protections,
      choisiParVous: choisis.has(cle),
      mesures: {
        images: m.images, duree: r2(m.duree), nettete: r3(m.nettete), luminosite: r3(m.luminosite),
        contraste: m.contraste === null ? null : r3(m.contraste), mouvement: r3(m.mouvement),
        partFigee: r2(m.partFigee), dureeUtile: r2(m.dureeUtile),
        netteteHD: m.hd,
      },
      meilleursPassages,
    };
  });
  return { version: VERSION_QUALITE_RUSHS, rushs: out };
}

type MotifSansGravite = Omit<MotifQualite, 'gravite'>;

/**
 * Flou d'après la netteté QUALITÉ (320×320). Faible : finesse basse, ou
 * détail sous le plancher, ou très en dessous des autres rushes. Fort : détail
 * sous le plancher ET (finesse basse OU très en dessous des autres) — rush
 * seul : détail sous le plancher extrême.
 */
function jugerFlouHD(hd: NetteteHD, detailsAutres: number[]): { fort: boolean; motif: MotifSansGravite } | null {
  const S = SEUILS_QUALITE;
  const reference = detailsAutres.length ? mediane(detailsAutres) : null;
  const finesseBasse = hd.finesse < S.finesseFlou;
  const sousPlancher = hd.detail < S.detailPlancher;
  const sousRelatif = reference !== null && hd.detail < reference * S.detailRelatif;
  if (!finesseBasse && !sousPlancher && !sousRelatif) return null;
  const fort = reference !== null ? sousPlancher && (finesseBasse || sousRelatif) : hd.detail < S.detailPlancherSeul;
  const comparaison = reference !== null ? ` contre ${fr(reference)} pour vos autres rushes` : '';
  const texte = finesseBasse
    ? `flou : finesse ${frFace(hd.finesse, S.finesseFlou)} < ${fr(S.finesseFlou)} (détail fin ${fr(hd.detail)}${comparaison})`
    : `flou : détail fin ${frFace(hd.detail, sousPlancher ? S.detailPlancher : r3((reference as number) * S.detailRelatif))}${comparaison}, seuil ${fr(sousPlancher ? S.detailPlancher : r3((reference as number) * S.detailRelatif))}`;
  return {
    fort,
    motif: {
      code: 'flou', texte,
      mesure: finesseBasse ? r3(hd.finesse) : r3(hd.detail),
      seuil: finesseBasse ? S.finesseFlou : sousPlancher ? S.detailPlancher : r3((reference as number) * S.detailRelatif),
      reference: reference === null ? null : r3(reference),
    },
  };
}

/** Repli sans netteté qualité (analyses antérieures) : netteté 64×36 du moteur. */
function jugerFlou64(nettete: number, netetesAutres: number[]): { fort: boolean; motif: MotifSansGravite } | null {
  const S = SEUILS_QUALITE;
  const reference = netetesAutres.length ? mediane(netetesAutres) : null;
  const sousPlancher = nettete < S.netetePlancher;
  const sousRelatif = reference !== null && nettete < reference * S.neteteRelative;
  if (!sousPlancher && !sousRelatif) return null;
  const fort = reference !== null ? sousPlancher && sousRelatif : nettete < S.netetePlancherSeul;
  const comparaison = reference !== null ? ` contre ${fr(reference)} pour vos autres rushes` : '';
  const seuil = sousPlancher ? S.netetePlancher : r3((reference as number) * S.neteteRelative);
  return {
    fort,
    motif: { code: 'flou', texte: `flou : netteté ${frFace(nettete, seuil)}${comparaison}, seuil ${fr(seuil)}`, mesure: r3(nettete), seuil, reference: reference === null ? null : r3(reference) },
  };
}

const LIBELLE_MOTIF: Record<CodeMotif, string> = {
  flou: 'flou', trop_sombre: 'trop sombre', surexpose: 'surexposé', quasi_vide: 'quasi vide', fige: 'image figée', trop_court: 'trop court',
};

/** Badge affichable : « À vérifier : flou », « Inutilisable : trop sombre », `null` si ok. */
export function libelleQualite(q: Pick<QualiteRush, 'verdict' | 'motifs'>): string | null {
  if (q.verdict === 'ok') return null;
  const principal = q.motifs.find((x) => x.gravite === 'fort') ?? q.motifs[0];
  const tete = q.verdict === 'inutilisable' ? 'Inutilisable' : 'À vérifier';
  return principal ? `${tete} : ${LIBELLE_MOTIF[principal.code]}` : tete;
}

/**
 * ⚠️ `decisionMontage.qualiteRushs` est un DIAGNOSTIC CONSULTATIF, pas une
 * décision : malgré le nom de la clé (gardé pour la suite de la tranche),
 * rien n'y est appliqué. Écrit À L'IDENTIQUE par Créer (export) et par
 * l'Autopilote (`produire.ts`) — une seule version (`version: 1`).
 *
 * Forme compacte écrite dans `metadata.decisionMontage.qualiteRushs` (v1) :
 * verdicts + motifs + version — aucune URL signée, aucune mesure brute
 * superflue. Lecture seule : aucun rendu ne la relit.
 */
export function qualiteRushsPourMetadata(d: DiagnosticQualiteRushs) {
  return {
    version: d.version,
    rushs: d.rushs.map((q) => ({
      cle: q.cle,
      verdict: q.verdict,
      motifs: q.motifs.map(({ code, gravite, texte }) => ({ code, gravite, texte })),
      ...(q.protections.length ? { protections: q.protections } : null),
      ...(q.choisiParVous ? { choisiParVous: true } : null),
    })),
  };
}
