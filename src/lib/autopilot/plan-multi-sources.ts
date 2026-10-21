/**
 * PLAN MULTI-SOURCES — l'orchestrateur PUR de la séquence « Vidéo » de
 * l'Autopilote quand plusieurs sources se combinent (voir `sources.ts`).
 *
 * Sources INDÉPENDANTES et COMBINABLES : avatar (jumeau), rushes personnels,
 * vidéos stock importées, photos stock retenues. Une seule sortie : un plan
 * `RushSegment[]` contigu, de 0 à la durée de la séquence, que le rendu
 * (Remotion `CreerSimpleMontage`) joue tel quel.
 *
 * ── Priorités (règle produit, absolue) ──────────────────────────────────
 *   choix explicites (gabarit) > avatar > rushes personnels > stock vidéo > photos.
 * Le stock COMPLÈTE, il ne remplace jamais en silence des rushes personnels :
 * tant qu'un extrait de rush reste disponible, aucun média stock n'est pris.
 *
 * ── Avec avatar ─────────────────────────────────────────────────────────
 * La durée de la séquence = la durée de la parole de l'avatar. L'avatar
 * ouvre (accroche) et ferme (CTA) ; au milieu, il alterne avec des plans de
 * coupe (B-roll, 2–4 s). INVARIANT LIP-SYNC : chaque extrait d'avatar a
 * `depuis === debut` et une vitesse 1 — l'image de l'avatar à l'instant t est
 * celle de sa voix à l'instant t (la voix, continue, est jouée à part).
 *
 * ── Sans avatar ─────────────────────────────────────────────────────────
 * Les rushes suivent le moteur de Créer (`planMontage`) ; le stock ne vient
 * qu'APRÈS, là où la matière des rushes manque pour atteindre la cible.
 *
 * ── Autopilote : le plan montré = le plan rendu ─────────────────────────
 * Sans gabarit ENREGISTRÉ, `produire.ts` passe la suggestion affichée à
 * l'écran (`gabaritSuggere`, même fonction, mêmes sources) : l'utilisateur
 * voit l'ordre des types que le rendu suivra. Les chemins « sans gabarit »
 * ci-dessous restent ceux des appels directs.
 *
 * Déterministe (aucun hasard, aucune horloge), explicable (`explications`,
 * `raison` par plan), sans réseau.
 */
import { planMontage, dureeCibleMontage, plansPropres, type AnalyseRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import { cibleVideoDuBrief } from '@/lib/autopilot/duree-cible';
import type { RushSegment, MouvementImage, SourceSegment } from '@/lib/creer/multi-rush';
import type { CreneauGabarit } from '@/lib/autopilot/sources';
import { accordAvecTexte, type NiveauPertinenceMedia } from '@/lib/autopilot/pertinence-medias';

export interface SourceVideoPlan {
  url: string;
  /** Durée sondée (s) ; `null` = inconnue (on suppose `BROLL_VIDEO_S`). */
  secondes: number | null;
}

export interface EntreePlanMultiSources {
  /** Vidéo du jumeau, déjà générée — sa durée fixe celle de la séquence. */
  avatar?: { url: string; secondes: number } | null;
  /** Rushes PERSONNELS (déjà filtrés par `actives.rushes`). */
  rushes?: ReadonlyArray<SourceVideoPlan>;
  /** Analyses des rushes personnels (facultatif) : extraits choisis par `planMontage`. */
  analyses?: ReadonlyArray<AnalyseRush>;
  /** Vidéos stock (importées dans la Médiathèque ou retenues). */
  stockVideos?: ReadonlyArray<SourceVideoPlan>;
  /** Photos stock retenues (URL fournisseur ou stockage). */
  photos?: ReadonlyArray<string>;
  /** Gabarit du plan édité par l'utilisateur. Vide : l'orchestrateur décide. */
  gabarit?: ReadonlyArray<CreneauGabarit>;
  /** Durée visée SANS avatar (s). Avec avatar : ignorée (durée de la parole). */
  cible: number;
  /** Transmis à `planMontage` (contexte, rythme, plages exclues). */
  options?: OptionsMontage;
  /**
   * PERTINENCE de contenu des médias STOCK pour le scénario de CETTE vidéo
   * (`pertinence-medias.ts`), par URL. Absente : l'ordre reçu, comme avant.
   *   - `hors` : jamais pioché (sauf média forcé par le gabarit) ;
   *   - `limite` : au plus UNE fois, jamais repris ;
   *   - les autres : le plus pertinent d'abord — il OUVRE le montage.
   */
  pertinences?: Readonly<Record<string, { niveau: NiveauPertinenceMedia; score: number; description?: string }>>;
  /**
   * La NARRATION, passage par passage (s, dans la séquence) : la carte
   * affichée et ce qu'elle dit. Un plan de coupe posé pendant un passage
   * préfère le média qui montre ce que dit le passage (« bagage cabine » →
   * une valise). Absente : aucun rapprochement.
   */
  narration?: ReadonlyArray<{ debut: number; fin: number; texte: string }>;
  /**
   * AVEC AVATAR : la durée TOTALE visée (durée cible du brief, s). La parole
   * n'est JAMAIS accélérée ni coupée : quand elle est plus courte que la
   * visée, le montage continue après elle par une SÉQUENCE DE CLÔTURE (un ou
   * deux plans de coupe, musique, CTA à l'écran) jusqu'à
   * `dureeAvecCloture(parole, visée)` — au plus `CLOTURE_MAX_S` après la
   * parole. Parole plus longue que la visée : rien n'est coupé, T = parole.
   * Absente (ou sans avatar) : la règle d'avant, T = parole.
   */
  dureeVisee?: number | null;
}

export interface ResultatPlanMultiSources {
  plan: RushSegment[];
  /** Fin du dernier plan — la durée de la séquence « Vidéo ». */
  duree: number;
  /** Pourquoi ce plan, lisible (journal + métadonnées). */
  explications: string[];
  /**
   * Début (s) de la SÉQUENCE DE CLÔTURE (plans de coupe après la parole de
   * l'avatar, CTA à l'écran jusqu'à la dernière image) ; `null` sans clôture.
   */
  debutCloture: number | null;
  /** Avec avatar : la parole (s) sur laquelle le plan est calé ; `null` sans avatar. */
  parole: number | null;
}

/** Plan de coupe vidéo (s) visé entre deux interventions de l'avatar. */
export const BROLL_VIDEO_S = 3;
/** Photo : 2–3 s. */
export const BROLL_PHOTO_S = 2.5;
export const BROLL_MIN_S = 2;
export const BROLL_MAX_S = 4;
/** Fenêtre d'avatar entre deux plans de coupe. */
export const AVATAR_FENETRE_S = 3;
/** Ordre des mouvements Ken Burns, en alternance. */
export const MOUVEMENTS_PHOTO: readonly MouvementImage[] = ['zoomIn', 'panG', 'zoomOut', 'panD'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const borne = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const EPS = 0.05;

/**
 * LA MATIÈRE d'un montage SANS avatar (s) : chaque vidéo pour sa durée (un
 * plan de coupe si elle est inconnue), chaque photo pour un plan au plus. Pur.
 */
export function matiereSansAvatar(e: Pick<EntreePlanMultiSources, 'rushes' | 'stockVideos' | 'photos'>): number {
  const videos = [...(e.rushes ?? []), ...(e.stockVideos ?? [])];
  return videos.reduce((t, x) => t + (x?.secondes ?? BROLL_VIDEO_S), 0)
    + (e.photos ?? []).length * BROLL_MAX_S;
}

/**
 * LA DURÉE DE LA SÉQUENCE « VIDÉO » d'un montage multi-sources SANS avatar —
 * UNE règle pour le moteur (`produire.ts`) ET l'aperçu (`planCompletAutopilote`) :
 * la durée cible du brief (moins titre, cartes et CTA hors surimpression),
 * sinon ≈ 30 s ; la voix couverte ; jamais plus que la matière. Pur.
 */
export function cibleSequenceSansAvatar(e: {
  brief: { duree?: number } | null | undefined;
  design: { introDuration?: number; cardsDuration?: number; ctaDuration?: number };
  enSurimpression: boolean;
  /** Voix que la séquence doit porter (s) ; 0 si inconnue. */
  voixAPorter: number;
  /** `matiereSansAvatar`. */
  matiere: number;
}): number {
  return Math.min(e.matiere, Math.max(
    cibleVideoDuBrief(e.brief, e.design, e.enSurimpression) ?? dureeCibleMontage(e.matiere),
    Math.ceil(e.voixAPorter),
  ));
}

/** Un média de plan de coupe disponible (un extrait de rush, une vidéo, une photo). */
interface ItemBroll {
  url: string;
  kind: 'video' | 'image';
  source: SourceSegment;
  /** Point d'entrée dans le fichier (vidéo). */
  depuis: number;
  /** Secondes jouables depuis `depuis` (vidéo) ; `Infinity` pour une photo. */
  dispo: number;
  raison: string;
  /** Champs d'analyse repris de `planMontage` (score, phase…). */
  extra?: Partial<RushSegment>;
  /** Pertinence 0..1 pour le scénario (stock) ; 0,5 sans information. */
  score?: number;
  /** Autre activité que le scénario mentionne : au plus une fois. */
  limite?: boolean;
  /**
   * Plafond (s) de l'extrait monté PENDANT LA PAROLE : la suite du fichier
   * est gardée pour la clôture (« autre passage »), stock rare.
   */
  plafond?: number;
  /** Suite réservée à la clôture : jamais reprise pendant la parole. */
  pourCloture?: boolean;
  /** Description du média (rapprochement avec la narration). */
  description?: string;
}

/** Au plus ce temps (s) ajouté APRÈS la parole de l'avatar (séquence de clôture). */
export const CLOTURE_MAX_S = 8;
/** En dessous, aucune clôture : l'écart avec la cible est négligeable. */
export const CLOTURE_MIN_S = 1;
/** Une clôture plus longue se coupe en DEUX plans de coupe. */
export const CLOTURE_UN_PLAN_MAX_S = 4.5;

/**
 * La durée du montage avec avatar : la parole, prolongée jusqu'à la durée
 * visée par une séquence de clôture — jamais plus de `CLOTURE_MAX_S` après la
 * parole, jamais moins que la parole (rien n'est coupé, la voix n'est jamais
 * accélérée). Pur.
 */
export function dureeAvecCloture(parole: number, visee: number | null | undefined): number {
  const p = r3(Math.max(0, parole));
  if (typeof visee !== 'number' || !Number.isFinite(visee) || visee - p < CLOTURE_MIN_S - 1e-6) return p;
  return r3(Math.min(visee, p + CLOTURE_MAX_S));
}

/** Une reprise de média est permise au plus UNE fois par vidéo. */
export const REPRISES_MAX_PAR_MEDIA = 1;

/**
 * Options des extraits de rushes personnels : le smart montage de Créer en
 * UNICITÉ PAR TIMECODE (#613) — un extrait tient dans un PLAN PROPRE du rush
 * (ni coupe franche ni image figée de la source). Sans elle, l'Autopilote
 * démarrait un plan sur la coupe de tête d'un rush (banc : rush-1 depuis 0,
 * coupe à 0,43 s → 0,43 s d'un autre plan au MP4). Un appelant peut encore
 * l'éteindre explicitement (`uniciteParTimecode: false`).
 */
function optionsRushs(e: EntreePlanMultiSources): OptionsMontage {
  return { uniciteParTimecode: true, ...(e.options ?? {}) };
}

/**
 * La RÉSERVE des rushes personnels : rend, à la demande, une fenêtre de `d`
 * secondes jamais encore montée. Elle essaie d'abord les extraits que le
 * smart montage de Créer préfère (`planMontage`, si les rushes sont
 * analysés), puis la première plage libre de chaque rush, en alternance
 * (A, B, A, B…). Jamais deux fois la même plage, jamais au-delà du fichier.
 */
class ReserveRushs {
  private utilisees = new Map<string, Array<[number, number]>>();
  private tour = 0;
  private readonly totaux: Map<string, number>;
  private readonly preferes: Array<{ url: string; depuis: number; extra: Partial<RushSegment>; raison: string }>;
  /**
   * Plans propres MESURÉS (`plansPropres`) des rushes analysés : toute fenêtre
   * tient dans l'un d'eux. Rush sans analyse : absent, fenêtres d'avant.
   */
  private readonly propres = new Map<string, Array<[number, number]>>();
  constructor(e: EntreePlanMultiSources, besoin: number) {
    const rushes = (e.rushes ?? []).filter((x) => x?.url);
    const analyses = (e.analyses ?? []).filter((a) => rushes.some((x) => x.url === a.url));
    this.totaux = new Map(rushes.map((x) => {
      const a = analyses.find((y) => y.url === x.url);
      const t = typeof x.secondes === 'number' && x.secondes > 0 ? x.secondes : a && a.duree > 0 ? a.duree : NaN;
      return [x.url, t];
    }));
    if (optionsRushs(e).uniciteParTimecode) {
      // Aucun plan propre (rush entièrement fixe, ex. plan sur pied) : contrainte
      // ignorée — un rush de l'utilisateur n'est jamais écarté par cette mesure.
      for (const a of analyses) {
        const pp = plansPropres(a);
        if (pp.length && !this.propres.has(a.url)) this.propres.set(a.url, pp);
      }
    }
    this.preferes = [];
    if (analyses.length >= 2 && besoin > 0) {
      const plan = planMontage(analyses, besoin, { ...optionsRushs(e), longueurExtrait: BROLL_VIDEO_S });
      for (const s of plan ?? []) {
        this.preferes.push({
          url: s.url, depuis: s.depuis ?? 0,
          raison: `rush personnel (extrait choisi par le smart montage${s.phase ? `, ${s.phase}` : ''})`,
          extra: { ...(typeof s.score === 'number' ? { score: s.score } : {}), ...(s.phase ? { phase: s.phase } : {}) },
        });
      }
    }
  }
  get vide(): boolean { return this.totaux.size === 0; }
  /** Nombre de rushes personnels distincts dans la réserve. */
  get nombre(): number { return this.totaux.size; }
  private libre(url: string, a: number, b: number): boolean {
    const total = this.totaux.get(url);
    // Durée inconnue : une seule fenêtre, depuis le début.
    if (total === undefined) return false;
    if (Number.isNaN(total)) return a === 0 && !(this.utilisees.get(url)?.length);
    if (b > total + 1e-6) return false;
    const propres = this.propres.get(url);
    if (propres && !propres.some(([x, y]) => a >= x - 1e-6 && b <= y + 1e-6)) return false;
    return !(this.utilisees.get(url) ?? []).some(([x, y]) => a < y - 1e-6 && x < b - 1e-6);
  }
  /** Départs candidats : 0, le début de chaque plan propre, la fin de chaque plage montée. */
  private departs(url: string): number[] {
    return [0, ...(this.propres.get(url) ?? []).map(([x]) => x), ...(this.utilisees.get(url) ?? []).map(([, y]) => y)].sort((x, y) => x - y);
  }
  private reserver(url: string, a: number, b: number) {
    const l = this.utilisees.get(url) ?? [];
    l.push([a, b]);
    this.utilisees.set(url, l);
  }
  /**
   * Une fenêtre DANS ce rush (média forcé par le gabarit) : `d` secondes, ou
   * moins si le fichier est plus court (au moins 1 s) ; `null` s'il n'est pas
   * dans la réserve ou déjà entièrement monté.
   */
  prendreDans(url: string, d: number): ItemBroll | null {
    const total = this.totaux.get(url);
    if (total === undefined) return null;
    // Plan propre plus court que le créneau : sa longueur (au moins 1 s), plutôt que perdre le rush forcé.
    const plusLongPropre = Math.max(0, ...(this.propres.get(url) ?? []).map(([x, y]) => y - x));
    for (const duree of [d, ...(Number.isFinite(total) ? [Math.min(d, total)] : []), ...(this.propres.has(url) ? [r3(Math.min(d, plusLongPropre))] : [])]) {
      if (duree < 1) continue;
      for (const a of this.departs(url)) {
        if (this.libre(url, a, a + duree)) {
          this.reserver(url, a, a + duree);
          return { url, kind: 'video', source: 'rush', depuis: r3(a), dispo: r3(duree), raison: 'rush personnel' };
        }
      }
    }
    return null;
  }
  /**
   * Créneau « rush » imposé : une fenêtre de `d` s si possible, sinon la plus
   * longue qu'un rush offre encore (au moins 1 s) — un créneau « Rush » du plan
   * montré reste un rush, il n'est jamais remplacé en silence par du stock
   * parce que les rushes sont plus courts que le créneau.
   */
  prendreAuPlus(d: number): ItemBroll | null {
    const plein = this.prendre(d);
    if (plein) return plein;
    for (const url of Array.from(this.totaux.keys())) {
      const it = this.prendreDans(url, d);
      if (it) return it;
    }
    return null;
  }
  /** Une fenêtre de `d` s, ou `null` si plus aucun rush ne l'a. */
  prendre(d: number): ItemBroll | null {
    for (const p of this.preferes) {
      // Rush mesuré : la fenêtre recule au début de sa plage libre quand
      // l'avant ne pourrait plus porter un créneau (< d) — sinon cette chute
      // était perdue et le plan manquait de matière.
      const g = this.propres.has(p.url) ? Math.max(...this.departs(p.url).filter((x) => x <= p.depuis + 1e-6)) : p.depuis;
      const a = p.depuis - g < d - 1e-6 && this.libre(p.url, g, g + d) ? r3(g) : p.depuis;
      if (this.libre(p.url, a, a + d)) {
        this.reserver(p.url, a, a + d);
        return { url: p.url, kind: 'video', source: 'rush', depuis: a, dispo: d, raison: p.raison, extra: p.extra };
      }
    }
    const urls = Array.from(this.totaux.keys());
    for (let k = 0; k < urls.length; k++) {
      const url = urls[(this.tour + k) % urls.length];
      // Première plage libre : 0, le début d'un plan propre, puis la fin de chaque plage déjà montée.
      for (const a of this.departs(url)) {
        if (this.libre(url, a, a + d)) {
          this.reserver(url, a, a + d);
          this.tour = (this.tour + k + 1) % urls.length;
          return { url, kind: 'video', source: 'rush', depuis: r3(a), dispo: d, raison: 'rush personnel' };
        }
      }
    }
    return null;
  }
}

function itemsStock(e: EntreePlanMultiSources): { videos: ItemBroll[]; photos: ItemBroll[] } {
  const vus = new Set<string>();
  const forces = new Set((e.gabarit ?? []).map((g) => g.media).filter((u): u is string => !!u));
  const pert = (url: string) => e.pertinences?.[url];
  // Hors sujet : jamais pioché automatiquement ; un média FORCÉ reste un choix.
  const exclu = (url: string) => pert(url)?.niveau === 'hors' && !forces.has(url);
  const enrichir = (it: ItemBroll): ItemBroll => {
    const p = pert(it.url);
    if (!p) return it;
    return {
      ...it, score: p.score, ...(p.niveau === 'limite' ? { limite: true } : {}), ...(p.description ? { description: p.description } : {}),
      raison: p.niveau === 'pertinent' ? `${it.raison}, pertinent pour le sujet` : p.niveau === 'decor' ? `${it.raison}, décor du sujet` : p.niveau === 'limite' ? `${it.raison}, cité par le script (une fois)` : it.raison,
    };
  };
  const videos: ItemBroll[] = [];
  for (const v of e.stockVideos ?? []) {
    if (!v?.url || vus.has(v.url) || exclu(v.url)) continue;
    vus.add(v.url);
    const total = typeof v.secondes === 'number' && v.secondes > 0 ? v.secondes : BROLL_VIDEO_S;
    videos.push(enrichir({ url: v.url, kind: 'video', source: 'stock', depuis: 0, dispo: total, raison: 'vidéo stock (complément)' }));
  }
  const photos: ItemBroll[] = [];
  for (const u of e.photos ?? []) {
    if (!u || vus.has(u) || exclu(u)) continue;
    vus.add(u);
    photos.push(enrichir({ url: u, kind: 'image', source: 'photo', depuis: 0, dispo: Infinity, raison: 'photo stock (complément)' }));
  }
  // Le plus pertinent d'abord (tri STABLE : sans pertinence, l'ordre reçu).
  if (e.pertinences) {
    const cle = (x: ItemBroll) => (x.limite ? -1 : x.score ?? 0.5);
    videos.sort((a, b) => cle(b) - cle(a));
    photos.sort((a, b) => cle(b) - cle(a));
  }
  return { videos, photos };
}

/** Constructeur de plan contigu : chaque segment commence à la fin du précédent. */
class Plan {
  segs: RushSegment[] = [];
  private photos = 0;
  constructor(private readonly avatar: { url: string; secondes: number } | null) {}
  get fin(): number { return this.segs.length ? this.segs[this.segs.length - 1].fin : 0; }
  ajouterAvatar(duree: number, raison: string) {
    if (!this.avatar || duree <= 0) return;
    const debut = this.fin;
    const fin = r3(debut + duree);
    const dernier = this.segs[this.segs.length - 1];
    // Deux fenêtres d'avatar contiguës = une seule (la parole est continue).
    if (dernier && dernier.kind === 'avatar') { dernier.fin = fin; return; }
    this.segs.push({ url: this.avatar.url, debut, fin, depuis: debut, kind: 'avatar', source: 'jumeau', raison });
  }
  ajouterItem(it: ItemBroll, duree: number, raisonCreneau?: string) {
    const debut = this.fin;
    const fin = r3(debut + duree);
    const raison = raisonCreneau ? `${raisonCreneau} — ${it.raison}` : it.raison;
    if (it.kind === 'image') {
      const mouvement = MOUVEMENTS_PHOTO[this.photos % MOUVEMENTS_PHOTO.length];
      this.photos += 1;
      this.segs.push({ url: it.url, debut, fin, kind: 'image', source: 'photo', mouvement, raison });
      return;
    }
    this.segs.push({
      url: it.url, debut, fin, kind: 'video', source: it.source, raison, ...(it.extra ?? {}),
      ...(it.depuis > 0 ? { depuis: it.depuis } : {}),
      ...(Number.isFinite(it.dispo) ? { jusqua: r3(it.depuis + Math.min(duree, it.dispo)) } : {}),
    });
  }
  /** Prolonge le dernier plan jusqu'à `t` (aucune matière pour un nouveau plan). */
  prolonger(t: number) {
    const d = this.segs[this.segs.length - 1];
    if (d) d.fin = r3(t);
  }
}

/**
 * La mémoire de la pioche : le dernier plan de coupe posé (jamais deux fois
 * le même d'affilée) et le genre du dernier média stock (photos et vidéos
 * stock ALTERNENT au lieu de « toutes les vidéos, puis les photos »).
 */
interface EtatPioche {
  dernierUrl: string | null;
  dernierGenre: 'video' | 'image' | null;
  /** Nombre de poses de chaque média stock dans CETTE vidéo. */
  usages: Map<string, number>;
  /** Fin (s, dans le fichier) du dernier extrait monté de chaque vidéo stock. */
  finExtrait: Map<string, number>;
  /** Narration de la séquence (rapprochement plan de coupe ↔ passage). */
  narration: ReadonlyArray<{ debut: number; fin: number; texte: string }>;
}

const nouvelEtatPioche = (narration: EtatPioche['narration'] = []): EtatPioche => ({
  dernierUrl: null, dernierGenre: null, usages: new Map(), finExtrait: new Map(), narration,
});

/** Le passage de narration qui couvre l'instant `t`, ou `''`. */
function texteA(etat: EtatPioche, t: number): string {
  return etat.narration.find((n) => t >= n.debut - EPS && t < n.fin - EPS)?.texte ?? '';
}

/** Le meilleur candidat : pertinence + accord avec le passage de narration (ordre reçu à égalité). */
function meilleur(liste: ItemBroll[], texte: string): ItemBroll | null {
  let best: ItemBroll | null = null;
  let note = -Infinity;
  for (const x of liste) {
    const n = (x.limite ? -1 : x.score ?? 0.5) + (texte && x.description ? 0.3 * accordAvecTexte(x.description, texte) : 0);
    if (n > note + 1e-9) { best = x; note = n; }
  }
  return best;
}

/**
 * Le prochain média STOCK libre. Premier plan de coupe : le plus PERTINENT,
 * photo ou vidéo. Ensuite photos et vidéos en alternance (vidéo d'abord
 * quand rien n'a encore été posé, sans pertinence — l'ordre d'avant), le plus
 * pertinent du genre — préféré s'il montre ce que dit la narration à `t`.
 * Jamais le média du plan de coupe précédent.
 */
function stockSuivant(
  stock: { videos: ItemBroll[]; photos: ItemBroll[] }, utilises: Set<ItemBroll>, d: number, etat: EtatPioche, t = 0,
): ItemBroll | null {
  const texte = texteA(etat, t + d / 2);
  const videos = stock.videos.filter((x) => !utilises.has(x) && x.url !== etat.dernierUrl && x.dispo >= Math.min(d, BROLL_MIN_S));
  const photos = stock.photos.filter((x) => !utilises.has(x) && x.url !== etat.dernierUrl);
  const avecPertinence = [...videos, ...photos].some((x) => typeof x.score === 'number');
  if (avecPertinence && etat.dernierUrl === null && etat.dernierGenre === null) return meilleur([...videos, ...photos], texte);
  const video = () => meilleur(videos, texte);
  const photo = () => meilleur(photos, texte);
  return etat.dernierGenre === 'video' ? (photo() ?? video()) : (video() ?? photo());
}

/** Secondes montables d'un plan : le fichier, borné par le plafond éventuel. */
const dureeMax = (it: ItemBroll) => Math.min(it.dispo, it.plafond ?? Infinity);

/** Note le plan de coupe posé (`d` s) dans la mémoire de la pioche. */
function noterPioche(etat: EtatPioche, it: ItemBroll, d?: number) {
  etat.dernierUrl = it.url;
  if (it.source !== 'rush') {
    etat.dernierGenre = it.kind;
    etat.usages.set(it.url, (etat.usages.get(it.url) ?? 0) + 1);
    if (it.kind === 'video' && typeof d === 'number') etat.finExtrait.set(it.url, r3(it.depuis + Math.min(d, dureeMax(it))));
  }
}

/**
 * REPRISE d'un média stock déjà monté — seulement quand plus aucun média
 * stock n'est libre : jamais un média « limite », jamais le précédent, au
 * plus `REPRISES_MAX_PAR_MEDIA` fois, et une VIDÉO reprend APRÈS l'extrait
 * déjà montré (jamais le même passage ; trop courte → pas de reprise). Une
 * photo reprend avec un autre mouvement (`Plan`).
 */
function repriseStock(
  stock: { videos: ItemBroll[]; photos: ItemBroll[] }, d: number, etat: EtatPioche, t: number, cloture = false,
): ItemBroll | null {
  const texte = texteA(etat, t + d / 2);
  // La suite gardée pour la clôture n'est jamais reprise pendant la parole.
  const libres = (liste: ItemBroll[]) => liste.filter((x) => !x.limite && x.url !== etat.dernierUrl && (cloture || !x.pourCloture)
    && (etat.usages.get(x.url) ?? 0) >= 1 && (etat.usages.get(x.url) ?? 0) <= REPRISES_MAX_PAR_MEDIA);
  const videos = libres(stock.videos).flatMap((x) => {
    const depuis = etat.finExtrait.get(x.url) ?? 0;
    const reste = r3(x.dispo - (depuis - x.depuis));
    return reste >= Math.min(d, BROLL_MIN_S) ? [{ ...x, depuis, dispo: reste, plafond: undefined, raison: `${x.raison}, autre passage` }] : [];
  });
  const photos = libres(stock.photos);
  const v = () => meilleur(videos, texte);
  const ph = () => meilleur(photos, texte);
  return etat.dernierGenre === 'video' ? (ph() ?? v()) : (v() ?? ph());
}

/**
 * Le prochain plan de coupe, par priorité : rush personnel → stock (photos et
 * vidéos en alternance). `d` est la durée voulue ; une vidéo stock plus
 * courte la réduit. `reprise` : plus rien de libre, un média déjà monté
 * revient (`repriseStock`).
 */
function prochainBroll(
  reserve: ReserveRushs, stock: { videos: ItemBroll[]; photos: ItemBroll[] }, utilises: Set<ItemBroll>, d: number,
  etat: EtatPioche = nouvelEtatPioche(), t = 0, reprise = false, cloture = false,
): { it: ItemBroll; d: number } | null {
  const rush = reserve.prendre(d);
  if (rush) { noterPioche(etat, rush); return { it: rush, d }; }
  const it = reprise ? repriseStock(stock, d, etat, t, cloture) : stockSuivant(stock, utilises, d, etat, t);
  if (!it) return null;
  utilises.add(it);
  const duree = it.kind === 'image' ? (d === BROLL_VIDEO_S ? BROLL_PHOTO_S : d) : Math.min(d, dureeMax(it));
  noterPioche(etat, it, duree);
  return { it, d: duree };
}

/**
 * L'ALTERNANCE avatar ↔ plans de coupe, de `p.fin` jusqu'à `finMilieu` —
 * la boucle de `planAvecAvatar`, partagée avec le gabarit. L'avatar garde sa
 * voix CONTINUE (jouée à part) : les plans de coupe ne sont que des images
 * posées par-dessus, chaque fenêtre d'avatar joue sa propre seconde.
 *
 * Matière épuisée : un média STOCK déjà monté peut revenir UNE fois
 * (`repriseStock` : jamais deux fois de suite le même, jamais un média
 * « limite », une vidéo sur un AUTRE passage, une photo avec un autre
 * mouvement) s'il en existe au moins deux distincts — sinon l'avatar tient
 * le reste. Les plages de rushes personnels ne sont jamais rejouées.
 */
function alterner(
  p: Plan, finMilieu: number, reserve: ReserveRushs, stock: { videos: ItemBroll[]; photos: ItemBroll[] },
  utilises: Set<ItemBroll>, etat: EtatPioche, tourInitial: 'broll' | 'avatar',
): void {
  const stockDistinct = new Set([...stock.videos, ...stock.photos].map((x) => x.url)).size;
  let tour = tourInitial;
  let epuise = false;
  while (finMilieu - p.fin > EPS) {
    const reste = r3(finMilieu - p.fin);
    if (tour === 'broll' && !epuise && reste >= BROLL_MIN_S - EPS) {
      // Un reliquat trop court pour l'avatar est absorbé par le plan de coupe.
      let d = Math.min(reste, BROLL_VIDEO_S);
      if (reste - d < 1 && reste <= BROLL_MAX_S) d = reste;
      let pris = prochainBroll(reserve, stock, utilises, d, etat, p.fin);
      // Reprise du stock : seulement quand plus rien n'est libre.
      if (!pris && stockDistinct >= 2) pris = prochainBroll(reserve, stock, utilises, d, etat, p.fin, true);
      if (!pris) { epuise = true; continue; }
      p.ajouterItem(pris.it, r3(pris.d));
      tour = 'avatar';
    } else {
      let d = epuise ? reste : Math.min(reste, AVATAR_FENETRE_S);
      if (reste - d < BROLL_MIN_S) d = reste;
      p.ajouterAvatar(d, 'avatar');
      tour = 'broll';
    }
  }
}

/**
 * LA SÉQUENCE DE CLÔTURE — après la parole de l'avatar, CTA à l'écran
 * jusqu'à la dernière image (`planOverlays`, `debutCta`). JAMAIS l'avatar :
 * sa vidéo est finie, il resterait figé et muet.
 *
 * PRIORITÉ À LA PAROLE : elle garde au moins UN plan de coupe dès qu'un
 * média existe (de préférence un par `PAROLE_PAR_PLAN_S` de parole) ; la
 * clôture prend ce qui reste — UN seul plan quand le stock est rare, deux
 * au-delà de `CLOTURE_UN_PLAN_MAX_S` s'il y en a assez. La matière de la
 * clôture est réservée AVANT l'alternance (sinon la parole consommait tout).
 * Si elle ne couvre pas la clôture, un média montré pendant la parole y
 * revient sur un AUTRE passage (règle de reprise : une fois, jamais le même
 * passage) : son extrait pendant la parole est alors plafonné pour garder la
 * suite du fichier. Jamais d'image figée : une vidéo trop courte enchaîne un
 * autre plan, sinon la clôture est plus courte — dit dans `explications`.
 * Rushes personnels : une fenêtre jamais montée, comme avant.
 */
interface PieceCloture { it: ItemBroll; d: number }

/** Parole (s) par plan de coupe que la parole garde, de préférence. */
export const PAROLE_PAR_PLAN_S = 8;

function preparerCloture(
  total: number, parole: number, reserve: ReserveRushs, stock: { videos: ItemBroll[]; photos: ItemBroll[] }, utilises: Set<ItemBroll>,
): PieceCloture[] {
  const C = r3(total);
  if (C < CLOTURE_MIN_S - EPS) return [];
  const n = C > CLOTURE_UN_PLAN_MAX_S + EPS ? 2 : 1;
  const pieces: PieceCloture[] = [];
  // 1. Rushes personnels : des fenêtres jamais montées.
  for (let k = 0; k < n; k++) {
    const d = r3(k === n - 1 ? C - pieces.reduce((t, x) => t + x.d, 0) : C / n);
    const rush = reserve.prendre(d) ?? reserve.prendreAuPlus(d);
    if (!rush) break;
    pieces.push({ it: rush, d: Number.isFinite(rush.dispo) ? Math.min(d, rush.dispo) : d });
  }
  if (pieces.length) return pieces;
  // 2. Stock, par pertinence (ordre reçu à égalité).
  const cle = (x: ItemBroll) => x.score ?? 0.5;
  const candidats = [...stock.videos, ...stock.photos]
    .filter((x) => !x.limite && !utilises.has(x) && (x.kind === 'image' || x.dispo >= Math.min(BROLL_MIN_S, C) - EPS))
    .map((x, i) => ({ x, i }))
    .sort((a, b) => cle(b.x) - cle(a.x) || a.i - b.i)
    .map((o) => o.x);
  if (!candidats.length) return [];
  // La parole garde les plus pertinents : au moins un, un par ~8 s si possible.
  const garde = candidats.length === 1 ? 1 : Math.min(candidats.length - 1, Math.max(1, Math.floor(parole / PAROLE_PAR_PLAN_S)));
  const pool = candidats.slice(garde);
  const choisis: ItemBroll[] = [];
  if (n === 1 || pool.length === 1) {
    // Un seul plan : de préférence un qui tient toute la clôture.
    const seul = pool.find((x) => x.kind === 'image' || x.dispo >= C - EPS) ?? pool[0];
    if (seul) choisis.push(seul);
  } else {
    choisis.push(...pool.slice(0, 2));
  }
  if (choisis.length === 1) {
    const it = choisis[0];
    pieces.push({ it, d: it.kind === 'image' ? C : r3(Math.min(C, it.dispo)) });
  } else if (choisis.length === 2) {
    // Deux plans : moitié chacun ; une vidéo plus courte cède le reste à l'autre.
    const [a, b] = choisis;
    let da = Math.min(C / 2, a.dispo);
    const db = Math.min(C - da, b.dispo);
    if (da + db < C - EPS) da = Math.min(C - db, a.dispo);
    pieces.push({ it: a, d: r3(da) }, { it: b, d: r3(db) });
  }
  // Manque : un média de la parole reviendra sur un AUTRE passage — son
  // extrait pendant la parole est plafonné pour garder la suite du fichier.
  const manque = r3(C - pieces.reduce((t, x) => t + x.d, 0));
  if (manque >= CLOTURE_MIN_S - EPS) {
    const partage = candidats.slice(0, garde).find((x) => x.kind === 'video' && x.dispo >= 2 * BROLL_MIN_S - EPS);
    if (partage) {
      partage.plafond = r3(Math.max(BROLL_MIN_S, partage.dispo - manque));
      partage.pourCloture = true;
    }
  }
  return pieces;
}

/** Pose la clôture préparée, complète par un autre plan ou un autre passage ; rend son début, ou `null`. */
function cloturer(
  p: Plan, pieces: PieceCloture[], total: number, reserve: ReserveRushs, stock: { videos: ItemBroll[]; photos: ItemBroll[] },
  utilises: Set<ItemBroll>, etat: EtatPioche, expl: string[],
): number | null {
  const debut = p.fin;
  const fin = r3(debut + total);
  // Après la parole, le plan précédent est l'avatar : un média de la parole
  // peut revenir (autre passage) sans être « deux fois de suite ».
  if (p.segs[p.segs.length - 1]?.kind === 'avatar') etat.dernierUrl = null;
  for (const { it, d } of pieces) {
    noterPioche(etat, it, d);
    p.ajouterItem(it, r3(d), 'clôture');
  }
  // Reliquat : un autre plan (libre, sinon un autre passage d'un média montré) — jamais un gel.
  for (let k = 0; k < 2 && fin - p.fin >= CLOTURE_MIN_S - EPS; k++) {
    const reste = r3(fin - p.fin);
    const pris = prochainBroll(reserve, stock, utilises, reste, etat, p.fin, false, true)
      ?? prochainBroll(reserve, stock, utilises, reste, etat, p.fin, true, true);
    if (!pris) break;
    p.ajouterItem(pris.it, r3(pris.it.kind === 'image' ? reste : pris.d), 'clôture');
  }
  if (p.fin <= debut + EPS) {
    expl.push('Aucun plan de coupe pour la clôture : la vidéo s’arrête avec la parole de l’avatar.');
    return null;
  }
  const dernier = p.segs[p.segs.length - 1];
  // Une photo tient le reliquat ; une vidéo trop courte ne s'étire pas (pas de gel).
  if (fin - p.fin > EPS && dernier.kind === 'image') p.prolonger(fin);
  const plans = p.segs.filter((s) => s.debut >= debut - EPS).length;
  expl.push(`Clôture de ${r3(p.fin - debut)} s après la parole (${plans} plan(s) de coupe, CTA à l’écran jusqu’à la fin).`);
  if (fin - p.fin > EPS) expl.push(`Matière insuffisante : clôture de ${r3(p.fin - debut)} s au lieu de ${r3(total)} s.`);
  return debut;
}

/** Avec avatar, sans gabarit : avatar (accroche) → alternance → avatar (CTA) → clôture éventuelle. */
function planAvecAvatar(e: EntreePlanMultiSources, T: number, expl: string[], total: number): { segs: RushSegment[]; debutCloture: number | null } {
  const p = new Plan(e.avatar!);
  const reserve = new ReserveRushs(e, total);
  const stock = itemsStock(e);
  const utilises = new Set<ItemBroll>();
  const etat = nouvelEtatPioche(e.narration);
  const aDuBroll = !reserve.vide || stock.videos.length > 0 || stock.photos.length > 0;
  const hook = r3(borne(T * 0.2, BROLL_MIN_S, BROLL_MAX_S));
  const fin = r3(borne(T * 0.2, BROLL_MIN_S, BROLL_MAX_S));
  const finMilieu = r3(T - fin);
  // La clôture se RÉSERVE avant l'alternance (sinon la parole consomme tout).
  const pieces = aDuBroll && total > T ? preparerCloture(total - T, T, reserve, stock, utilises) : [];
  for (const x of pieces) utilises.add(x.it);
  if (!aDuBroll || finMilieu - hook < BROLL_MIN_S) {
    p.ajouterAvatar(T, 'avatar (parole entière)');
    expl.push(!aDuBroll ? 'Aucun plan de coupe disponible : l’avatar tient toute la séquence.' : 'Parole trop courte pour un plan de coupe : avatar seul.');
    const debutCloture = total > T ? cloturer(p, pieces, r3(total - T), reserve, stock, utilises, etat, expl) : null;
    return { segs: p.segs, debutCloture };
  }
  p.ajouterAvatar(hook, 'avatar — accroche');
  alterner(p, finMilieu, reserve, stock, utilises, etat, 'broll');
  p.ajouterAvatar(r3(T - p.fin), 'avatar — CTA');
  const n = p.segs.filter((s) => s.kind !== 'avatar').length;
  expl.push(`Avatar en accroche et en conclusion, ${n} plan(s) de coupe intercalé(s).`);
  const debutCloture = total > T ? cloturer(p, pieces, r3(total - T), reserve, stock, utilises, etat, expl) : null;
  return { segs: p.segs, debutCloture };
}

/** Sans avatar, sans gabarit : rushes (moteur de Créer) puis stock en complément. */
function planSansAvatar(e: EntreePlanMultiSources, cible: number, expl: string[]): RushSegment[] {
  const p = new Plan(null);
  const rushes = (e.rushes ?? []).filter((x) => x?.url);
  const analyses = (e.analyses ?? []).filter((a) => rushes.some((x) => x.url === a.url));
  if (analyses.length >= 2) {
    const plan = planMontage(analyses, cible, optionsRushs(e));
    if (plan && plan.length) {
      for (const s of plan) p.segs.push({ ...s, kind: 'video', source: 'rush' });
      expl.push(`Rushes personnels : ${plan.length} extrait(s) du smart montage.`);
    }
  }
  if (p.segs.length === 0 && rushes.length) {
    // Enchaînement simple des rushes, chacun depuis son début.
    for (const x of rushes) {
      const reste = r3(cible - p.fin);
      if (reste <= EPS) break;
      const total = typeof x.secondes === 'number' && x.secondes > 0 ? x.secondes : reste;
      p.ajouterItem({ url: x.url, kind: 'video', source: 'rush', depuis: 0, dispo: total, raison: 'rush personnel' }, Math.min(reste, total));
    }
    if (p.segs.length) expl.push(`Rushes personnels : ${p.segs.length} rush(es) enchaîné(s).`);
  }
  // Le stock ne comble QUE ce que les rushes n'ont pas couvert.
  const { videos, photos } = itemsStock(e);
  // Photos et vidéos ALTERNENT (vidéo d'abord), jamais « toutes les vidéos puis les photos ».
  const stock: ItemBroll[] = [];
  for (let i = 0; i < Math.max(videos.length, photos.length); i++) {
    if (videos[i]) stock.push(videos[i]);
    if (photos[i]) stock.push(photos[i]);
  }
  let utilises = 0;
  for (let k = 0; k < stock.length; k++) {
    const reste = r3(cible - p.fin);
    if (reste <= EPS) break;
    const it = stock[k];
    const restants = stock.length - k;
    // Répartition régulière du reste entre les médias restants (≈ 3 s chacun
    // s'ils sont nombreux, plus longs s'ils sont rares — dans la limite du fichier).
    const vise = it.kind === 'image' ? BROLL_PHOTO_S : BROLL_VIDEO_S;
    let d = Math.min(reste, it.dispo, Math.max(vise, reste / restants));
    if (reste - d < 1 && it.dispo >= reste) d = reste;
    p.ajouterItem(it, d);
    utilises += 1;
  }
  if (utilises) expl.push(`${utilises} média(s) stock en complément${rushes.length ? ' des rushes' : ''}.`);
  const manque = r3(cible - p.fin);
  if (manque > EPS && p.segs.length) {
    const d = p.segs[p.segs.length - 1];
    // Une photo peut tenir plus longtemps ; une vidéo, non (gel d'image).
    if (d.kind === 'image') p.prolonger(cible);
    else expl.push(`Matière insuffisante : séquence de ${p.fin} s au lieu de ${r3(cible)} s.`);
  }
  return p.segs;
}

/**
 * Gabarit imposé : un plan par créneau, dans l'ordre, durées égales — un média
 * plus court que son créneau le raccourcit, les créneaux suivants se
 * partagent le reste (jamais d'image figée).
 *
 * AVEC AVATAR : la parole est longue (≈ 30–40 s) et le gabarit court (3 à 5
 * créneaux) — des durées égales donnaient des blocs d'avatar de 10 s et plus.
 * Les créneaux gardent leur ORDRE, mais leurs durées suivent la règle de
 * `planAvecAvatar` : accroche puis fenêtres d'avatar de 3 s, plans de coupe
 * de 2–4 s ; le dernier créneau d'avatar devient la conclusion (CTA). Le
 * temps qui reste avant le CTA est rempli par la MÊME alternance
 * (`alterner`) : avatar et plans de coupe (rushes personnels d'abord, puis
 * stock) se relaient au lieu de laisser tout le reliquat à l'avatar.
 */
function planGabarit(e: EntreePlanMultiSources, T: number, expl: string[], total: number = T): { segs: RushSegment[]; debutCloture: number | null } {
  const gabarit = e.gabarit ?? [];
  const avatar = e.avatar ?? null;
  const p = new Plan(avatar);
  const reserve = new ReserveRushs(e, total);
  const { videos, photos } = itemsStock(e);
  const utilises = new Set<ItemBroll>();
  const etat = nouvelEtatPioche(e.narration);
  const n = gabarit.length;
  const estAvatar = (c: CreneauGabarit) => !!avatar && (c.type === 'avatar' || (!!c.media && c.media === avatar.url));
  // Avec avatar et une clôture à poser : sa matière est RÉSERVÉE d'abord — jamais
  // un média que le gabarit FORCE (le choix de l'utilisateur reste à sa place).
  const forces = new Set(gabarit.map((c) => c.media).filter((u): u is string => !!u));
  const pieces = avatar && total > T && !gabarit.every(estAvatar)
    ? preparerCloture(total - T, T, reserve, {
      videos: videos.filter((x) => !forces.has(x.url)), photos: photos.filter((x) => !forces.has(x.url)),
    }, utilises)
    : [];
  for (const x of pieces) utilises.add(x.it);
  // Gabarit « avatar seul » explicite : l'avatar tient toute la parole, comme avant.
  if (avatar && gabarit.every(estAvatar)) {
    // Choix EXPLICITE « avatar seul » : aucun plan de coupe, donc aucune clôture.
    p.ajouterAvatar(T, 'avatar (gabarit : avatar seul)');
    expl.push(`Gabarit de ${n} créneau(x) respecté.`);
    return { segs: p.segs, debutCloture: null };
  }
  const hook = avatar ? r3(borne(T * 0.2, BROLL_MIN_S, BROLL_MAX_S)) : 0;
  const cta = avatar ? r3(borne(T * 0.2, BROLL_MIN_S, BROLL_MAX_S)) : 0;
  /** Fin de la partie « créneaux » : avec avatar, le CTA est réservé. */
  const limite = r3(T - cta);
  /** Durée d'un créneau d'avatar : accroche en ouverture, fenêtre de 3 s ensuite. */
  const dureeAvatar = (k: number, d: number) => (k === 0 ? Math.min(d, hook) : Math.min(d, AVATAR_FENETRE_S));
  /** Durée d'un plan de coupe : 2–4 s avec avatar, le créneau entier sinon. */
  const dureeBroll = (d: number) => (avatar ? Math.min(d, BROLL_MAX_S) : d);
  const libre = (liste: ItemBroll[], d: number) => liste.find((x) => !utilises.has(x) && x.dispo >= Math.min(d, BROLL_MIN_S)) ?? null;
  const poser = (it: ItemBroll, d: number, raison: string) => {
    utilises.add(it);
    noterPioche(etat, it, d);
    p.ajouterItem(it, r3(Math.min(d, dureeMax(it))), raison);
  };
  const poserAvatar = (k: number, d: number, raison: string) => p.ajouterAvatar(r3(dureeAvatar(k, d)), raison);
  gabarit.forEach((c, k) => {
    const reste = r3(limite - p.fin);
    if (reste <= EPS) return;
    // Avatar : le dernier créneau d'avatar EST la conclusion, posée après l'alternance.
    if (avatar && k === n - 1 && k > 0 && (estAvatar(c) || c.type === 'auto')) return;
    const nRestants = avatar && k < n - 1 && estAvatar(gabarit[n - 1]) ? n - 1 - k : n - k;
    const d = k === n - 1 || nRestants <= 1 ? reste : r3(reste / nRestants);
    const etiquette = `créneau ${k + 1} (${c.type})`;
    // 1. Média FORCÉ : repris tel quel s'il est disponible.
    if (c.media) {
      if (avatar && c.media === avatar.url) { poserAvatar(k, d, `${etiquette} — avatar forcé`); return; }
      const force = [...videos, ...photos].find((x) => x.url === c.media && !utilises.has(x));
      if (force) { poser(force, dureeBroll(d), `${etiquette} — média choisi`); return; }
      const rushForce = reserve.prendreDans(c.media, dureeBroll(d));
      if (rushForce) { noterPioche(etat, rushForce); p.ajouterItem(rushForce, r3(rushForce.dispo), `${etiquette} — rush choisi`); return; }
      expl.push(`Créneau ${k + 1} : média choisi indisponible, remplacé selon le type « ${c.type} ».`);
    }
    // 2. Type imposé.
    let type = c.type;
    if (type === 'avatar' && !avatar) type = 'auto';
    if (type === 'avatar') { poserAvatar(k, d, `${etiquette} — avatar`); return; }
    if (type === 'rush') {
      const pris = reserve.prendreAuPlus(dureeBroll(d));
      if (pris) { noterPioche(etat, pris); p.ajouterItem(pris, r3(Math.min(dureeBroll(d), pris.dispo)), etiquette); return; }
    } else if (type === 'stock') {
      const db = dureeBroll(d);
      // Photos et vidéos en alternance, jamais le média précédent.
      const it = stockSuivant({ videos, photos }, utilises, db, etat, p.fin) ?? libre(videos, db) ?? libre(photos, db);
      if (it) { poser(it, db, etiquette); return; }
    }
    if (type !== 'auto') expl.push(`Créneau ${k + 1} : aucun média « ${type} » disponible, choix automatique.`);
    // 3. Automatique : avatar en ouverture / fin et en alternance, sinon priorité.
    const dernier = p.segs[p.segs.length - 1];
    if (avatar && (k === 0 || k === n - 1 || !dernier || dernier.kind !== 'avatar')) {
      poserAvatar(k, d, `${etiquette} — avatar`);
      return;
    }
    const pris = prochainBroll(reserve, { videos, photos }, utilises, dureeBroll(d), etat, p.fin);
    if (pris) { p.ajouterItem(pris.it, r3(pris.it.kind === 'image' ? dureeBroll(d) : pris.d), etiquette); return; }
    if (avatar) { poserAvatar(k, d, `${etiquette} — avatar (aucun autre média)`); return; }
    expl.push(`Créneau ${k + 1} : aucun média disponible.`);
  });
  if (avatar) {
    // Le temps entre les créneaux et le CTA : la même alternance que sans gabarit.
    const avant = p.segs.length;
    if (limite - p.fin >= BROLL_MIN_S - EPS) {
      const dernier = p.segs[p.segs.length - 1];
      alterner(p, limite, reserve, { videos, photos }, utilises, etat, dernier && dernier.kind === 'avatar' ? 'broll' : 'avatar');
    }
    p.ajouterAvatar(r3(T - p.fin), 'avatar — CTA');
    const ajoutes = p.segs.slice(avant).filter((s) => s.kind !== 'avatar').length;
    if (ajoutes) expl.push(`Avatar et plans de coupe alternés : ${ajoutes} plan(s) de coupe ajouté(s) après le gabarit.`);
    expl.push(`Gabarit de ${n} créneau(x) respecté.`);
    const debutCloture = total > T ? cloturer(p, pieces, r3(total - T), reserve, { videos, photos }, utilises, etat, expl) : null;
    return { segs: p.segs, debutCloture };
  }
  // Reliquat (dernier média plus court que son créneau) : une photo s'étire ;
  // une vidéo, non — dit.
  const manque = r3(T - p.fin);
  if (manque > EPS && p.segs.length) {
    const d = p.segs[p.segs.length - 1];
    if (d.kind === 'image') p.prolonger(T);
    else expl.push(`Matière insuffisante : séquence de ${p.fin} s au lieu de ${r3(T)} s.`);
  }
  expl.push(`Gabarit de ${n} créneau(x) respecté.`);
  return { segs: p.segs, debutCloture: null };
}

/**
 * L'orchestrateur. Rend un plan contigu couvrant EXACTEMENT la séquence
 * « Vidéo » (durée de l'avatar s'il est là, sinon `cible`, moins si la
 * matière manque — c'est alors dit dans `explications`).
 */
export function planMultiSources(e: EntreePlanMultiSources): ResultatPlanMultiSources {
  const expl: string[] = [];
  const avatar = e.avatar && e.avatar.url && e.avatar.secondes > 0 ? e.avatar : null;
  const T = avatar ? r3(avatar.secondes) : r3(Math.max(0, e.cible));
  if (!(T > 0)) return { plan: [], duree: 0, explications: ['Durée nulle : aucun plan.'], debutCloture: null, parole: avatar ? T : null };
  // Avec avatar : la parole entière, puis la clôture jusqu'à la durée visée.
  const total = avatar ? dureeAvecCloture(T, e.dureeVisee) : T;
  const entree = { ...e, avatar };
  let plan: RushSegment[];
  let debutCloture: number | null = null;
  if (e.gabarit && e.gabarit.length > 0) {
    ({ segs: plan, debutCloture } = planGabarit(entree, T, expl, total));
  } else if (avatar) {
    ({ segs: plan, debutCloture } = planAvecAvatar(entree, T, expl, total));
  } else {
    plan = planSansAvatar(entree, T, expl);
  }
  if (avatar) cadrerAvatar(plan);
  const duree = plan.length ? plan[plan.length - 1].fin : 0;
  return { plan, duree, explications: expl, debutCloture, parole: avatar ? T : null };
}

/**
 * CADRAGES de l'avatar, en alternance : plan large (1), moyen (1,15), serré
 * (1,3) — au lieu d'une suite de gros plans identiques. L'accroche et la
 * conclusion (CTA) gardent le cadre d'origine (titre et CTA posés autour du
 * visage). Le zoom est centré sur la ligne du menton
 * (`ORIGINE_CADRAGE_AVATAR`) : yeux, bouche et menton restent dans l'image,
 * seul le haut du crâne sort du cadre. Purement visuel : `depuis`, `debut`
 * et la vitesse ne changent pas (synchronisation labiale intacte).
 */
export const CADRAGES_AVATAR: readonly number[] = [1, 1.15, 1.3];

/** Au-delà, un plan d'avatar sans plan de coupe est recoupé en changeant de cadre. */
export const AVATAR_PLAN_MAX_S = 6;

export function cadrerAvatar(plan: RushSegment[]): RushSegment[] {
  // Matière épuisée : l'avatar tient seul plusieurs secondes. Plutôt qu'un
  // long gros plan figé, la fenêtre est recoupée (≈ 3 s) et chaque morceau
  // change de cadre — chaque morceau joue SA seconde (`depuis === debut`).
  if (plan.some((s) => s.kind !== 'avatar')) {
    for (let i = plan.length - 1; i >= 0; i--) {
      const s = plan[i];
      const d = s.fin - s.debut;
      if (s.kind !== 'avatar' || d <= AVATAR_PLAN_MAX_S + EPS) continue;
      const n = Math.max(2, Math.round(d / AVATAR_FENETRE_S));
      const morceaux: RushSegment[] = [];
      for (let k = 0; k < n; k++) {
        const debut = r3(s.debut + (d * k) / n);
        const fin = k === n - 1 ? s.fin : r3(s.debut + (d * (k + 1)) / n);
        morceaux.push({ ...s, debut, fin, depuis: debut, raison: k === 0 ? s.raison : `${s.raison} (changement de cadre)` });
      }
      plan.splice(i, 1, ...morceaux);
    }
  }
  const idx = plan.map((s, i) => (s.kind === 'avatar' ? i : -1)).filter((i) => i >= 0);
  idx.forEach((i, k) => {
    if (k === 0 || k === idx.length - 1) return;
    let z = CADRAGES_AVATAR[k % CADRAGES_AVATAR.length];
    // Juste avant la conclusion, contiguë à elle : un autre cadre (sinon les deux fusionnent).
    if (z === 1 && k === idx.length - 2 && idx[k + 1] === i + 1) z = CADRAGES_AVATAR[1];
    if (z !== 1) plan[i].cadrage = z;
  });
  // Deux morceaux contigus au même cadre = un seul plan (aucune coupe visible).
  for (let i = plan.length - 1; i > 0; i--) {
    const a = plan[i - 1];
    const b = plan[i];
    if (a.kind === 'avatar' && b.kind === 'avatar' && (a.cadrage ?? 1) === (b.cadrage ?? 1)) {
      a.fin = b.fin;
      plan.splice(i, 1);
    }
  }
  return plan;
}

/** Invariant lip-sync : chaque extrait d'avatar joue sa propre seconde. Pur. */
export function avatarSynchronise(plan: ReadonlyArray<RushSegment>): boolean {
  return plan.every((s) => s.kind !== 'avatar' || (Math.abs((s.depuis ?? 0) - s.debut) < 1e-6 && (s.vitesse ?? 1) === 1));
}
