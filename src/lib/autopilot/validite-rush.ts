/**
 * ─────────────────────────────────────────────────────────────────────────
 * VALIDITÉ D'UN RUSH — LA SEULE VÉRITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * SOURCE DISPONIBLE = média réellement lisible et utilisable pour le montage.
 *
 * Un rush encore ÉCRIT dans la banque (`rush_urls`, `designStyle.sources`)
 * n'est pas pour autant une source : il peut avoir été supprimé (rétention
 * 24 h, ménage), sa signature peut avoir expiré, le stockage peut le refuser,
 * ou la garde de sécurité (#546, `mediaLisiblePar`) peut l'interdire à ce
 * compte. Ces quatre cas comptent pour ZÉRO partout : compteurs de l'écran,
 * « Médias prévus », plan suggéré, rendu.
 *
 * Module PUR (aucune E/S) : l'écran et le serveur lisent la même règle. La
 * sonde réseau vit dans `poster.ts` (`rushEncorePresent`, son `onEtat`) ;
 * `etatAccesRush` en tire un `EtatRush`.
 *
 *   - `utilisable`  : lisible — ou pas encore vérifié / doute réseau (500,
 *                     délai, coupure) : le doute profite au rush, comme avant ;
 *   - `introuvable` : 404 / 410 — supprimé du stockage (seul cas « mort »
 *                     qui autorise le cron à le retirer de la banque, inchangé) ;
 *   - `expire`      : 400 / 401 / 403 — signature expirée, accès refusé par le
 *                     stockage. Lâché pour le montage, JAMAIS retiré
 *                     automatiquement (un refus peut être passager) ;
 *   - `refuse`      : garde de sécurité (objet d'un autre compte, namespace
 *                     privé, cible SSRF). Jamais lu, jamais signé, jamais
 *                     « réparable », jamais retiré de la banque, et son
 *                     adresse n'est écrite nulle part côté utilisateur.
 */
export type EtatRush = 'utilisable' | 'introuvable' | 'expire' | 'refuse';

const ETATS: readonly EtatRush[] = ['utilisable', 'introuvable', 'expire', 'refuse'];

/** L'état d'un statut HTTP de sonde (HEAD). Pur. */
export function etatDepuisStatut(status: number): EtatRush {
  if (status === 404 || status === 410) return 'introuvable';
  if (status === 400 || status === 401 || status === 403) return 'expire';
  // 2xx, 3xx, 405 (HEAD refusé), 5xx : aucune preuve contre le rush.
  return 'utilisable';
}

/**
 * Ce rush compte-t-il comme source ? `undefined` = pas encore vérifié : il
 * compte (le doute profite au rush, l'écran d'avant reste identique).
 */
export function rushUtilisable(etat: EtatRush | undefined): boolean {
  return etat === undefined || etat === 'utilisable';
}

/** Le rush peut-il être « réimporté » ? Jamais un refus de sécurité. */
export function rushReparable(etat: EtatRush | undefined): boolean {
  return etat === 'introuvable' || etat === 'expire';
}

/** Les rushes de `urls` qui comptent comme sources, ordre conservé. Pur. */
export function rushesUtilisables(urls: readonly string[], etats: Readonly<Record<string, EtatRush | undefined>>): string[] {
  return urls.filter((u) => rushUtilisable(etats[u]));
}

/**
 * Les états lus dans la réponse de `POST /api/autopilot/rush/verifier`.
 * `etats` (nouveau) fait foi ; à défaut, `resultats` (booléens d'avant) :
 * `true` → utilisable, `false` → introuvable. Toute valeur inconnue est
 * ignorée (= non vérifié). Pur.
 */
export function etatsDepuisReponseVerifier(data: unknown): Record<string, EtatRush> {
  const out: Record<string, EtatRush> = {};
  if (!data || typeof data !== 'object') return out;
  const { resultats, etats } = data as { resultats?: unknown; etats?: unknown };
  if (resultats && typeof resultats === 'object') {
    for (const [u, v] of Object.entries(resultats as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[u] = v ? 'utilisable' : 'introuvable';
    }
  }
  if (etats && typeof etats === 'object') {
    for (const [u, v] of Object.entries(etats as Record<string, unknown>)) {
      if (typeof v === 'string' && (ETATS as readonly string[]).includes(v)) out[u] = v as EtatRush;
    }
  }
  return out;
}

/** La sonde réseau (`rushEncorePresent`, `poster.ts`) — injectée : ce module reste pur. */
export type SondeRush = (
  url: string, timeoutMs?: number, reseau?: undefined, onEtat?: (etat: EtatRush) => void,
) => Promise<boolean>;

/**
 * L'état d'accès d'un rush, en UNE sonde. Sans état détaillé (sonde doublée
 * par un test, par exemple), le booléen fait foi : `false` = introuvable,
 * `true` = utilisable. N'appeler qu'APRÈS la garde de propriété
 * (`mediaLisiblePar`) : un rush hors du compte n'est jamais sondé.
 */
export async function etatAccesRush(url: string, sonde: SondeRush): Promise<EtatRush> {
  let detail = null as EtatRush | null;
  const present = await sonde(url, undefined, undefined, (e) => { detail = e; });
  return detail ?? (present ? 'utilisable' : 'introuvable');
}
