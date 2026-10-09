/**
 * Côté navigateur : le profil vocal du compte et ses prononciations — par
 * les routes EXISTANTES, jamais un second dictionnaire.
 *
 *   lecture   GET /api/voice/profil
 *   écriture  PUT /api/voice/profil/prononciations (la liste complète, validée)
 *   écoute    POST /api/voice/ecoute (la voix du compte, texte PARLÉ appliqué
 *             par le serveur ; aucun crédit)
 *
 * Une prononciation ajoutée ici sert ensuite PARTOUT : Mon avatar, Créer,
 * Autopilote, écoute, génération du jumeau — ils lisent tous ce dictionnaire.
 */
import { ajouterPrononciation, MESSAGES_PRONONCIATION, type Prononciation } from '@/lib/voice/prononciations';

/** Diffusé après chaque écriture : les écrans ouverts relisent le profil. */
export const EVENEMENT_PRONONCIATIONS = 'studiio:prononciations';

export interface ProfilVoixClient {
  prononciations: Prononciation[];
  ecouteDisponible: boolean;
  nomVoix: string | null;
}

export async function lireProfilVoixClient(f: typeof fetch = fetch): Promise<ProfilVoixClient | null> {
  try {
    const json = await f('/api/voice/profil').then((r) => r.json());
    if (!json?.success || !json.data) return null;
    const d = json.data as { prononciations?: unknown; ecouteDisponible?: unknown; voixResolue?: { nom?: unknown } | null };
    return {
      prononciations: Array.isArray(d.prononciations) ? (d.prononciations as Prononciation[]) : [],
      ecouteDisponible: d.ecouteDisponible === true,
      nomVoix: typeof d.voixResolue?.nom === 'string' ? d.voixResolue.nom : null,
    };
  } catch {
    return null;
  }
}

/**
 * Ajoute UNE prononciation au dictionnaire du compte : relit la liste, la
 * complète par la règle commune (`ajouterPrononciation` : doublons, longueur,
 * identique…), puis l'enregistre en entier. Refus nommé, jamais silencieux.
 */
export async function ajouterPrononciationAuCompte(
  entree: { affiche: string; prononce: string },
  f: typeof fetch = fetch,
): Promise<{ ok: true; prononciations: Prononciation[] } | { ok: false; message: string }> {
  const profil = await lireProfilVoixClient(f);
  if (!profil) return { ok: false, message: 'Vos prononciations n’ont pas pu être lues. Réessayez.' };
  const r = ajouterPrononciation(profil.prononciations, entree);
  if (!r.ok) return { ok: false, message: r.motif === 'introuvable' ? 'Prononciation introuvable.' : MESSAGES_PRONONCIATION[r.motif] };
  try {
    const res = await f('/api/voice/profil/prononciations', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prononciations: r.liste }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) return { ok: false, message: json?.error || 'La prononciation n’a pas pu être enregistrée.' };
    const liste = Array.isArray(json.data?.prononciations) ? (json.data.prononciations as Prononciation[]) : r.liste;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENEMENT_PRONONCIATIONS));
    return { ok: true, prononciations: liste };
  } catch {
    return { ok: false, message: 'La prononciation n’a pas pu être enregistrée.' };
  }
}

/** Écoute un texte avec la voix du compte. Rend l'URL locale de l'audio, ou le motif. */
export async function ecouterAvecMaVoix(
  texte: string,
  f: typeof fetch = fetch,
): Promise<{ ok: true; url: string; spoken: string | null } | { ok: false; message: string }> {
  try {
    const res = await f('/api/voice/ecoute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texte }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, message: json?.error || 'L’écoute a échoué.' };
    }
    const blob = await res.blob();
    const dit = res.headers.get('X-Studiio-Spoken');
    return { ok: true, url: URL.createObjectURL(blob), spoken: dit ? decodeURIComponent(dit) : null };
  } catch {
    return { ok: false, message: 'L’écoute a échoué.' };
  }
}
