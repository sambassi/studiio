/**
 * PILOTE DES EXTRAITS — rendu temps réel de Créer (compositeur canvas).
 *
 * Gels mesurés sur un rendu réel DANSE : 0,5–1,5 s d'image figée autour des
 * coupes, son continu. Cause : l'ancien code positionnait la vidéo source
 * (`currentTime = depuis`) AU MOMENT de la coupe. Pendant ce repositionnement
 * (requête réseau + décodage depuis l'image clé), `drawImage` repeint la
 * dernière image décodée : le canvas enregistre une image figée. Et une coupe
 * interne (deux extraits consécutifs du même rush) ne pouvait pas être
 * préparée : il n'y avait qu'un élément vidéo par rush.
 *
 * Ici :
 *  - double tampon : deux extraits consécutifs n'utilisent JAMAIS le même
 *    élément (`attribuerLecteurs`) ;
 *  - les extraits suivants sont positionnés PENDANT le plan en cours (pause,
 *    prêts), chaque lecteur libre sur son prochain extrait ;
 *  - à la coupe, on ne bascule que si l'image suivante est réellement prête ;
 *    sinon le plan en cours continue de JOUER (images vivantes, jamais figées)
 *    au plus `attenteMax` secondes. Au-delà, on bascule quand même et la coupe
 *    est comptée « non prête » (journalisée par le compositeur : jamais muet).
 *
 * Module PUR (aucun DOM) : les éléments sont décrits par `LecteurVideo`, ce
 * qui permet de le tester avec des lecteurs simulés.
 */

export interface LecteurVideo {
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  readyState: number;
  playbackRate: number;
  play(): unknown;
  pause(): void;
}

export interface ExtraitPilote<L> { el: L; debut: number; fin: number; depuis: number; vitesse?: number }

/** HAVE_CURRENT_DATA : une image est décodée à la position courante. */
const IMAGE_DECODEE = 2;

/**
 * Tampon (0 ou 1) de chaque extrait : un extrait qui suit un extrait du MÊME
 * rush prend l'autre tampon — c'est ce qui permet de le préparer à l'avance.
 */
export function attribuerLecteurs(plan: ReadonlyArray<{ url: string }>): number[] {
  const tampons: number[] = [];
  plan.forEach((s, k) => {
    tampons.push(k > 0 && plan[k - 1].url === s.url ? 1 - tampons[k - 1] : 0);
  });
  return tampons;
}

export interface BilanPilote {
  coupes: number;
  /** Coupes faites alors que l'image suivante n'était pas prête. */
  coupesNonPretes: number;
  /** Plus long report d'une coupe (s) — le plan précédent jouait pendant ce temps. */
  reportMax: number;
}

export interface OptionsPilote {
  /** Report maximal d'une coupe dont l'image n'est pas prête (s). */
  attenteMax?: number;
  /** Écart toléré entre la position du lecteur et la position voulue (s). */
  tolerance?: number;
  /** Appelé à chaque coupe — instrumentation. */
  surCoupe?: (info: { k: number; report: number; prete: boolean; readyState: number; seeking: boolean; ecart: number }) => void;
}

export function creerPiloteMontage<L extends LecteurVideo>(
  plan: ReadonlyArray<ExtraitPilote<L>>,
  options: OptionsPilote = {},
) {
  const attenteMax = options.attenteMax ?? 0.25;
  const tolerance = options.tolerance ?? 0.3;
  const lecteurs = Array.from(new Set(plan.map((s) => s.el)));
  const prepare = new Set<number>();
  const bilan: BilanPilote = { coupes: 0, coupesNonPretes: 0, reportMax: 0 };
  let courant = -1;

  const indexA = (s: number) => {
    const k = plan.findIndex((seg) => s >= seg.debut && s < seg.fin);
    return k >= 0 ? k : s < (plan[0]?.debut ?? 0) ? 0 : plan.length - 1;
  };
  const prete = (k: number) => {
    const { el, depuis } = plan[k];
    return el.readyState >= IMAGE_DECODEE && !el.seeking && Math.abs(el.currentTime - depuis) <= tolerance;
  };
  const demarrer = (k: number, s: number) => {
    const seg = plan[k];
    const vitesse = seg.vitesse ?? 1;
    const cible = seg.depuis + Math.max(0, s - seg.debut) * vitesse;
    seg.el.playbackRate = vitesse;
    // Déjà en place (préparé) : surtout ne pas re-positionner — c'est le
    // repositionnement qui fige l'image.
    if (Math.abs(seg.el.currentTime - cible) > tolerance) seg.el.currentTime = cible;
    if (seg.el.paused) {
      const lecture = seg.el.play() as Promise<void> | undefined;
      lecture?.catch?.(() => {}); // AbortError (play interrompu par pause) : normal
    }
  };
  /**
   * Pendant que le plan en cours joue, chaque AUTRE lecteur est positionné
   * (en pause) sur son prochain extrait — le plus d'avance possible.
   */
  const preparerSuivants = () => {
    const vus = new Set<L>([plan[courant].el]);
    for (let n = courant + 1; n < plan.length; n++) {
      const { el, depuis } = plan[n];
      if (vus.has(el)) continue; // même élément que le plan en cours : préparé à la coupe
      vus.add(el);
      if (prepare.has(n)) continue;
      prepare.add(n);
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - depuis) > 0.05) el.currentTime = depuis;
    }
  };

  return {
    /** Avant l'enregistrement : chaque lecteur sur son premier extrait, en pause. */
    prepositionner() {
      for (const el of lecteurs) {
        const k = plan.findIndex((s) => s.el === el);
        el.pause();
        el.currentTime = plan[k].depuis;
        prepare.add(k);
      }
    },
    /**
     * Une image : `secondes` dans la séquence vidéo, ou `null` hors séquence
     * (tout est mis en pause). Renvoie l'élément à peindre.
     */
    image(secondes: number | null): L | null {
      if (secondes === null) {
        for (const el of lecteurs) if (!el.paused) el.pause();
        courant = -1;
        return null;
      }
      const k = indexA(secondes);
      if (courant === -1) {
        courant = k;
        demarrer(k, secondes);
      } else if (k !== courant) {
        const pret = prete(k);
        const report = Math.max(0, secondes - plan[k].debut);
        if (pret || report >= attenteMax || plan[courant].el === plan[k].el) {
          const precedent = plan[courant].el;
          options.surCoupe?.({ k, report, prete: pret, readyState: plan[k].el.readyState, seeking: plan[k].el.seeking, ecart: plan[k].el.currentTime - plan[k].depuis });
          bilan.coupes++;
          if (!pret) bilan.coupesNonPretes++;
          bilan.reportMax = Math.max(bilan.reportMax, report);
          courant = k;
          demarrer(k, secondes);
          if (precedent !== plan[k].el && !precedent.paused) precedent.pause();
        }
        // Sinon : le plan en cours CONTINUE de jouer — aucune image figée.
      }
      preparerSuivants();
      return plan[courant].el;
    },
    bilan: () => ({ ...bilan }),
  };
}
