/**
 * MESSAGES NEUTRES — ce qu'un utilisateur lit quand un service externe
 * échoue. Studiio est la seule marque visible.
 *
 * Deux fuites fermées ici, et elles sont différentes :
 *
 *  1. NOMMER LE FOURNISSEUR. « Anthropic API not configured »,
 *     « OpenAI TTS failed », « clé Replicate absente » : le nom du
 *     prestataire part au navigateur.
 *  2. RELAYER SON MESSAGE D'ERREUR BRUT. Plus insidieux : le texte vient du
 *     fournisseur, donc il peut contenir son nom, son domaine, un identifiant
 *     de modèle ou un quota. Un `${e.message}` dans une réponse JSON est une
 *     fuite même quand le code, lui, ne nomme personne.
 *
 * RÈGLE : le détail va dans `console.error` (et aux alertes admin, qui ont le
 * droit de nommer le fournisseur) ; l'utilisateur reçoit une de ces phrases.
 *
 * Le but n'est pas d'être vague : chaque message dit QUOI est indisponible et
 * ce que la personne peut faire. Il ne dit simplement pas CHEZ QUI.
 */

/** Génération / amélioration de texte, scénario, suggestions. */
export const MESSAGE_IA_NON_CONFIGUREE =
  'L’assistance IA n’est pas configurée sur ce serveur. Contacte l’administrateur.';
export const MESSAGE_IA_INDISPONIBLE =
  'L’assistance IA est momentanément indisponible. Réessaie dans un instant.';

/** Synthèse vocale, toutes familles de voix confondues. */
export const MESSAGE_VOIX_NON_CONFIGUREE =
  'Le service de voix n’est pas configuré sur ce serveur. Contacte l’administrateur.';
export const MESSAGE_VOIX_INDISPONIBLE =
  'Le service de voix est momentanément indisponible. Réessaie dans un instant, ou choisis une autre voix.';

/** Images et retouches IA. */
export const MESSAGE_IMAGE_IA_NON_CONFIGUREE =
  'Le service d’images IA n’est pas configuré sur ce serveur. Aucun crédit débité — contacte l’administrateur.';
export const MESSAGE_IMAGE_IA_INDISPONIBLE =
  'Le service d’images IA est momentanément indisponible. Aucun crédit débité.';

/**
 * Les noms qui ne doivent jamais partir au navigateur. Sert aux tests de
 * non-régression, et à `sansNomDeFournisseur` en dernier recours.
 */
export const NOMS_FOURNISSEURS_INTERDITS = [
  'anthropic', 'claude', 'openai', 'gpt-4', 'replicate', 'higgsfield', 'elevenlabs',
  'heygen', 'groq', 'msedge', 'edge-tts', 'flux-schnell', 'black-forest-labs',
  'wan-video', 'kling', 'seedance', 'pixverse', 'minimax', 'runway', 'deepgram',
  'assemblyai', 'whisper', 'did.com', 'd-id',
] as const;

/**
 * Dernier filet quand un message d'origine externe doit quand même être
 * montré : si une seule marque interdite y figure, on rend le message neutre
 * à la place. Ce n'est PAS une autorisation à relayer : la bonne pratique
 * reste de journaliser le détail et de renvoyer une constante ci-dessus.
 */
export function sansNomDeFournisseur(message: string | null | undefined, repli: string): string {
  const t = (message ?? '').trim();
  if (!t) return repli;
  const bas = t.toLowerCase();
  return NOMS_FOURNISSEURS_INTERDITS.some((n) => bas.includes(n)) ? repli : t;
}
