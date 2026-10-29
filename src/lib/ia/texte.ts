/**
 * LE MOTEUR DE TEXTE IA DE STUDIIO — UN SEUL, partage.
 *
 * Ce module est l'EXTRACTION de ce que `/api/content/ai-generate` faisait deja pour ses
 * champs courts (titre, sous-titre, CTA, voix off) : meme fournisseur, meme cle serveur,
 * memes modeles, meme repli, meme lecture de la reponse. Il ne contient AUCUNE regle metier
 * et n'ouvre AUCUNE nouvelle integration : les appelants fournissent le prompt, et c'est tout.
 *
 * Pourquoi l'extraire : l'aide a la redaction de Cinema IA avait besoin exactement de cela.
 * Le recopier aurait donne deux chemins vers le meme fournisseur, avec deux gestions
 * d'erreur a maintenir — et une seule des deux corrigee le jour d'une panne.
 *
 * COUT : la cle est celle de Studiio, cote serveur. Comme pour les textes de « Creer »,
 * AUCUN credit utilisateur n'est debite. Rien ici ne touche aux credits ni aux tarifs.
 */

/** Modele rapide pour des reponses courtes en JSON ; Sonnet prend le relais en cas de 4xx/5xx passager. */
export const MODELE_TEXTE_PRIMAIRE = 'claude-haiku-4-5-20251001';
export const MODELE_TEXTE_REPLI = 'claude-3-5-sonnet-20241022';
/** Plafond par appel : un ecran qui attend n'attend jamais indefiniment. */
export const DELAI_TEXTE_MS = 30_000;

const URL_MESSAGES = 'https://api.anthropic.com/v1/messages';

export async function appelerModeleTexte(
  cleApi: string,
  corps: Record<string, unknown>,
  modele: string,
  delaiMs: number = DELAI_TEXTE_MS,
): Promise<Response> {
  const ac = new AbortController();
  const minuteur = setTimeout(() => ac.abort(), delaiMs);
  try {
    return await fetch(URL_MESSAGES, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cleApi,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ ...corps, model: modele }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Le `text` d'une reponse attendue au format `{"text":"..."}`, dans l'ordre :
 * JSON direct (barrieres markdown retirees), premier objet `{...}`, expression
 * permissive, puis — en dernier recours — le texte brut s'il n'a rien d'un JSON.
 * `null` quand rien n'est exploitable : l'appelant le DIT, il ne devine pas.
 */
export function extraireTexte(brut: string, longueurMaxBrute = 200): string | null {
  let s = brut.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }
  try {
    const parse = JSON.parse(s);
    if (parse && typeof parse.text === 'string') return parse.text.trim();
  } catch { /* on continue */ }
  const debut = s.indexOf('{');
  const fin = s.lastIndexOf('}');
  if (debut !== -1 && fin > debut) {
    try {
      const parse = JSON.parse(s.substring(debut, fin + 1));
      if (parse && typeof parse.text === 'string') return parse.text.trim();
    } catch { /* on continue */ }
  }
  const m = s.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) return m[1].replace(/\\"/g, '"').trim();
  const nu = s.replace(/^['"]|['"]$/g, '').trim();
  if (nu && !nu.includes('{') && nu.length < longueurMaxBrute) return nu;
  return null;
}

/**
 * Solde Anthropic epuise : c'est DEFINITIF tant que l'organisation ne recharge pas.
 * Reessayer sur un second modele rendrait la meme erreur ; l'appelant doit replier.
 */
export function estErreurFacturation(texteErreur: string): boolean {
  const t = texteErreur.toLowerCase();
  return t.includes('credit balance is too low') || t.includes('plans & billing') || t.includes('billing');
}

export type IssueTexteIA =
  | { ok: true; texte: string }
  /** Service indisponible cote fournisseur (facturation) : a l'appelant de replier localement. */
  | { ok: false; motif: 'indisponible' }
  /** Le fournisseur a repondu, mais pas exploitable (statut, reponse vide, format illisible). */
  | { ok: false; motif: 'reponse'; statut: number; detail: string }
  /** L'appel lui-meme a echoue (reseau, delai depasse). */
  | { ok: false; motif: 'appel'; detail: string };

/**
 * UN texte, depuis UN prompt. Essaie le modele rapide, retombe sur le second si le premier
 * rend un statut non-2xx, et s'arrete net sur une erreur de facturation.
 *
 * Ne journalise rien et ne leve jamais : l'appelant decide du message et du code HTTP.
 */
export async function genererTexteIA(args: {
  cleApi: string;
  prompt: string;
  maxTokens?: number;
  /** Appliquee a l'extraction du texte brut non-JSON (un recit depasse 200 caracteres). */
  longueurMaxBrute?: number;
  delaiMs?: number;
}): Promise<IssueTexteIA> {
  const corps = { max_tokens: args.maxTokens ?? 256, messages: [{ role: 'user', content: args.prompt }] };

  const essai = async (modele: string): Promise<
    { ok: true; brut: string | undefined } | { ok: false; statut: number; erreur: string }
  > => {
    const r = await appelerModeleTexte(args.cleApi, corps, modele, args.delaiMs);
    if (!r.ok) return { ok: false, statut: r.status, erreur: await r.text().catch(() => '') };
    const d = await r.json();
    const bloc = d?.content?.find((c: { type?: string }) => c.type === 'text');
    return { ok: true, brut: bloc?.text as string | undefined };
  };

  try {
    let issue = await essai(MODELE_TEXTE_PRIMAIRE);
    if (!issue.ok && estErreurFacturation(issue.erreur)) return { ok: false, motif: 'indisponible' };
    if (!issue.ok) {
      issue = await essai(MODELE_TEXTE_REPLI);
      if (!issue.ok && estErreurFacturation(issue.erreur)) return { ok: false, motif: 'indisponible' };
    }
    if (!issue.ok) return { ok: false, motif: 'reponse', statut: issue.statut, detail: `statut ${issue.statut}` };
    if (!issue.brut) return { ok: false, motif: 'reponse', statut: 0, detail: 'reponse vide' };
    const texte = extraireTexte(issue.brut, args.longueurMaxBrute);
    if (texte === null) return { ok: false, motif: 'reponse', statut: 0, detail: 'reponse illisible' };
    return { ok: true, texte };
  } catch (e) {
    return { ok: false, motif: 'appel', detail: (e as Error).message || 'appel impossible' };
  }
}
