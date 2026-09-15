/**
 * Côté navigateur : l'intention « utiliser mon jumeau », et le garde avant
 * tout rendu. Le navigateur ne décide rien : il DEMANDE au serveur.
 */

export interface EtatJumeau {
  pret: boolean;
  motif: string | null;
  message: string | null;
  jumeau: { avatar: { id: string; version: number; nom: string | null; valideLe: string }; voix: { id: string; nom: string }; prononciations: number } | null;
  moteurDisponible: boolean;
  messageMoteur: string | null;
  scripts?: Array<{ display: string; spoken: string }>;
}

export const JUMEAU_API = '/api/creer/jumeau';
export const JUMEAU_INDISPONIBLE = 'Votre jumeau n’est plus disponible. Vérifiez votre avatar et votre voix.';

/** L'état du jumeau, tel que le serveur le voit maintenant. `null` si l'appel échoue. */
export async function lireEtatJumeau(fetchImpl: typeof fetch = fetch): Promise<EtatJumeau | null> {
  try {
    const res = await fetchImpl(JUMEAU_API);
    const json = await res.json();
    return json?.success ? (json.data as EtatJumeau) : null;
  } catch {
    return null;
  }
}

/** La vérification COMPLÈTE avant génération, avec les textes de la vidéo. */
export async function verifierJumeauAvantRendu(textes: string[], fetchImpl: typeof fetch = fetch): Promise<EtatJumeau | null> {
  try {
    const res = await fetchImpl(JUMEAU_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ textes }) });
    const json = await res.json();
    return json?.success ? (json.data as EtatJumeau) : null;
  } catch {
    return null;
  }
}

/**
 * LE GARDE. Rend `null` si le rendu peut continuer, sinon le message qui
 * l'arrête. Sans « Utiliser mon jumeau », rien ne change au parcours normal.
 * Avec : le serveur DOIT confirmer que le jumeau est prêt (revérification
 * complète), puis que le moteur vidéo du jumeau existe — sinon on s'arrête,
 * sans jamais produire une vidéo ordinaire sous ce nom.
 */
export async function gardeJumeauAvantRendu(args: {
  useDigitalTwin: boolean;
  textes: string[];
  verifier?: (textes: string[]) => Promise<EtatJumeau | null>;
}): Promise<string | null> {
  if (args.useDigitalTwin !== true) return null;
  const etat = await (args.verifier ?? verifierJumeauAvantRendu)(args.textes);
  if (!etat) return JUMEAU_INDISPONIBLE;
  if (!etat.pret) return etat.message || JUMEAU_INDISPONIBLE;
  if (!etat.moteurDisponible) return etat.messageMoteur || 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.';
  return null;
}
