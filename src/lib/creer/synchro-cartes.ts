/**
 * Synchro voix off ↔ cartes (Créer, cartes PLEIN ÉCRAN).
 *
 * La voix des cartes est UN fichier qui lit, carte après carte, « titre.
 * description. valeur ». À l'écran, une carte montre son icône, son TITRE et
 * sa VALEUR — la description est dite, jamais affichée. On découpe donc le
 * texte narré en MORCEAUX (un par élément dit) et l'on fait apparaître :
 *
 *   - la carte (cadre, icône, titre) quand la voix commence son titre ;
 *   - la valeur quand la voix commence la valeur.
 *
 * D'où viennent les instants, par ordre de préférence :
 *
 *   1. ElevenLabs `with-timestamps` : l'alignement RÉEL du fichier, converti
 *      côté serveur en [début, fin] par morceau (`segmentsDepuisAlignement`),
 *      APRÈS la normalisation TTS — « NEJM » affiché, « Nèjm » dit ;
 *   2. sinon une ESTIMATION au prorata du texte, sur la durée mesurée ;
 *   3. texte retouché à la main, cartes modifiées depuis la voix, pas de
 *      voix : AUCUN calage — le rendu d'avant, toutes les cartes ensemble.
 *
 * Module PUR (aucun DOM, aucun réseau) : partagé par la route TTS, le
 * panneau des voix et l'export.
 */

export type RoleMorceau = 'titre' | 'description' | 'valeur';

/** Un élément DIT d'une carte, et ce qui le suit dans le texte narré. */
export interface MorceauCarte {
  /** Rang de la carte (celui du DOM et du rendu). */
  carte: number;
  role: RoleMorceau;
  texte: string;
  /** Séparateur qui suit ce morceau dans le texte narré (« . », « ␠ », « »). */
  apres: string;
}

export interface CarteDite {
  title?: string | null;
  description?: string | null;
  value?: string | null;
}

/**
 * Les morceaux du texte narré des cartes, dans l'ordre de lecture. Mêmes
 * règles que `buildAutoFillText` : éléments non vides joints par « . »,
 * cartes jointes par une espace. `texteDesMorceaux` les recolle.
 */
export function morceauxCartes(cartes: readonly CarteDite[]): MorceauCarte[] {
  const parCarte: MorceauCarte[][] = [];
  cartes.forEach((c, carte) => {
    const elements: Array<[RoleMorceau, string | null | undefined]> = [['titre', c.title], ['description', c.description], ['valeur', c.value]];
    const dits = elements.filter(([, t]) => t && String(t).trim().length > 0);
    if (dits.length === 0) return;
    parCarte.push(dits.map(([role, t], i) => ({ carte, role, texte: String(t), apres: i < dits.length - 1 ? '. ' : '' })));
  });
  parCarte.forEach((m, i) => { if (i < parCarte.length - 1) m[m.length - 1].apres = ' '; });
  return parCarte.flat();
}

export function texteDesMorceaux(morceaux: ReadonlyArray<{ texte: string; apres: string }>): string {
  return morceaux.map((m) => m.texte + m.apres).join('');
}

// ─────────────────────────────────────────────────────────────────────────
// 1. ALIGNEMENT RÉEL (serveur)
// ─────────────────────────────────────────────────────────────────────────

/** L'alignement par caractère renvoyé par ElevenLabs `with-timestamps`. */
export interface AlignementCaracteres {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export type Segment = [debut: number, fin: number];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * [début, fin] RÉELS de chaque morceau DIT, lus dans l'alignement du texte
 * envoyé au moteur (`morceauxDits` recollés = ce texte, au caractère près).
 * `null` si l'alignement ne correspond pas exactement à ce texte : on ne
 * devine pas, l'appelant retombe sur l'estimation.
 */
export function segmentsDepuisAlignement(
  morceauxDits: ReadonlyArray<{ texte: string; apres: string }>,
  alignement: AlignementCaracteres | null | undefined,
): Segment[] | null {
  if (!alignement || morceauxDits.length === 0) return null;
  const { characters: car, character_start_times_seconds: debuts, character_end_times_seconds: fins } = alignement;
  if (!Array.isArray(car) || !Array.isArray(debuts) || !Array.isArray(fins)) return null;
  if (debuts.length !== car.length || fins.length !== car.length) return null;
  if (car.join('') !== texteDesMorceaux(morceauxDits)) return null;
  const out: Segment[] = [];
  let curseur = 0;
  for (const m of morceauxDits) {
    const premier = m.texte.search(/\S/);
    if (premier < 0) return null;
    const dernier = m.texte.length - 1 - (m.texte.length - m.texte.trimEnd().length);
    const d = debuts[curseur + premier];
    const f = fins[curseur + dernier];
    if (!Number.isFinite(d) || !Number.isFinite(f) || f < d) return null;
    out.push([r3(d), r3(f)]);
    curseur += m.texte.length + m.apres.length;
  }
  // Les débuts doivent avancer avec le texte.
  for (let i = 1; i < out.length; i++) if (out[i][0] < out[i - 1][0]) return null;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. ESTIMATION (repli)
// ─────────────────────────────────────────────────────────────────────────

/** Une pause (ponctuation, séparateur), en « lettres » (≈ 0,2 s à débit normal). */
const POIDS_PAUSE = 3;
const poids = (t: string) => (t.match(/[\p{L}\p{N}]/gu)?.length ?? 0) + (t.match(/[.!?…;:,]/g)?.length ?? 0) * POIDS_PAUSE;

/**
 * ESTIMATION — pas un horodatage : la durée mesurée répartie au prorata du
 * texte de chaque morceau (séparateurs comptés comme des pauses).
 */
export function segmentsEstimes(morceaux: ReadonlyArray<{ texte: string; apres: string }>, duree: number): Segment[] | null {
  if (!(duree > 0) || morceaux.length === 0) return null;
  const p = morceaux.map((m) => poids(m.texte) + (m.apres ? POIDS_PAUSE : 0));
  const total = p.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let cumul = 0;
  return morceaux.map((_m, i) => {
    const debut = (cumul / total) * duree;
    cumul += p[i];
    return [r3(debut), r3(i === morceaux.length - 1 ? duree : (cumul / total) * duree)] as Segment;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 3. CE QUI EST CONSERVÉ AVEC LA VOIX, ET CE QUE L'EXPORT EN TIRE
// ─────────────────────────────────────────────────────────────────────────

/** Calage réel conservé avec la voix des cartes (`SequenceVoice.timing`). */
export interface TimingVoix {
  source: 'elevenlabs';
  /** Les morceaux tels qu'ENVOYÉS (texte affiché) — preuve de correspondance. */
  morceaux: Array<{ texte: string; apres: string }>;
  segments: Segment[];
}

/** Relit un calage stocké (brouillon, état) ; `undefined` s'il est mal formé. */
export function lireTimingVoix(brut: unknown): TimingVoix | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  if (o.source !== 'elevenlabs' || !Array.isArray(o.morceaux) || !Array.isArray(o.segments)) return undefined;
  if (o.morceaux.length !== o.segments.length || o.morceaux.length === 0 || o.morceaux.length > 64) return undefined;
  const morceaux = o.morceaux.map((m) => (m && typeof m === 'object' ? m as Record<string, unknown> : {}));
  if (!morceaux.every((m) => typeof m.texte === 'string' && typeof m.apres === 'string')) return undefined;
  const segments = o.segments as unknown[];
  if (!segments.every((s) => Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === 'number' && Number.isFinite(n)))) return undefined;
  return {
    source: 'elevenlabs',
    morceaux: morceaux.map((m) => ({ texte: m.texte as string, apres: m.apres as string })),
    segments: segments as Segment[],
  };
}

/** Une étape d'apparition : à `debut` (s depuis le début de la voix des cartes). */
export interface EtapeApparition {
  debut: number;
  carte: number;
  /** `carte` : cadre, icône et titre ; `valeur` : la valeur de la carte. */
  element: 'carte' | 'valeur';
}

export interface CalageCartes {
  source: 'elevenlabs' | 'estimation';
  etapes: EtapeApparition[];
}

/**
 * Le calage à appliquer à l'export, ou `null` = rendu d'avant (toutes les
 * cartes ensemble). Jamais de devinette :
 *
 *   - pas de voix des cartes, ou durée inconnue      → null ;
 *   - texte lu ≠ texte attendu des cartes ACTUELLES   → null (texte retouché
 *     à la main, ou cartes modifiées depuis la génération) ;
 *   - calage réel enregistré pour EXACTEMENT ces morceaux → horodatage réel ;
 *   - sinon                                          → estimation.
 */
export function calageCartes(
  cartes: readonly CarteDite[],
  voix: { textAtGeneration?: string; duration?: number; timing?: TimingVoix } | null | undefined,
): CalageCartes | null {
  if (!voix?.textAtGeneration) return null;
  const morceaux = morceauxCartes(cartes);
  if (morceaux.length === 0) return null;
  if (texteDesMorceaux(morceaux) !== voix.textAtGeneration.trim()) return null;

  const t = lireTimingVoix(voix.timing);
  const memes = !!t && t.morceaux.length === morceaux.length
    && t.morceaux.every((m, i) => m.texte === morceaux[i].texte && m.apres === morceaux[i].apres);
  const segments = memes ? t!.segments : segmentsEstimes(morceaux, voix.duration ?? 0);
  if (!segments) return null;

  const etapes: EtapeApparition[] = [];
  const vues = new Set<number>();
  morceaux.forEach((m, i) => {
    // La carte apparaît au début de son PREMIER morceau dit (son titre, ou
    // à défaut ce qui est lu d'elle en premier).
    if (!vues.has(m.carte)) {
      vues.add(m.carte);
      etapes.push({ debut: segments[i][0], carte: m.carte, element: 'carte' });
    } else if (m.role === 'valeur') {
      etapes.push({ debut: segments[i][0], carte: m.carte, element: 'valeur' });
    }
  });
  etapes.sort((a, b) => a.debut - b.debut);
  return { source: memes ? 'elevenlabs' : 'estimation', etapes };
}

/**
 * Ce qui est visible après les `k` premières étapes : les cartes montrées,
 * et parmi elles celles dont la valeur l'est aussi. Une carte dont la valeur
 * n'est pas dite (pas de valeur) la montre avec elle.
 */
export function etatApres(calage: CalageCartes, k: number): { cartes: Set<number>; valeurs: Set<number> } {
  const cartes = new Set<number>();
  const valeurs = new Set<number>();
  const avecEtapeValeur = new Set(calage.etapes.filter((e) => e.element === 'valeur').map((e) => e.carte));
  for (const e of calage.etapes.slice(0, k)) {
    if (e.element === 'carte') {
      cartes.add(e.carte);
      if (!avecEtapeValeur.has(e.carte)) valeurs.add(e.carte);
    } else valeurs.add(e.carte);
  }
  return { cartes, valeurs };
}

/**
 * L'image à montrer à `secondes` dans la séquence Cartes : la dernière
 * étape commencée. `null` = aucune encore (rien des cartes n'est dessiné).
 */
export function imageCartesA<T>(etats: ReadonlyArray<{ debut: number; image: T }>, secondes: number): T | null {
  let choisie: T | null = null;
  for (const e of etats) {
    if (e.debut <= secondes + 1e-6) choisie = e.image;
    else break;
  }
  return choisie;
}

/**
 * Les morceaux envoyés par le client avec un texte à synthétiser — retenus
 * seulement s'ils recollent EXACTEMENT ce texte. Sinon `null` : la synthèse
 * se fait comme avant, sans horodatage.
 */
export function morceauxDeLaRequete(brut: unknown, texte: string): Array<{ texte: string; apres: string }> | null {
  if (!Array.isArray(brut) || brut.length === 0 || brut.length > 64) return null;
  const out: Array<{ texte: string; apres: string }> = [];
  for (const m of brut) {
    if (!m || typeof m !== 'object') return null;
    const { texte: t, apres: a } = m as Record<string, unknown>;
    if (typeof t !== 'string' || typeof a !== 'string' || !t.trim() || a.length > 4) return null;
    out.push({ texte: t, apres: a });
  }
  return texteDesMorceaux(out) === texte ? out : null;
}

/** En-tête de réponse qui porte les segments RÉELS (compact : un couple par morceau). */
export const ENTETE_SEGMENTS = 'X-Studiio-Segments';

/** Relit l'en-tête des segments ; `null` s'il est absent ou mal formé. */
export function segmentsDeLEntete(valeur: string | null, attendus: number): Segment[] | null {
  if (!valeur) return null;
  try {
    const s = JSON.parse(valeur) as unknown;
    if (!Array.isArray(s) || s.length !== attendus) return null;
    return s.every((x) => Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && Number.isFinite(n)))
      ? (s as Segment[]) : null;
  } catch {
    return null;
  }
}
