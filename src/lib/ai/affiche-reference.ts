/**
 * AFFICHE GÉNÉRÉE À PARTIR D'UNE PHOTO DE RÉFÉRENCE — côté SERVEUR.
 *
 * Sert l'Autopilote : quand l'utilisateur choisit « Mes photos comme
 * référence », chaque montage génère une affiche à partir d'UNE de ses photos,
 * avec le modèle qui préserve le sujet (visage, vêtements, identité) —
 * `flux-kontext-pro` (le MÊME que l'action « Partir de ma photo » de Créer,
 * `MODELS['image-edit']` dans `/api/ai/image`).
 *
 * ⚠️ CE MODULE NE FAIT QUE GÉNÉRER + RAPATRIER. Il ne débite pas, ne choisit
 * pas la photo, ne décide pas du repli : c'est l'appelant (`produireUnMontage`)
 * qui pioche la référence, débite les crédits, et — en cas d'échec — garde la
 * photo de l'utilisateur en affiche statique (JAMAIS Pexels en silence).
 *
 * ⚠️ IL RAPATRIE SUR LE STOCKAGE STUDIIO. L'URL rendue par Replicate expire ;
 * une affiche de montage doit être durable. On télécharge, on VÉRIFIE que
 * c'est bien une image (pas une page d'erreur), puis on téléverse — sinon
 * l'affiche disparaîtrait de la vidéo au bout d'un moment.
 */

import Replicate from 'replicate';
import { detecterSignatureImage } from '@/lib/storage/image-signature';
import { uploadToStorage } from '@/lib/storage/upload';

/** = `MODELS['image-edit']` de `/api/ai/image` — flux-kontext-pro (image + texte → image). */
const MODELE_REFERENCE = 'black-forest-labs/flux-kontext-pro';
/**
 * Attente maximale d'une génération kontext, file d'attente Replicate
 * comprise (démarrage à froid, charge). Au-delà, la prédiction est ANNULÉE
 * (`signal`) et l'échec est rendu comme « délai dépassé », pas comme une
 * sortie vide.
 */
const DELAI_MS = 90_000;
/** Motif rendu quand le délai a annulé la prédiction. */
export const MOTIF_DELAI_DEPASSE = 'délai dépassé : la génération a pris trop de temps et a été annulée';
/** Au-delà, la sortie n'est pas une image raisonnable : on refuse. */
const MAX_OCTETS = 20 * 1024 * 1024;

export type ResultatAffiche =
  | { ok: true; url: string }
  | { ok: false; motif: string };

/** Extrait une URL http(s) d'une sortie Replicate (chaîne, FileOutput, tableau). */
function extraireUrl(o: unknown): string | null {
  if (typeof o === 'string') return /^https?:\/\//.test(o) ? o : null;
  if (Array.isArray(o)) return o.length ? extraireUrl(o[0]) : null;
  if (o && typeof o === 'object') {
    const obj = o as { url?: unknown; toString?: () => string };
    if (typeof obj.url === 'function') {
      try {
        const u = (obj.url as () => unknown)();
        if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
        if (u && typeof (u as { href?: unknown }).href === 'string') return (u as { href: string }).href;
      } catch { /* on tente le toString ci-dessous */ }
    }
    if (typeof obj.url === 'string' && /^https?:\/\//.test(obj.url)) return obj.url;
    if (typeof obj.toString === 'function') {
      const s = obj.toString();
      if (/^https?:\/\//.test(s)) return s;
    }
  }
  return null;
}

/** Télécharge une URL en bornant la taille (une page d'erreur ne rentre pas). */
async function telecharger(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`téléchargement ${res.status}`);
  const reader = res.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > MAX_OCTETS) { try { await reader.cancel(); } catch { /* déjà fermé */ } throw new Error('image trop volumineuse'); }
      morceaux.push(value);
    }
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const m of morceaux) { out.set(m, pos); pos += m.length; }
  return out;
}

export async function genererAfficheReference(input: {
  userId: string;
  jobId: string;
  /** La photo de l'utilisateur qui sert de référence (URL durable de son compte). */
  referenceUrl: string;
  /** Consigne : la scène/ambiance voulue pour l'affiche. */
  prompt: string;
  /** Format de la vidéo (« 9:16 », « 1:1 », « 16:9 »). */
  aspectRatio: string;
}, deps: { delaiMs?: number } = {}): Promise<ResultatAffiche> {
  const cle = process.env.REPLICATE_API_TOKEN?.trim();
  if (!cle) return { ok: false, motif: 'service IA non configuré (REPLICATE_API_TOKEN absent)' };

  const replicate = new Replicate({ auth: cle });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.delaiMs ?? DELAI_MS);
  let output: unknown;
  try {
    output = await replicate.run(MODELE_REFERENCE, {
      input: {
        input_image: input.referenceUrl,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        output_format: 'webp',
        safety_tolerance: 2,
      },
      // ⚠️ `wait: { mode: 'poll' }` — MÊME correctif que la « Racine A » de
      // `/api/ai/image` (#425). Par défaut le SDK 1.4.0 attend en `block`
      // (`Prefer: wait`, ~60 s) : passé ce délai, la prédiction revient
      // ENCORE `processing` avec `output = null`, `run()` la croit finie et
      // rend `null` → « sans image exploitable » sur un job pourtant vivant.
      // En `poll`, `run()` sonde jusqu'à un état terminal ; `DELAI_MS` borne
      // l'attente et annule la prédiction via `signal`.
      wait: { mode: 'poll' },
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: false, motif: MOTIF_DELAI_DEPASSE };
    return { ok: false, motif: e instanceof Error ? e.message.slice(0, 140) : 'génération refusée par le fournisseur' };
  } finally {
    clearTimeout(timer);
  }

  const urlBrute = extraireUrl(output);
  // Délai atteint : le SDK a annulé la prédiction (`canceled`) et rend
  // `output = null`. Ce n'est PAS une « sortie vide » du fournisseur. (Une
  // image arrivée juste avant l'annulation reste, elle, utilisée.)
  if (!urlBrute && ctrl.signal.aborted) return { ok: false, motif: MOTIF_DELAI_DEPASSE };
  if (!urlBrute) return { ok: false, motif: 'le fournisseur a répondu, mais sans image exploitable' };

  try {
    const octets = await telecharger(urlBrute);
    const signature = detecterSignatureImage(octets);
    if (!signature) return { ok: false, motif: 'le résultat n’est pas une image valide' };

    const { writeFile, unlink } = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const local = path.join(os.tmpdir(), `studiio-affiche-${input.jobId}.${signature.ext}`);
    await writeFile(local, octets);
    try {
      const durable = await uploadToStorage({
        filePath: local,
        bucket: 'media',
        storagePath: `${input.userId}/autopilote-affiche/${input.jobId}.${signature.ext}`,
        contentType: signature.mime,
      });
      return { ok: true, url: durable };
    } finally {
      try { await unlink(local); } catch { /* déjà supprimé */ }
    }
  } catch (e) {
    return { ok: false, motif: e instanceof Error ? e.message.slice(0, 140) : 'rapatriement de l’image impossible' };
  }
}
