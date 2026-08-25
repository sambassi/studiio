/**
 * Primitives internes du contrat canonique.
 *
 * Aucune logique metier ici : uniquement de quoi copier, geler, comparer et
 * adresser des donnees JSON sans jamais toucher a l'objet d'origine.
 *
 * Ces fonctions ne sont PAS exportees par `index.ts` : elles sont un detail
 * d'implementation, et les figer dans l'API publique interdirait de les
 * remplacer plus tard.
 */

/** Objet ouvert : tout ce qui n'est pas declare reste lisible, et surtout conserve. */
export interface OpenRecord {
  [key: string]: unknown;
}

/**
 * Objet « nu » au sens JSON : ni classe, ni tableau, ni null.
 *
 * Le test porte sur le prototype et non sur `typeof` : une instance de classe
 * ne doit pas etre traitee comme un dictionnaire, sinon on la clonerait en
 * perdant sa chaine de prototypes.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Copie profonde.
 *
 * `Object.keys` conserve les cles portant `undefined` : une cle PRESENTE avec
 * une valeur indefinie reste presente apres copie. C'est ce qui permet de
 * distinguer « absent » de « defini a undefined » plus loin.
 *
 * Limite assumee : une valeur qui n'est ni un tableau, ni un objet nu, ni une
 * `Date` est renvoyee telle quelle (fonction, instance de classe, element du
 * DOM). Les metadonnees d'un post sont du JSON — le cas ne se presente pas —
 * et recopier ces valeurs a l'aveugle serait plus dangereux que de les passer.
 */
export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) safeAssign(out, key, deepClone(value[key]));
    return out as unknown as T;
  }
  return value;
}

/**
 * Gel profond.
 *
 * Le `seen` protege des cycles : les metadonnees n'en contiennent pas, mais
 * une pile d'appels infinie serait un plantage bien plus couteux a
 * diagnostiquer que ce garde-fou.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

/**
 * Egalite structurelle.
 *
 * `Object.is` sur les primitives : `NaN` egale `NaN`, ce que `===` refuse.
 * `+0` et `-0` sont donc distingues — sans consequence sur du JSON, ou `-0`
 * se serialise en `0`.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
    );
  }
  return false;
}

/**
 * Ecriture d'une cle SANS risque de detournement de prototype.
 *
 * `target['__proto__'] = v` ne cree pas une propriete : il APPELLE le mutateur
 * de prototype et remplace la chaine de l'objet. Or `JSON.parse` produit bien
 * une cle propre nommee `__proto__` quand la charge utile en contient une —
 * recopier naivement ce dictionnaire suffirait donc a detourner l'objet
 * fusionne. `defineProperty` cree la propriete telle quelle, ce qui preserve
 * a la fois la fidelite de l'aller-retour et l'integrite de l'objet.
 *
 * `constructor` et `prototype` n'ont pas de mutateur sur un objet nu :
 * l'affectation directe y cree une propriete propre, sans effet de bord.
 */
export function safeAssign(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
}

/** La cle existe-t-elle en propre, meme portant `undefined` ? */
export function hasOwn(target: unknown, key: string): boolean {
  return isPlainObject(target) && Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * Lecture par chemin pointe (`'content.subtitle'`, `'sequences'`).
 *
 * Un segment manquant renvoie `undefined` plutot que de lever : le contrat
 * doit tolerer n'importe quelle forme entrante, y compris absurde.
 */
export function getPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const segment of path.split('.')) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/** Ecriture par chemin pointe. Les niveaux intermediaires manquants sont crees. */
export function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];
    if (!isPlainObject(next)) safeAssign(cursor, segment, {});
    cursor = cursor[segment] as Record<string, unknown>;
  }
  safeAssign(cursor, segments[segments.length - 1], value);
}
