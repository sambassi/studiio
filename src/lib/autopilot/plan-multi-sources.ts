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
 * Déterministe (aucun hasard, aucune horloge), explicable (`explications`,
 * `raison` par plan), sans réseau.
 */
import { planMontage, type AnalyseRush, type OptionsMontage } from '@/lib/creer/smart-montage';
import type { RushSegment, MouvementImage, SourceSegment } from '@/lib/creer/multi-rush';
import type { CreneauGabarit } from '@/lib/autopilot/sources';

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
}

export interface ResultatPlanMultiSources {
  plan: RushSegment[];
  /** Fin du dernier plan — la durée de la séquence « Vidéo ». */
  duree: number;
  /** Pourquoi ce plan, lisible (journal + métadonnées). */
  explications: string[];
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
  constructor(e: EntreePlanMultiSources, besoin: number) {
    const rushes = (e.rushes ?? []).filter((x) => x?.url);
    const analyses = (e.analyses ?? []).filter((a) => rushes.some((x) => x.url === a.url));
    this.totaux = new Map(rushes.map((x) => {
      const a = analyses.find((y) => y.url === x.url);
      const t = typeof x.secondes === 'number' && x.secondes > 0 ? x.secondes : a && a.duree > 0 ? a.duree : NaN;
      return [x.url, t];
    }));
    this.preferes = [];
    if (analyses.length >= 2 && besoin > 0) {
      const plan = planMontage(analyses, besoin, { ...(e.options ?? {}), longueurExtrait: BROLL_VIDEO_S });
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
  private libre(url: string, a: number, b: number): boolean {
    const total = this.totaux.get(url);
    // Durée inconnue : une seule fenêtre, depuis le début.
    if (total === undefined) return false;
    if (Number.isNaN(total)) return a === 0 && !(this.utilisees.get(url)?.length);
    if (b > total + 1e-6) return false;
    return !(this.utilisees.get(url) ?? []).some(([x, y]) => a < y - 1e-6 && x < b - 1e-6);
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
    for (const duree of [d, ...(Number.isFinite(total) ? [Math.min(d, total)] : [])]) {
      if (duree < 1) continue;
      const departs = [0, ...(this.utilisees.get(url) ?? []).map(([, y]) => y)].sort((x, y) => x - y);
      for (const a of departs) {
        if (this.libre(url, a, a + duree)) {
          this.reserver(url, a, a + duree);
          return { url, kind: 'video', source: 'rush', depuis: r3(a), dispo: r3(duree), raison: 'rush personnel' };
        }
      }
    }
    return null;
  }
  /** Une fenêtre de `d` s, ou `null` si plus aucun rush ne l'a. */
  prendre(d: number): ItemBroll | null {
    for (const p of this.preferes) {
      if (this.libre(p.url, p.depuis, p.depuis + d)) {
        this.reserver(p.url, p.depuis, p.depuis + d);
        return { url: p.url, kind: 'video', source: 'rush', depuis: p.depuis, dispo: d, raison: p.raison, extra: p.extra };
      }
    }
    const urls = Array.from(this.totaux.keys());
    for (let k = 0; k < urls.length; k++) {
      const url = urls[(this.tour + k) % urls.length];
      // Première plage libre : 0, puis la fin de chaque plage déjà montée.
      const departs = [0, ...(this.utilisees.get(url) ?? []).map(([, y]) => y)].sort((x, y) => x - y);
      for (const a of departs) {
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
  const videos: ItemBroll[] = [];
  for (const v of e.stockVideos ?? []) {
    if (!v?.url || vus.has(v.url)) continue;
    vus.add(v.url);
    const total = typeof v.secondes === 'number' && v.secondes > 0 ? v.secondes : BROLL_VIDEO_S;
    videos.push({ url: v.url, kind: 'video', source: 'stock', depuis: 0, dispo: total, raison: 'vidéo stock (complément)' });
  }
  const photos: ItemBroll[] = [];
  for (const u of e.photos ?? []) {
    if (!u || vus.has(u)) continue;
    vus.add(u);
    photos.push({ url: u, kind: 'image', source: 'photo', depuis: 0, dispo: Infinity, raison: 'photo stock (complément)' });
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
 * Le prochain plan de coupe, par priorité : rush personnel → vidéo stock →
 * photo. `d` est la durée voulue ; une vidéo stock plus courte la réduit.
 */
function prochainBroll(
  reserve: ReserveRushs, stock: { videos: ItemBroll[]; photos: ItemBroll[] }, utilises: Set<ItemBroll>, d: number,
): { it: ItemBroll; d: number } | null {
  const rush = reserve.prendre(d);
  if (rush) return { it: rush, d };
  const v = stock.videos.find((x) => !utilises.has(x) && x.dispo >= Math.min(d, BROLL_MIN_S));
  if (v) { utilises.add(v); return { it: v, d: Math.min(d, v.dispo) }; }
  const ph = stock.photos.find((x) => !utilises.has(x));
  if (ph) { utilises.add(ph); return { it: ph, d: d === BROLL_VIDEO_S ? BROLL_PHOTO_S : d }; }
  return null;
}

/** Avec avatar, sans gabarit : avatar (accroche) → alternance → avatar (CTA). */
function planAvecAvatar(e: EntreePlanMultiSources, T: number, expl: string[]): RushSegment[] {
  const p = new Plan(e.avatar!);
  const reserve = new ReserveRushs(e, T);
  const stock = itemsStock(e);
  const utilises = new Set<ItemBroll>();
  const aDuBroll = !reserve.vide || stock.videos.length > 0 || stock.photos.length > 0;
  const hook = r3(borne(T * 0.2, BROLL_MIN_S, BROLL_MAX_S));
  const fin = r3(borne(T * 0.2, BROLL_MIN_S, BROLL_MAX_S));
  const finMilieu = r3(T - fin);
  if (!aDuBroll || finMilieu - hook < BROLL_MIN_S) {
    p.ajouterAvatar(T, 'avatar (parole entière)');
    expl.push(!aDuBroll ? 'Aucun plan de coupe disponible : l’avatar tient toute la séquence.' : 'Parole trop courte pour un plan de coupe : avatar seul.');
    return p.segs;
  }
  p.ajouterAvatar(hook, 'avatar — accroche');
  let tour: 'broll' | 'avatar' = 'broll';
  let epuise = false;
  while (finMilieu - p.fin > EPS) {
    const reste = r3(finMilieu - p.fin);
    if (tour === 'broll' && !epuise && reste >= BROLL_MIN_S - EPS) {
      // Un reliquat trop court pour l'avatar est absorbé par le plan de coupe.
      let d = Math.min(reste, BROLL_VIDEO_S);
      if (reste - d < 1 && reste <= BROLL_MAX_S) d = reste;
      const pris = prochainBroll(reserve, stock, utilises, d);
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
  p.ajouterAvatar(r3(T - p.fin), 'avatar — CTA');
  const n = p.segs.filter((s) => s.kind !== 'avatar').length;
  expl.push(`Avatar en accroche et en conclusion, ${n} plan(s) de coupe intercalé(s).`);
  return p.segs;
}

/** Sans avatar, sans gabarit : rushes (moteur de Créer) puis stock en complément. */
function planSansAvatar(e: EntreePlanMultiSources, cible: number, expl: string[]): RushSegment[] {
  const p = new Plan(null);
  const rushes = (e.rushes ?? []).filter((x) => x?.url);
  const analyses = (e.analyses ?? []).filter((a) => rushes.some((x) => x.url === a.url));
  if (analyses.length >= 2) {
    const plan = planMontage(analyses, cible, e.options ?? {});
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
  const stock = [...videos, ...photos];
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
 */
function planGabarit(e: EntreePlanMultiSources, T: number, expl: string[]): RushSegment[] {
  const gabarit = e.gabarit ?? [];
  const avatar = e.avatar ?? null;
  const p = new Plan(avatar);
  const reserve = new ReserveRushs(e, T);
  const { videos, photos } = itemsStock(e);
  const utilises = new Set<ItemBroll>();
  const libre = (liste: ItemBroll[], d: number) => liste.find((x) => !utilises.has(x) && x.dispo >= Math.min(d, BROLL_MIN_S)) ?? null;
  const n = gabarit.length;
  const poser = (it: ItemBroll, d: number, raison: string) => {
    utilises.add(it);
    p.ajouterItem(it, r3(Math.min(d, it.dispo)), raison);
  };
  gabarit.forEach((c, k) => {
    const reste = r3(T - p.fin);
    if (reste <= EPS) return;
    const d = k === n - 1 ? reste : r3(reste / (n - k));
    const etiquette = `créneau ${k + 1} (${c.type})`;
    // 1. Média FORCÉ : repris tel quel s'il est disponible.
    if (c.media) {
      if (avatar && c.media === avatar.url) { p.ajouterAvatar(d, `${etiquette} — avatar forcé`); return; }
      const force = [...videos, ...photos].find((x) => x.url === c.media && !utilises.has(x));
      if (force) { poser(force, d, `${etiquette} — média choisi`); return; }
      const rushForce = reserve.prendreDans(c.media, d);
      if (rushForce) { p.ajouterItem(rushForce, r3(rushForce.dispo), `${etiquette} — rush choisi`); return; }
      expl.push(`Créneau ${k + 1} : média choisi indisponible, remplacé selon le type « ${c.type} ».`);
    }
    // 2. Type imposé.
    let type = c.type;
    if (type === 'avatar' && !avatar) type = 'auto';
    if (type === 'avatar') { p.ajouterAvatar(d, `${etiquette} — avatar`); return; }
    if (type === 'rush') {
      const pris = reserve.prendre(d);
      if (pris) { p.ajouterItem(pris, d, etiquette); return; }
    } else if (type === 'stock') {
      const it = libre(videos, d) ?? libre(photos, d);
      if (it) { poser(it, d, etiquette); return; }
    }
    if (type !== 'auto') expl.push(`Créneau ${k + 1} : aucun média « ${type} » disponible, choix automatique.`);
    // 3. Automatique : avatar en ouverture / fin et en alternance, sinon priorité.
    const dernier = p.segs[p.segs.length - 1];
    if (avatar && (k === 0 || k === n - 1 || !dernier || dernier.kind !== 'avatar')) {
      p.ajouterAvatar(d, `${etiquette} — avatar`);
      return;
    }
    const pris = prochainBroll(reserve, { videos, photos }, utilises, d);
    if (pris) { p.ajouterItem(pris.it, r3(pris.it.kind === 'image' ? d : pris.d), etiquette); return; }
    if (avatar) { p.ajouterAvatar(d, `${etiquette} — avatar (aucun autre média)`); return; }
    expl.push(`Créneau ${k + 1} : aucun média disponible.`);
  });
  // Reliquat (dernier média plus court que son créneau) : l'avatar le couvre,
  // une photo s'étire ; une vidéo, non — dit.
  const manque = r3(T - p.fin);
  if (manque > EPS && p.segs.length) {
    const d = p.segs[p.segs.length - 1];
    if (avatar) p.ajouterAvatar(manque, 'avatar — fin');
    else if (d.kind === 'image') p.prolonger(T);
    else expl.push(`Matière insuffisante : séquence de ${p.fin} s au lieu de ${r3(T)} s.`);
  }
  expl.push(`Gabarit de ${n} créneau(x) respecté.`);
  return p.segs;
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
  if (!(T > 0)) return { plan: [], duree: 0, explications: ['Durée nulle : aucun plan.'] };
  const entree = { ...e, avatar };
  let plan: RushSegment[];
  if (e.gabarit && e.gabarit.length > 0) {
    plan = planGabarit(entree, T, expl);
  } else if (avatar) {
    plan = planAvecAvatar(entree, T, expl);
  } else {
    plan = planSansAvatar(entree, T, expl);
  }
  const duree = plan.length ? plan[plan.length - 1].fin : 0;
  return { plan, duree, explications: expl };
}

/** Invariant lip-sync : chaque extrait d'avatar joue sa propre seconde. Pur. */
export function avatarSynchronise(plan: ReadonlyArray<RushSegment>): boolean {
  return plan.every((s) => s.kind !== 'avatar' || (Math.abs((s.depuis ?? 0) - s.debut) < 1e-6 && (s.vitesse ?? 1) === 1));
}
