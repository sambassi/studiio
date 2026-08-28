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
  composer: () => Promise<Blob>;
  /** Signale l'avancement, si l'ecran veut l'afficher. */
  etape?: (texte: string) => void;
}): Promise<Livraison> {
  const { operation, format, composer, etape } = params;

  etape?.('Ouverture du rendu…');
  const tentative = await ouvrir(operation, format);
  if (!tentative) return { ok: false, motif: 'socle_absent' };

  let blob: Blob;
  try {
    etape?.('Composition du montage…');
    blob = await composer();
  } catch (e) {
    await abandonner(tentative.jobId, e instanceof Error ? e.message : 'composition');
    return { ok: false, motif: 'composition', jobId: tentative.jobId };
  }

  if (!blob || blob.size === 0) {
    await abandonner(tentative.jobId, 'montage vide');
    return { ok: false, motif: 'composition', jobId: tentative.jobId };
  }

  try {
    etape?.('Envoi du montage…');
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
  } catch (e) {
    await abandonner(tentative.jobId, e instanceof Error ? e.message : 'televersement');
    return { ok: false, motif: 'televersement', jobId: tentative.jobId };
  }

  etape?.('Vérification…');
  const res = await fetch(`/api/render/jobs/${tentative.jobId}/confirm`, { method: 'POST' });
  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.ok) {
    // Le serveur a deja clos la tentative s'il fallait. On ne livre pas.
    return { ok: false, motif: json?.motif || 'confirmation', jobId: tentative.jobId };
  }

  return { ok: true, blob, url: tentative.publicUrl, jobId: tentative.jobId };
}
