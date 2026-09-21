/**
 * Erreur Replicate assainie — la SEULE forme qu'on a le droit de logger.
 *
 * Le SDK Replicate leve des `ApiError` qui portent `request` (une `Request`
 * undici) et `response`. `console.error(error)` les inspecte en entier, et
 * l'inspection d'une `Request` undici imprime ses en-tetes — dont
 * `Authorization: Bearer r8_…`, c'est-a-dire le jeton du compte. Le message
 * lui-meme peut aussi citer l'URL ou des en-tetes.
 *
 * Ici on ne garde que `message`, `status` et `code`, et on caviarde dans le
 * message tout ce qui ressemble a un secret. Jamais `request`, `headers`,
 * `response` ni le corps.
 */

export type ErreurReplicateSanitisee = {
  provider: 'replicate';
  status?: number;
  code?: string;
  message: string;
};

const LONGUEUR_MAX = 300;

/** Motifs de secrets a caviarder, dans l'ordre d'application. */
const MOTIFS_SECRETS: Array<[RegExp, string]> = [
  // `Authorization: Bearer xxx`, `authorization=xxx`, `Authorization xxx`
  [/authorization\s*[:=]?\s*(bearer\s+)?[^\s,;'"]+/gi, 'Authorization: [caviarde]'],
  // `Bearer xxx` seul
  [/\bbearer\s+[^\s,;'"]+/gi, 'Bearer [caviarde]'],
  // Jetons Replicate : `r8_` suivi d'alphanumeriques
  [/\br8_[A-Za-z0-9_-]+/g, 'r8_[caviarde]'],
  // Jetons passes en parametre d'URL
  [/([?&](?:token|api_key|apikey|key|auth)=)[^&\s'"]+/gi, '$1[caviarde]'],
];

function caviarder(texte: string): string {
  let r = texte;
  for (const [motif, remplacement] of MOTIFS_SECRETS) r = r.replace(motif, remplacement);
  return r;
}

function lireNombre(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function lireChaine(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function erreurReplicateSanitisee(err: unknown): ErreurReplicateSanitisee {
  let message = 'Erreur inconnue';
  let status: number | undefined;
  let code: string | undefined;

  if (err instanceof Error) {
    message = err.message || err.name || message;
  } else if (typeof err === 'string') {
    message = err;
  }

  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    // `ApiError.response.status` (SDK) ou `status` / `statusCode` directs.
    const rep = o.response;
    status =
      lireNombre(o.status) ??
      lireNombre(o.statusCode) ??
      (rep && typeof rep === 'object' ? lireNombre((rep as Record<string, unknown>).status) : undefined);
    code = lireChaine(o.code) ?? lireChaine(o.name);
    if (code === 'Error') code = undefined;
  }

  message = caviarder(message).replace(/\s+/g, ' ').trim();
  if (message.length > LONGUEUR_MAX) message = `${message.slice(0, LONGUEUR_MAX - 1)}…`;
  if (!message) message = 'Erreur inconnue';

  const out: ErreurReplicateSanitisee = { provider: 'replicate', message };
  if (status !== undefined) out.status = status;
  if (code !== undefined) out.code = caviarder(code).slice(0, 80);
  return out;
}
