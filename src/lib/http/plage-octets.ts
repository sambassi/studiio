/**
 * L'en-tête `Range` d'une requête, lu selon la RFC 7233 — et rien de plus.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mesuré en production sur la route des montages : `Range: bytes=0-1023`
 * recevait `200`, `Content-Length: 11958505` et le fichier ENTIER. Toutes les
 * formes — plage valide, plage au milieu, plage hors du fichier, en-tête
 * illisible — donnaient la même réponse, parce que l'en-tête n'était jamais
 * lu. Un lecteur HTML5 ne peut alors ni se positionner ni remplir son tampon.
 *
 * La lecture de cet en-tête est une décision à part entière : elle décide
 * d'un `200`, d'un `206` ou d'un `416`. Elle vit donc dans une fonction PURE,
 * que l'on peut éprouver sans serveur, sans stockage et sans session.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUI EST DÉLIBÉRÉMENT REFUSÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les plages MULTIPLES (`bytes=0-9,20-29`) ne sont pas servies. Y répondre
 * demande un corps `multipart/byteranges`, que ni les lecteurs vidéo ni les
 * téléchargements n'utilisent — et un `multipart` mal formé est pire qu'un
 * `200`. La RFC autorise explicitement le serveur à IGNORER un `Range` qu'il
 * ne sait pas honorer : on rend alors la ressource entière, ce qui reste
 * correct pour le client.
 *
 * Même règle pour tout ce qui n'est pas une plage d'octets lisible — une
 * autre unité (`items=0-9`), une syntaxe cassée (`bytes=abc`), des bornes
 * inversées : c'est ignoré, jamais transformé en erreur. Seule une plage
 * bien formée mais qui commence APRÈS la fin du fichier mérite un `416` :
 * là, le client a demandé quelque chose de précis qui n'existe pas.
 */

/** Ce que l'en-tête demande, une fois lu. */
export type PlageDemandee =
  /** Aucun `Range` exploitable : servir la ressource entière, en `200`. */
  | { sorte: 'absente' }
  /** Une plage bien formée et servable, bornes INCLUSES. */
  | { sorte: 'plage'; debut: number; fin: number; longueur: number }
  /** Bien formée, mais hors du fichier : `416`. */
  | { sorte: 'insatisfiable' };

/** Un entier décimal, sans signe, sans espace, ou `null`. */
function entier(brut: string): number | null {
  if (!/^\d+$/.test(brut)) return null;
  const n = Number(brut);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Lit un `Range` pour une ressource de `taille` octets.
 *
 * ⚠️ `taille` DOIT être la taille réelle de la ressource. C'est elle qui
 * décide de la borne de fin et du caractère satisfaisable de la demande :
 * une taille approchée produirait un `Content-Range` qui ment, et un lecteur
 * qui se positionne d'après un mensonge lit des octets décalés.
 */
export function lirePlageOctets(
  entete: string | null | undefined, taille: number,
): PlageDemandee {
  if (typeof entete !== 'string') return { sorte: 'absente' };
  const brut = entete.trim();
  if (!brut) return { sorte: 'absente' };

  // Une seule unité connue, et une seule plage. Voir l'en-tête du fichier.
  const m = /^bytes=(.+)$/i.exec(brut);
  if (!m) return { sorte: 'absente' };
  const spec = m[1].trim();
  if (spec.includes(',')) return { sorte: 'absente' };

  const parts = spec.split('-');
  if (parts.length !== 2) return { sorte: 'absente' };
  const [gauche, droite] = parts.map((p) => p.trim());

  // ── `bytes=-N` : les N DERNIERS octets ────────────────────────────────
  if (gauche === '') {
    const n = entier(droite);
    if (n === null) return { sorte: 'absente' };
    // ⚠️ UNE RESSOURCE VIDE N'A PAS DE DERNIER OCTET. Sans ce cas, `debut`
    // vaudrait 0 et `fin` -1, et le `Content-Range` annoncerait une plage
    // qui n'existe pas.
    if (taille === 0) return { sorte: 'insatisfiable' };
    // `bytes=-0` ne désigne rien : la RFC le dit insatisfaisable.
    if (n === 0) return { sorte: 'insatisfiable' };
    const debut = Math.max(0, taille - n);
    return { sorte: 'plage', debut, fin: taille - 1, longueur: taille - debut };
  }

  const debut = entier(gauche);
  if (debut === null) return { sorte: 'absente' };
  // Commencer à la taille ou au-delà, c'est demander ce qui n'existe pas.
  if (debut >= taille) return { sorte: 'insatisfiable' };

  // ── `bytes=N-` : de N jusqu'à la fin ──────────────────────────────────
  if (droite === '') {
    return { sorte: 'plage', debut, fin: taille - 1, longueur: taille - debut };
  }

  // ── `bytes=N-M` : bornes incluses, `M` ramené à la fin du fichier ─────
  const finDemandee = entier(droite);
  if (finDemandee === null) return { sorte: 'absente' };
  if (finDemandee < debut) return { sorte: 'absente' };
  const fin = Math.min(finDemandee, taille - 1);
  return { sorte: 'plage', debut, fin, longueur: fin - debut + 1 };
}

/** `bytes 0-1023/11958505` — la valeur de `Content-Range` d'un `206`. */
export function enteteContentRange(debut: number, fin: number, taille: number): string {
  return `bytes ${debut}-${fin}/${taille}`;
}

/**
 * La valeur de `Content-Range` d'un `416` : `bytes` puis une étoile, une
 * barre oblique et la taille — `bytes` + espace + `*` + `/11958505`.
 *
 * (Écrit en toutes lettres : la forme littérale referme un commentaire.)
 */
export function enteteContentRangeInsatisfiable(taille: number): string {
  return `bytes */${taille}`;
}
