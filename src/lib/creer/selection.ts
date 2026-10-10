/**
 * Selection de cartes, et deplacement d'un lot.
 *
 * Regles PURES, sans React ni DOM : c'est ce qui les rend verifiables sur des
 * valeurs. Laissees en ligne dans un composant de pres de 4 000 lignes, elles
 * n'etaient testables que par correspondance de chaine — et une inversion de
 * `additive` passait alors inapercue.
 */

import type { CardBox, Pos } from './dragPosition';
import { ALL_LUCIDE_NAMES } from '../icons/library';

/**
 * Etat suivant de la selection apres un appui sur `id`.
 *
 * `additive` (Maj, Cmd ou Ctrl) ajoute ou retire. Sinon l'appui isole la
 * carte — SAUF si elle fait deja partie du lot : sans cette exception, saisir
 * une carte d'un ensemble le deferait des l'appui, et deplacer un lot serait
 * impossible.
 *
 * Rend la reference PRECEDENTE quand rien ne change : un `Set` neuf a chaque
 * appui re-rendrait tout l'editeur pour rien.
 */
export function nextSelection(prev: Set<string>, id: string, additive: boolean): Set<string> {
  if (additive) {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  if (prev.has(id)) return prev;
  return new Set([id]);
}

/** Retire de la selection les cartes qui n'existent plus. */
export function pruneSelection(prev: Set<string>, ids: string[]): Set<string> {
  if (prev.size === 0) return prev;
  const kept = new Set([...prev].filter((id) => ids.includes(id)));
  return kept.size === prev.size ? prev : kept;
}

/**
 * Cartes qui suivront le glissement : le lot si la carte saisie en fait
 * partie, la carte seule sinon.
 */
export function movingIds(selection: Set<string>, dragged: string): string[] {
  return selection.has(dragged) ? [...selection] : [dragged];
}

/** Rectangle englobant d'un lot, en % du conteneur. */
export function groupBounds(boxes: Record<string, CardBox>, ids: string[]): CardBox | null {
  const list = ids.map((id) => boxes[id]).filter(Boolean);
  if (list.length === 0) return null;
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  const right = Math.max(...list.map((b) => b.x + b.w));
  const bottom = Math.max(...list.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Deplacement reellement applicable a un lot.
 *
 * Borner chaque carte separement DEFORMERAIT le lot : celles qui touchent le
 * bord s'arreteraient pendant que les autres continuent. On borne donc le
 * rectangle englobant, et le meme ecart est applique a toutes.
 */
export function clampGroupDelta(bounds: CardBox, delta: Pos): Pos {
  const minDx = -bounds.x;
  const maxDx = 100 - bounds.w - bounds.x;
  const minDy = -bounds.y;
  const maxDy = 100 - bounds.h - bounds.y;
  return {
    // `min` avant `max` : un lot plus large que le conteneur donnerait des
    // bornes inversees, et l'ecart doit alors rester nul plutot que negatif.
    x: Math.max(minDx, Math.min(maxDx, delta.x)),
    y: Math.max(minDy, Math.min(maxDy, delta.y)),
  };
}

/** Applique un ecart commun a chaque carte du lot. */
export function shiftBoxes(
  boxes: Record<string, CardBox>,
  ids: string[],
  delta: Pos,
): Record<string, CardBox> {
  if (delta.x === 0 && delta.y === 0) return boxes;
  const out = { ...boxes };
  for (const id of ids) {
    const b = boxes[id];
    if (!b) continue;
    out[id] = { ...b, x: b.x + delta.x, y: b.y + delta.y };
  }
  return out;
}

/**
 * Nombre maximal de cartes que le compositeur sait dessiner.
 *
 * `video-composer.ts` borne a `isReel ? 5 : 6`, et `isReel` s'y decide sur
 * `hauteur > largeur` : le CARRE compte donc comme un paysage, 6 cartes. Les
 * cartes au-dela seraient silencieusement absentes du montage de secours — et
 * en flux, la colonne deborderait de son conteneur, donc de la photo.
 */
export function maxCards(format: string): number {
  return format === '9:16' ? 5 : 6;
}

/**
 * Longueurs maximales des champs d'une carte, a la saisie.
 *
 * Valeur 24 et description 200 : les bornes de l'editeur avance (qui ne les
 * posait chacune que dans UN de ses deux editeurs). Titre 120 : l'avance n'en
 * posait aucune, et un titre sans limite deborde de sa carte a l'ecran.
 */
export const CARTE_LIMITES = { title: 120, value: 24, description: 200 } as const;

/** Les SEULS champs qu'on modifie sur une carte existante (portage PR 1). */
export type CarteTexte = { title: string; value: string; description: string };

/**
 * Modifie le texte d'UNE carte existante, designee par son identifiant.
 *
 * - l'`id` et l'icone ne changent jamais : seuls titre, valeur et description
 *   sont lus dans `patch` (une autre cle est ignoree). C'est l'identifiant qui
 *   relie la carte a sa case en mode libre, a ses groupes, et — a
 *   l'enregistrement — a la carte d'origine du post (`cartesPourEnregistrement`) ;
 * - les longueurs sont bornees (`CARTE_LIMITES`) ;
 * - un identifiant inconnu rend le MEME tableau : rien a re-rendre ;
 * - les autres cartes gardent leur reference.
 */
export function updateCard<T extends Identified & CarteTexte>(
  cards: T[],
  id: string,
  patch: Partial<CarteTexte>,
): T[] {
  const index = cards.findIndex((c) => c.id === id);
  if (index < 0) return cards;
  const next: Partial<CarteTexte> = {};
  for (const cle of ['title', 'value', 'description'] as const) {
    const v = patch[cle];
    if (typeof v === 'string') next[cle] = v.slice(0, CARTE_LIMITES[cle]);
  }
  const out = cards.slice();
  out[index] = { ...cards[index], ...next };
  return out;
}

/**
 * Ajoute UNE carte a la fin, dans la limite du format (`maxCards`).
 *
 * A la fin et non apres la selection : la carte neuve est vide, l'utilisateur
 * la remplit dans la liste — la placer au milieu decalerait tout ce qu'il a
 * sous les yeux. Refusee au-dela du maximum : le compositeur tronquerait en
 * silence les cartes en trop.
 */
export function addCard<T extends { id: string }>(cards: T[], card: T, max: number): { cards: T[]; added: boolean } {
  if (cards.length >= max) return { cards, added: false };
  return { cards: [...cards, card], added: true };
}

/**
 * Retire UNE carte par identifiant — jamais la derniere.
 *
 * Zero carte n'est pas un etat que le montage sait rendre de facon verifiee
 * (sequence « Cartes » vide) : on garde au moins une carte. Identifiant
 * inconnu : rien ne bouge.
 */
export function removeCard<T extends { id: string }>(cards: T[], id: string): { cards: T[]; removed: boolean } {
  if (cards.length <= 1 || !cards.some((c) => c.id === id)) return { cards, removed: false };
  return { cards: cards.filter((c) => c.id !== id), removed: true };
}

/** Case par defaut d'une carte neuve sans voisine mesuree : centree, lisible. */
const BOX_PAR_DEFAUT: CardBox = { x: 30, y: 40, w: 40, h: 15 };

/**
 * Emplacement d'une carte NEUVE en mode libre.
 *
 * Sans emplacement, le mode libre n'est plus valide et TOUTE la disposition de
 * l'utilisateur serait effacee (`validFree`). La carte neuve est posee en
 * decale de la derniere carte — meme regle que la duplication (visible, pas
 * superposee) — ou, a defaut, au centre.
 */
export function boxForNewCard(boxes: Record<string, CardBox>, lastId: string | undefined, offset = 3): CardBox {
  const src = lastId ? boxes[lastId] : undefined;
  if (!src) return { ...BOX_PAR_DEFAUT };
  return {
    ...src,
    x: Math.min(Math.max(0, 100 - src.w), src.x + offset),
    y: Math.min(Math.max(0, 100 - src.h), src.y + offset),
  };
}

/**
 * Retire l'emplacement d'une carte supprimee.
 *
 * Un emplacement ORPHELIN invalide le brouillon au rechargement
 * (`sanitizeCardBoxes` : tout ou rien) — la disposition entiere serait perdue.
 */
export function removeBox(boxes: Record<string, CardBox>, id: string): Record<string, CardBox> {
  if (!(id in boxes)) return boxes;
  const out = { ...boxes };
  delete out[id];
  return out;
}

/** Noms acceptes pour l'icone d'une carte : la bibliotheque lucide, rien d'autre. */
const ICONES_CARTE = new Set(ALL_LUCIDE_NAMES);

/**
 * Change l'ICONE d'une carte existante (portage cartes PR 3).
 *
 * - SVG LUCIDE UNIQUEMENT : seul un nom de `ICON_LIBRARY` est accepte (la
 *   grille `IconPicker` n'en propose pas d'autre) — un emoji, un nom inconnu
 *   ou vide ne change rien. Regle absolue du depot : jamais d'emoji.
 * - l'identifiant, le texte et tout le reste de la carte sont conserves ;
 * - identifiant inconnu ou icone identique : le MEME tableau.
 *
 * Distinct de `updateCard`, qui ne touche volontairement jamais l'icone.
 */
export function setCardIcon<T extends Identified & { icon: string }>(cards: T[], id: string, icon: string): T[] {
  if (!ICONES_CARTE.has(icon)) return cards;
  const index = cards.findIndex((c) => c.id === id);
  if (index < 0 || cards[index].icon === icon) return cards;
  const out = cards.slice();
  out[index] = { ...cards[index], icon };
  return out;
}

/** Une carte, vue par les regles de duplication : seul l'`id` compte ici. */
export interface Identified {
  id: string;
}

export interface Duplication<T extends Identified> {
  /** Liste complete apres insertion. */
  cards: T[];
  /** Copies creees, dans l'ordre — elles deviennent la nouvelle selection. */
  created: { sourceId: string; id: string }[];
  /** Copies refusees faute de place. */
  dropped: number;
}

/**
 * Duplique les cartes retenues, chaque copie inseree JUSTE APRES son original.
 *
 * Inserer a la fin eloignerait la copie de ce qu'on vient de designer ; la
 * placer juste apres garde la lecture du montage intacte. L'ordre du tableau
 * fait foi, pas l'ordre de selection : deux copies restent dans le meme ordre
 * que leurs sources.
 */
export function duplicateCards<T extends Identified>(
  cards: T[],
  selection: Set<string>,
  newId: () => string,
  max: number,
): Duplication<T> {
  const out: T[] = [];
  const created: { sourceId: string; id: string }[] = [];
  let dropped = 0;
  let total = cards.length;
  for (const card of cards) {
    out.push(card);
    if (!selection.has(card.id)) continue;
    if (total >= max) { dropped += 1; continue; }
    const id = newId();
    out.push({ ...card, id });
    created.push({ sourceId: card.id, id });
    total += 1;
  }
  return { cards: out, created, dropped };
}

/**
 * Emplacements des copies, decales de `offset` par rapport a leur source et
 * bornes au conteneur.
 *
 * Sans decalage, une copie se poserait EXACTEMENT sur son original : on
 * croirait que rien ne s'est passe, puis on deplacerait la mauvaise.
 */
export function duplicateBoxes(
  boxes: Record<string, CardBox>,
  created: { sourceId: string; id: string }[],
  offset = 3,
): Record<string, CardBox> {
  const out = { ...boxes };
  for (const { sourceId, id } of created) {
    const src = boxes[sourceId];
    if (!src) continue;
    out[id] = {
      ...src,
      x: Math.min(Math.max(0, 100 - src.w), src.x + offset),
      y: Math.min(Math.max(0, 100 - src.h), src.y + offset),
    };
  }
  return out;
}

/**
 * Groupe de cartes : elles se selectionnent et se deplacent ensemble.
 *
 * Le groupe ne touche JAMAIS au texte des cartes (titre, description, valeur,
 * icone, identifiant). En disposition en flux, ses membres consecutifs sont
 * encadres ensemble dans l'apercu ET dans la photo exportee
 * (`SequenceCards`) ; l'ordre de lecture de la voix reste celui du tableau
 * des cartes, c'est-a-dire l'ordre affiche.
 */
export interface CardGroup {
  id: string;
  cardIds: string[];
}

/** Un groupe n'a de sens qu'a partir de deux cartes. */
export const MIN_GROUP = 2;

let groupSeq = 0;
/**
 * Identifiant de groupe. Compteur + horodatage, comme `newCardId` : deux
 * groupes crees dans la meme milliseconde doivent rester distincts.
 */
export const newGroupId = () => `grp-${Date.now().toString(36)}-${(groupSeq++).toString(36)}`;

let elementSeq = 0;
/** Identifiant d'element libre — meme forme que les cartes et les groupes. */
export const newElementId = () => `el-${Date.now().toString(36)}-${(elementSeq++).toString(36)}`;

export function groupOf(groups: CardGroup[], id: string): CardGroup | undefined {
  return groups.find((g) => g.cardIds.includes(id));
}

/**
 * Groupe les cartes retenues.
 *
 * Une carte n'appartient qu'a UN groupe : les nouvelles membres sont d'abord
 * retirees de leur groupe precedent, et un groupe reduit a moins de deux
 * cartes disparait — sinon il resterait des groupes fantomes d'une seule
 * carte, invisibles et impossibles a defaire.
 */
export function groupCards(groups: CardGroup[], ids: string[], newId: () => string): CardGroup[] {
  if (ids.length < MIN_GROUP) return groups;
  const nettoyes = groups
    .map((g) => ({ ...g, cardIds: g.cardIds.filter((cid) => !ids.includes(cid)) }))
    .filter((g) => g.cardIds.length >= MIN_GROUP);
  return [...nettoyes, { id: newId(), cardIds: [...ids] }];
}

/** Retire les cartes indiquees de leur groupe, et jette les groupes vides. */
export function ungroupCards(groups: CardGroup[], ids: Set<string>): CardGroup[] {
  const out = groups
    .map((g) => ({ ...g, cardIds: g.cardIds.filter((cid) => !ids.has(cid)) }))
    .filter((g) => g.cardIds.length >= MIN_GROUP);
  return out.length === groups.length && out.every((g, i) => g.cardIds.length === groups[i].cardIds.length)
    ? groups
    : out;
}

/** Oublie les cartes qui n'existent plus, et les groupes trop petits. */
export function pruneGroups(groups: CardGroup[], cardIds: string[]): CardGroup[] {
  const out = groups
    .map((g) => ({ ...g, cardIds: g.cardIds.filter((cid) => cardIds.includes(cid)) }))
    .filter((g) => g.cardIds.length >= MIN_GROUP);
  const inchange =
    out.length === groups.length && out.every((g, i) => g.cardIds.length === groups[i].cardIds.length);
  return inchange ? groups : out;
}

/**
 * Etend une selection a tous les membres des groupes touches.
 *
 * C'est ce qui fait qu'un groupe se comporte comme un bloc : le designer une
 * fois suffit a le prendre en entier.
 */
export function expandSelection(selection: Set<string>, groups: CardGroup[]): Set<string> {
  if (selection.size === 0 || groups.length === 0) return selection;
  const out = new Set(selection);
  for (const g of groups) {
    if (g.cardIds.some((id) => out.has(id))) g.cardIds.forEach((id) => out.add(id));
  }
  return out.size === selection.size ? selection : out;
}

/**
 * Bascule UNE carte dans la selection depuis la liste (case a cocher).
 *
 * Meme logique de bloc que `expandSelection` : cocher un membre prend tout son
 * groupe, le decocher retire tout son groupe — sinon `expandSelection` le
 * remettrait aussitot, et la case resterait cochee.
 */
export function basculerSelection(prev: Set<string>, id: string, groups: CardGroup[]): Set<string> {
  const g = groupOf(groups, id);
  const ids = g ? g.cardIds : [id];
  const next = new Set(prev);
  if (prev.has(id)) ids.forEach((cid) => next.delete(cid));
  else ids.forEach((cid) => next.add(cid));
  return next;
}

/**
 * Un BLOC de la liste des cartes : une carte seule, ou une suite CONSECUTIVE
 * de membres d'un meme groupe.
 */
export interface BlocCartes {
  /** `carte:<id>` pour une carte seule, `groupe:<id>` pour un groupe. */
  id: string;
  /** Le groupe du bloc, `null` pour une carte seule. */
  groupId: string | null;
  /** Les cartes du bloc, dans l'ordre du tableau. */
  cardIds: string[];
}

/**
 * Les blocs, dans l'ordre du tableau des cartes — qui est l'ordre affiche ET
 * l'ordre de lecture de la voix.
 *
 * Un groupe dont les membres ne sont PAS consecutifs (brouillon d'avant cette
 * regle, duplication au milieu d'un groupe) donne plusieurs blocs — suffixes
 * `#2`, `#3` — plutot que d'etre rassemble en silence : l'ordre affiche doit
 * rester celui du tableau, sans quoi la voix ne suivrait plus l'ecran.
 */
export function blocsCartes(cards: readonly Identified[], groups: CardGroup[]): BlocCartes[] {
  const out: BlocCartes[] = [];
  const vus = new Map<string, number>();
  for (const c of cards) {
    const g = groupOf(groups, c.id);
    const dernier = out[out.length - 1];
    if (g && dernier && dernier.groupId === g.id) {
      dernier.cardIds.push(c.id);
      continue;
    }
    if (!g) {
      out.push({ id: `carte:${c.id}`, groupId: null, cardIds: [c.id] });
      continue;
    }
    const n = (vus.get(g.id) ?? 0) + 1;
    vus.set(g.id, n);
    out.push({ id: n === 1 ? `groupe:${g.id}` : `groupe:${g.id}#${n}`, groupId: g.id, cardIds: [c.id] });
  }
  return out;
}

/** Reconstruit le tableau dans l'ordre d'identifiants donne (memes objets). */
function selonOrdre<T extends Identified>(cards: T[], ids: string[]): T[] {
  const parId = new Map(cards.map((c) => [c.id, c]));
  return ids.map((id) => parId.get(id)!).filter(Boolean);
}

/**
 * Regroupe les cartes `ids` — et les rend CONSECUTIVES.
 *
 * Les membres sont rassembles a la place du PREMIER d'entre eux, dans leur
 * ordre relatif d'origine ; les autres cartes gardent le leur. Le texte des
 * cartes n'est jamais modifie : seuls l'ordre du tableau et l'appartenance aux
 * groupes changent. Si l'ordre change, la voix des cartes deja generee devient
 * perimee (le texte attendu change) — `calageCartes` rend alors `null`.
 *
 * Moins de `MIN_GROUP` cartes existantes : les MEMES references.
 */
export function regrouper<T extends Identified>(
  cards: T[],
  groups: CardGroup[],
  ids: Iterable<string>,
  newId: () => string,
): { cards: T[]; groups: CardGroup[] } {
  const retenus = new Set(ids);
  const membres = cards.filter((c) => retenus.has(c.id));
  if (membres.length < MIN_GROUP) return { cards, groups };
  const premier = cards.findIndex((c) => retenus.has(c.id));
  const autres = cards.filter((c) => !retenus.has(c.id));
  // Avant le premier membre, il n'y a que des non-membres : `premier` est donc
  // aussi sa place dans `autres`.
  const ordre = [...autres.slice(0, premier), ...membres, ...autres.slice(premier)];
  const inchange = ordre.every((c, i) => c === cards[i]);
  return {
    cards: inchange ? cards : ordre,
    groups: groupCards(groups, membres.map((c) => c.id), newId),
  };
}

/**
 * Deplace un BLOC entier (carte seule ou groupe) de `delta` blocs — l'ordre
 * interne du bloc est conserve. Bloc inconnu ou deja au bord : le MEME
 * tableau. Les groupes, eux, ne changent pas : seul l'ordre bouge.
 */
export function deplacerBloc<T extends Identified>(
  cards: T[],
  groups: CardGroup[],
  blocId: string,
  delta: number,
): T[] {
  const blocs = blocsCartes(cards, groups);
  const i = blocs.findIndex((b) => b.id === blocId);
  if (i < 0 || !Number.isInteger(delta) || delta === 0) return cards;
  const j = Math.max(0, Math.min(blocs.length - 1, i + delta));
  if (j === i) return cards;
  const ordre = blocs.slice();
  const [bloc] = ordre.splice(i, 1);
  ordre.splice(j, 0, bloc);
  return selonOrdre(cards, ordre.flatMap((b) => b.cardIds));
}
