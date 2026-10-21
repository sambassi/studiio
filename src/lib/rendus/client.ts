/**
 * Le parcours facture, cote navigateur — un seul chemin pour les quatre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ORDRE COMPTE, ET IL EST LE MEME PARTOUT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. le serveur ouvre une tentative et attribue une cle de stockage ;
 *   2. le navigateur compose ;
 *   3. il televerse VERS CETTE CLE, et nulle part ailleurs ;
 *   4. le serveur va regarder l'objet et debite s'il l'y trouve ;
 *   5. le montage n'est delivre qu'apres cette confirmation.
 *
 * Ecrire ce parcours quatre fois aurait produit quatre variantes, dont trois
 * finiraient par livrer avant de confirmer. Il est donc ici, une fois.
 *
 * Aucun montant, aucun identifiant d'utilisateur, aucune reference ne part
 * d'ici : le corps de la reservation ne porte que l'operation et le format.
 */

import {
  envoyerMontageDecoupe, abandonnerEnvoiDecoupe, SEUIL_DECOUPE, type EtatEnvoiDecoupe,
} from '@/lib/rendus/envoi-montage';

export type OperationRendu =
  | 'apercu' | 'bureau' | 'calendrier' | 'avance-brouillon' | 'avance-bureau';

export interface Tentative {
  jobId: string;
  /**
   * Ou envoyer le montage. TOUJOURS en HTTPS, ou relative a l'origine de la
   * page -- jamais une adresse interne : le serveur applique une garde de
   * sortie avant de la rendre.
   */
  uploadUrl: string;
  /** `direct` = presigne sur le nom public, `relais` = route de l'app. */
  uploadMode?: 'direct' | 'relais';
  publicUrl: string;
  cout: number;
}

export interface Livraison {
  ok: boolean;
  blob?: Blob;
  /** URL publique du montage televerse — celle de la cle attribuee. */
  url?: string;
  jobId?: string;
  /** Ce qui a empeche la livraison, en clair. */
  motif?: string;
  /** Ce que le compositeur a rendu a cote du montage (vignette…). */
  annexe?: unknown;
  /**
   * L'envoi a echoue mais le montage est garde en memoire : un nouvel appel
   * avec la meme `cleReprise` reprend l'ENVOI SEUL, sans recomposer.
   */
  reprenable?: boolean;
}

/**
 * Un montage compose dont l'envoi a echoue — gardé tant que la page vit.
 *
 * Une seule place : un nouvel envoi d'un AUTRE contenu l'abandonne. La
 * tentative reste `reserved` (aucun debit possible sans confirmation) ;
 * `null` quand elle a ete close entre-temps : la reprise en ouvre une neuve,
 * toujours sans recomposer.
 */
interface EnvoiEnAttente {
  cle: string;
  operation: OperationRendu;
  format: 'reel' | 'tv';
  tentative: Tentative | null;
  blob: Blob;
  annexe?: unknown;
  decoupe: EtatEnvoiDecoupe;
}
let enAttente: EnvoiEnAttente | null = null;

/** Un montage attend-il un nouvel essai d'envoi ? */
export function envoiEnAttente(): boolean {
  return enAttente !== null;
}

/** Libere le montage en attente : envoi decoupe abandonne, tentative close. */
export async function oublierEnvoiEnAttente(): Promise<void> {
  const e = enAttente;
  enAttente = null;
  if (!e?.tentative) return;
  await abandonnerEnvoiDecoupe(e.tentative.jobId, e.decoupe);
  await abandonner(e.tentative.jobId, 'envoi abandonne');
}

/**
 * Efface le montage en attente SANS appel reseau (tests, ou page qui
 * repart de zero). La tentative laissee `reserved` ne debite rien.
 */
export function reinitialiserEnvoiEnAttente(): void {
  enAttente = null;
}

/** L'echec dit-il que la tentative n'accepte plus d'envoi ? */
function tentativeFermee(e: unknown): boolean {
  const drapeau = (e as { tentativeClose?: boolean })?.tentativeClose;
  if (typeof drapeau === 'boolean') return drapeau;
  return e instanceof Error && /non_reserve|\b409\b/.test(e.message);
}

/** Messages destines a l'utilisateur, pas au journal. */
export const MOTIFS: Record<string, string> = {
  socle_absent: 'Le rendu est momentanément indisponible sur ce serveur.',
  solde_insuffisant: 'Crédits insuffisants : le montage n’a pas été débité ni livré.',
  objet_absent: 'Le montage n’est pas arrivé jusqu’au stockage. Rien n’a été débité.',
  trop_petit: 'Le montage produit est vide ou incomplet. Rien n’a été débité.',
  type_refuse: 'Le fichier produit n’est pas une vidéo exploitable. Rien n’a été débité.',
  stockage_injoignable: 'Le stockage est injoignable. Réessayez : rien n’a été débité.',
  composition: 'La composition du montage a échoué. Rien n’a été débité.',
  televersement: 'L’envoi du montage a échoué. Rien n’a été débité.',
};

export function messagePour(motif?: string): string {
  return (motif && MOTIFS[motif]) || 'Le rendu a échoué. Rien n’a été débité.';
}

async function ouvrir(operation: OperationRendu, format: 'reel' | 'tv'): Promise<Tentative | null> {
  const res = await fetch('/api/render/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, format }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) return null;
  return {
    jobId: json.jobId, uploadUrl: json.uploadUrl, uploadMode: json.uploadMode,
    publicUrl: json.publicUrl, cout: json.cout,
  };
}

/**
 * La cible d'envoi, demandee APRES la composition (PR-C).
 *
 * Le serveur ne remet plus d'URL presignee a la reservation : elle aurait du
 * survivre a toute la composition. Il la remet ici, courte, vers le depot.
 * Tout echec -- serveur plus ancien sans cette route, reseau, tentative close
 * -- retombe sur la cible de la reservation : le relais, qui marche toujours.
 */
async function cibleApresComposition(tentative: Tentative): Promise<string> {
  try {
    // `POST` sur la route d'envoi = « ou envoyer ? » ; `PUT` = le relais.
    const res = await fetch(`/api/render/jobs/${tentative.jobId}/upload`, {
      method: 'POST',
      credentials: 'include',
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok && typeof json.uploadUrl === 'string' && json.uploadUrl) {
      return json.uploadUrl;
    }
  } catch { /* repli ci-dessous */ }
  return tentative.uploadUrl;
}

async function abandonner(jobId: string, motif: string): Promise<void> {
  // Best-effort : une tentative laissee `reserved` ne debite rien de toute
  // facon. On la ferme quand meme, pour que l'etat dise la verite.
  await fetch(`/api/render/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motif }),
  }).catch(() => {});
}

/**
 * Compose, televerse, fait confirmer — puis seulement rend le montage.
 *
 * `composer` est fourni par l'appelant : c'est le seul morceau qui differe
 * entre les quatre parcours.
 */
export async function rendreEtFacturer(params: {
  operation: OperationRendu;
  format: 'reel' | 'tv';
  /** Le montage ; ou `{ video, annexe }` pour garder une vignette avec lui. */
  composer: () => Promise<Blob | { video: Blob; annexe?: unknown }>;
  /** Signale l'avancement, si l'ecran veut l'afficher. */
  etape?: (texte: string) => void;
  /**
   * Signature du CONTENU. Fournie, un echec d'envoi garde le montage en
   * memoire, et un nouvel appel avec la meme cle reprend l'envoi sans
   * recomposer. Absente : comportement historique (tentative close).
   */
  cleReprise?: string;
}): Promise<Livraison> {
  const { operation, format, composer, etape, cleReprise } = params;

  const reprise = cleReprise && enAttente && enAttente.cle === cleReprise
    && enAttente.operation === operation && enAttente.format === format
    ? enAttente : null;
  // Un autre contenu part : l'ancien montage en attente n'a plus d'avenir.
  if (enAttente && !reprise) await oublierEnvoiEnAttente();
  enAttente = null;

  let tentative: Tentative;
  let blob: Blob;
  let annexe: unknown;
  let decoupe: EtatEnvoiDecoupe = { faits: new Set() };

  if (reprise) {
    // ── REPRISE : le montage est deja compose, on ne le refait pas ──────
    blob = reprise.blob;
    annexe = reprise.annexe;
    if (reprise.tentative) {
      tentative = reprise.tentative;
      decoupe = reprise.decoupe;
    } else {
      etape?.('Ouverture du rendu…');
      const neuve = await ouvrir(operation, format);
      if (!neuve) {
        enAttente = reprise;
        return { ok: false, motif: 'socle_absent', reprenable: true };
      }
      tentative = neuve;
    }
  } else {
    etape?.('Ouverture du rendu…');
    const ouverte = await ouvrir(operation, format);
    if (!ouverte) return { ok: false, motif: 'socle_absent' };
    tentative = ouverte;

    try {
      etape?.('Composition du montage…');
      const rendu = await composer();
      if (rendu instanceof Blob) blob = rendu;
      else { blob = rendu.video; annexe = rendu.annexe; }
    } catch (e) {
      await abandonner(tentative.jobId, e instanceof Error ? e.message : 'composition');
      return { ok: false, motif: 'composition', jobId: tentative.jobId };
    }

    if (!blob || blob.size === 0) {
      await abandonner(tentative.jobId, 'montage vide');
      return { ok: false, motif: 'composition', jobId: tentative.jobId };
    }
  }

  const envoyer = async () => {
    let envoye = false;
    etape?.(reprise ? 'Reprise de l’envoi…' : 'Envoi du montage…');
    // ── Gros montage : envoi DECOUPE, chaque morceau re-essayable ───────
    // Un PUT unique de plusieurs dizaines de Mo n'a aucun point de reprise :
    // c'est l'echec `ERR_TIMED_OUT` vu en production sur 62 Mo. Le serveur
    // repond `indisponible` sans endpoint public : on garde alors l'envoi
    // historique ci-dessous, inchange.
    if (blob.size > SEUIL_DECOUPE) {
      const r = await envoyerMontageDecoupe(tentative.jobId, blob, {
        onProgress: (p) => etape?.(`Envoi du montage… ${p} %`),
        etat: decoupe,
        conserverSiEchec: !!cleReprise,
      });
      envoye = r.ok;
    }
    if (!envoye) await envoyerEnUnBloc(tentative, blob);
  };
  try {
    try {
      await envoyer();
    } catch (e) {
      // Reprise sur une tentative close entre-temps (expiree, annulee
      // ailleurs) : on en ouvre UNE neuve et on renvoie le meme montage,
      // toujours sans recomposer. Une seule fois.
      if (!reprise || !tentativeFermee(e)) throw e;
      await abandonnerEnvoiDecoupe(tentative.jobId, decoupe);
      const neuve = await ouvrir(operation, format);
      if (!neuve) throw e;
      tentative = neuve;
      decoupe = { faits: new Set() };
      await envoyer();
    }
  } catch (e) {
    if (cleReprise) {
      // Rien n'est debite, rien n'est livre : le montage reste en memoire.
      const fermee = tentativeFermee(e);
      if (fermee) await abandonnerEnvoiDecoupe(tentative.jobId, decoupe);
      enAttente = {
        cle: cleReprise, operation, format, blob, annexe, decoupe,
        tentative: fermee ? null : tentative,
      };
      return { ok: false, motif: 'televersement', jobId: tentative.jobId, reprenable: true };
    }
    await abandonner(tentative.jobId, e instanceof Error ? e.message : 'televersement');
    return { ok: false, motif: 'televersement', jobId: tentative.jobId };
  }

  const livraison = await confirmerEtLivrer(tentative, blob, etape);
  return { ...livraison, annexe };
}

/** L'envoi historique : un seul PUT vers la cible remise apres composition. */
async function envoyerEnUnBloc(tentative: Tentative, blob: Blob): Promise<void> {
  tentative.uploadUrl = await cibleApresComposition(tentative);
  // Le relais de l'application est SAME-ORIGIN et authentifie par le
  // cookie de session : sans `credentials`, `fetch` ne l'envoie pas sur
  // une requete construite a la main, et la route repondrait 401. Une URL
  // presignee, elle, est absolue et ne doit recevoir aucun cookie.
  const relais = tentative.uploadUrl.startsWith('/');
  const put = await fetch(tentative.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'video/webm' },
    body: blob,
    ...(relais ? { credentials: 'include' as const } : {}),
  });
  if (!put.ok) throw new Error(`PUT ${put.status}`);
}

/** Fait confirmer par le serveur — qui seul debite — puis livre. */
async function confirmerEtLivrer(
  tentative: Tentative, blob: Blob, etape?: (texte: string) => void,
): Promise<Livraison> {
  etape?.('Vérification…');
  const res = await fetch(`/api/render/jobs/${tentative.jobId}/confirm`, { method: 'POST' });
  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.ok) {
    // On ne livre pas. Et on ferme la tentative si elle est restee ouverte.
    const motif: string = json?.motif || 'confirmation';
    if (tentativeEncoreOuverte(json)) await abandonner(tentative.jobId, motif);
    return { ok: false, motif, jobId: tentative.jobId };
  }

  return { ok: true, blob, url: tentative.publicUrl, jobId: tentative.jobId };
}

/**
 * Apres un refus de confirmation, la tentative est-elle restee `reserved` ?
 *
 * Le serveur ne clot PAS toutes les tentatives qu'il refuse :
 *
 *   - `solde_insuffisant` (402) : `confirmer_rendu` annule sa transition et
 *     rend `etat: 'reserved'`. Sans fermeture ici, la tentative resterait
 *     ouverte alors que le navigateur connait l'issue. On la ferme.
 *   - `objet_absent` / `trop_petit` / `type_refuse` (422) : la route l'a
 *     deja close en `failed`, et ne renvoie pas d'etat. Rien a faire ; un
 *     cancel ne recolterait qu'un 409.
 *   - `stockage_injoignable` (503) : panne de NOTRE cote, la route la laisse
 *     deliberement ouverte pour qu'une reprise reste possible. On ne la
 *     ferme pas, meme si un etat `reserved` etait renvoye.
 *   - `rendu_clos` : deja fermee.
 *
 * Aucun double debit n'est possible par ce chemin : `/cancel` passe par
 * `clore_rendu`, dont le `where etat = 'reserved'` ignore toute tentative
 * confirmee (migration 2026-08-28-rendus-preuve-serveur.sql). Une reponse
 * `ok: true` n'arrive jamais ici.
 *
 * Si l'appel de confirmation lui-meme leve (reseau coupe), l'exception
 * remonte a l'appelant sans fermeture : la confirmation a peut-etre abouti
 * cote serveur, et rien n'est livre de toute facon. Comportement inchange.
 */
function tentativeEncoreOuverte(json: { etat?: string; motif?: string } | null): boolean {
  if (!json) return false;
  if (json.motif === 'stockage_injoignable') return false;
  return json.etat === 'reserved' || json.motif === 'solde_insuffisant';
}
