/**
 * Cle `bucket/<uid>/<dossier>/…` d'un fichier de BIBLIOTHEQUE utilisateur :
 * musique et voix (bucket `audio`), rushes importes (`media/<uid>/library/`).
 * Ces fichiers sont reutilises d'un contenu a l'autre (et par le brouillon
 * Creer, invisible du serveur) : supprimer un post ne doit pas les emporter.
 */
export function estMediaDeBibliotheque(cle: string): boolean {
  return /^audio\/[^/]+\/(music|voice)\//.test(cle) || /^media\/[^/]+\/library\//.test(cle);
}

/**
 * Fichiers DURABLES, jamais purgés par la rétention temporaire :
 *
 * ⚠️ UNIQUEMENT HORS DES DOSSIERS `<userId>/` : les envois navigateur ne
 * peuvent écrire que là (garde `startsWith(userId + '/')` des routes
 * d'envoi). Un motif DANS le dossier utilisateur se laisserait imiter par un
 * nom de fichier choisi par le client — et deviendrait du stockage permanent
 * gratuit.
 *
 * - l'audio complet PAYÉ (`audio/audio-complet/<uid>/<empreinte>.mp3`,
 *   `/api/voice/audio-complet`) — l'utilisateur a payé des crédits : le
 *   re-télécharger ne doit coûter ni un nouvel appel fournisseur, ni un
 *   nouveau crédit. La pré-écoute gratuite n'est jamais stockée.
 * - l'attribution d'un média stock (`media/stock-attributions/<uid>/…json`) —
 *   quelques octets qui gardent la licence d'un média importé.
 * - la fiche de contenu d'un rush (M2-a,
 *   `media/fiches-contenu/<uid>/analyse/<sha1>.<taille>.v1.json`) — quelques
 *   centaines d'octets, écrits par le seul serveur : le cache durable qui évite
 *   de recalculer (et, plus tard, de repayer) l'analyse d'un même rush.
 * - le registre des demandes de suppression RGPD / Meta
 *   (`media/suppressions/<code>.json`) : la page de statut doit pouvoir dire
 *   l'état réel d'une demande aussi longtemps qu'on la consulte ;
 * - les liens d'identité Meta (`media/liens-meta/<sha256>.json` et leur index
 *   inverse `media/liens-meta/compte/<uid>/<sha256>.json`), retirés par la
 *   suppression elle-même (`src/lib/rgpd/`).
 */
export function estFichierDurable(cle: string): boolean {
  return /^audio\/audio-complet\/[^/]+\/[0-9a-f]{24}\.mp3$/.test(cle)
    || /^media\/stock-attributions\/[^/]+\/[^/]+\.json$/.test(cle)
    || /^media\/fiches-contenu\/[^/]+\/analyse\/[0-9a-f]{40}\.\d+\.v\d+\.json$/.test(cle)
    || /^media\/suppressions\/[0-9a-f]{32}\.json$/.test(cle)
    || /^media\/liens-meta\/[0-9a-f]{64}\.json$/.test(cle)
    || /^media\/liens-meta\/compte\/[0-9a-f-]{36}\/[0-9a-f]{64}\.json$/.test(cle);
}
