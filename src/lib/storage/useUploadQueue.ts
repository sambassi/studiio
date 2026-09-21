'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { uploadFile, type UploadResult } from '@/lib/storage/uploadFile';

/**
 * File d'envoi de plusieurs fichiers — la logique, puis le hook.
 *
 * ⚠️ LA LOGIQUE EST SÉPARÉE DU HOOK, ET C'EST VOULU. `runUploadQueue` est
 * une fonction sans React : on peut lui donner un faux `upload` que le test
 * pilote à la main et VOIR que deux envois au plus tournent en même temps,
 * que l'ordre de sélection est respecté, qu'un échec n'emporte pas les
 * autres. Le hook n'est que l'état React posé autour.
 *
 * ── POURQUOI DEUX ENVOIS EN PARALLÈLE, PAS DIX, PAS UN ──────────────────
 *
 * Un seul : sept rushes de 200 Mo partent à la suite, et le septième attend
 * les six autres avant de commencer. Dix : ils se disputent le même bus
 * depuis une carte mémoire et finissent plus tard que deux à la suite
 * (c'est la raison du séquentiel dans `SessionsTournagePanel`). Deux est le
 * compromis : une connexion qui plafonne laisse l'autre avancer, sans rendre
 * la progression illisible.
 *
 * ── LES FICHIERS NE SONT JAMAIS LUS EN MÉMOIRE ──────────────────────────
 *
 * `uploadFile` diffuse le `File` (XHR PUT ou morceaux multipart) ; cette
 * file ne fait que le lui passer. Sept rushes de 300 Mo ne coûtent rien de
 * plus que des références.
 */

export type StatutEnvoi = 'attente' | 'envoi' | 'ok' | 'erreur';

export interface ElementEnvoi {
  id: string;
  file: File;
  nom: string;
  taille: number;
  /** 0 à 100. */
  pourcent: number;
  statut: StatutEnvoi;
  /** Le message de l'erreur levée par `upload` — tel quel, pour être lisible. */
  erreur?: string;
  resultat?: UploadResult;
}

export type FonctionEnvoi = (
  file: File,
  options: { onProgress: (percent: number) => void; signal?: AbortSignal },
) => Promise<UploadResult>;

export interface OptionsFile {
  upload: FonctionEnvoi;
  /** Envois simultanés. Défaut 2 — voir l'en-tête. */
  concurrency?: number;
  /** Reçoit une copie de la liste après chaque changement d'un élément. */
  onChange?: (elements: ElementEnvoi[]) => void;
  /** Le signal d'annulation d'un élément, s'il en a un. */
  signalPour?: (id: string) => AbortSignal | undefined;
}

export const CONCURRENCE_PAR_DEFAUT = 2;

/**
 * Envoie les éléments `attente` de la liste, au plus `concurrency` à la fois,
 * dans l'ordre de la liste. Les autres éléments (`ok`, `erreur`, `envoi`)
 * sont rendus tels quels : c'est ce qui permet de ne relancer QUE les
 * échecs sans toucher aux réussites.
 *
 * Résout TOUJOURS — un échec est porté par l'élément, pas par la promesse.
 * Rend la liste finale, dans l'ordre d'entrée.
 */
export async function runUploadQueue(
  items: readonly ElementEnvoi[],
  options: OptionsFile,
): Promise<ElementEnvoi[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? CONCURRENCE_PAR_DEFAUT));
  const liste: ElementEnvoi[] = items.map((e) => ({ ...e }));
  const emettre = () => options.onChange?.(liste.map((e) => ({ ...e })));
  const modifier = (index: number, patch: Partial<ElementEnvoi>) => {
    liste[index] = { ...liste[index], ...patch };
    emettre();
  };

  const aFaire = liste
    .map((e, i) => (e.statut === 'attente' ? i : -1))
    .filter((i) => i >= 0);
  let curseur = 0;

  const travailleur = async () => {
    while (curseur < aFaire.length) {
      const index = aFaire[curseur];
      curseur += 1;
      const element = liste[index];
      const signal = options.signalPour?.(element.id);
      // Annulé avant d'avoir commencé : on ne lance rien.
      if (signal?.aborted) {
        modifier(index, { statut: 'erreur', erreur: 'Annulé' });
        continue;
      }
      modifier(index, { statut: 'envoi', pourcent: 0, erreur: undefined });
      try {
        // eslint-disable-next-line no-await-in-loop
        const resultat = await options.upload(element.file, {
          onProgress: (p) => modifier(index, {
            pourcent: Math.max(0, Math.min(100, Math.round(Number(p) || 0))),
          }),
          signal,
        });
        modifier(index, { statut: 'ok', pourcent: 100, resultat });
      } catch (err) {
        // L'échec reste sur SON fichier : les autres continuent, et le
        // message est celui de l'erreur — un « Upload échoué » générique
        // enverrait chercher la panne au mauvais endroit.
        modifier(index, {
          statut: 'erreur',
          erreur: signal?.aborted ? 'Annulé' : (err instanceof Error && err.message ? err.message : 'Envoi interrompu.'),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, aFaire.length) }, travailleur));
  return liste;
}

/**
 * Avancement global, pondéré par la taille.
 *
 * Une moyenne simple ferait bondir la barre à 50 % quand une image de 200 Ko
 * finit avant un rush de 300 Mo. Pondérée par les octets, elle avance au
 * rythme de ce qui part réellement.
 */
export function progressionGlobale(elements: readonly ElementEnvoi[]): {
  pourcent: number; termines: number; total: number; echecs: number;
} {
  const total = elements.length;
  const termines = elements.filter((e) => e.statut === 'ok' || e.statut === 'erreur').length;
  const echecs = elements.filter((e) => e.statut === 'erreur').length;
  if (total === 0) return { pourcent: 0, termines, total, echecs };
  const octets = elements.reduce((s, e) => s + Math.max(0, e.taille), 0);
  const avancement = (e: ElementEnvoi) => (e.statut === 'ok' ? 100 : e.statut === 'envoi' ? e.pourcent : 0);
  const pourcent = octets > 0
    ? elements.reduce((s, e) => s + Math.max(0, e.taille) * avancement(e), 0) / octets
    : elements.reduce((s, e) => s + avancement(e), 0) / total;
  return { pourcent: Math.round(pourcent), termines, total, echecs };
}

// ── Tri des fichiers reçus ─────────────────────────────────────────────────

/**
 * Plafonds côté navigateur — LES MÊMES que `api/upload/media/route.ts`
 * (500 Mo vidéo, 10 Mo image, 50 Mo audio). Recopiés parce que la route ne
 * les exporte pas et qu'importer une route dans un composant client n'a pas
 * de sens. Un fichier au-dessus partirait pour être refusé à l'arrivée :
 * autant le dire avant l'envoi, et sans bloquer les autres.
 */
export const LIMITES_TAILLE_CLIENT = {
  video: 500 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
} as const;

export function tailleMaxPourType(mime: string): number {
  if (mime.startsWith('video/')) return LIMITES_TAILLE_CLIENT.video;
  if (mime.startsWith('audio/')) return LIMITES_TAILLE_CLIENT.audio;
  return LIMITES_TAILLE_CLIENT.image;
}

// Un fichier correspond-il à un `accept` de type `video/*`, `image/*` ou « tout » ?
export function correspondAccept(file: File, accept: string): boolean {
  const motif = accept.trim();
  if (!motif || motif === '*/*') return true;
  const prefixe = motif.endsWith('/*') ? motif.slice(0, -1) : motif;
  return file.type.startsWith(prefixe);
}

export interface FichierRefuse { file: File; raison: string }

/**
 * Sépare ce qui peut partir de ce qui ne le peut pas. Un fichier refusé n'a
 * pas d'entrée dans la file : il est signalé à part, et les autres partent.
 */
export function trierFichiersRecus(
  files: readonly File[],
  accept: string,
): { acceptes: File[]; refuses: FichierRefuse[] } {
  const acceptes: File[] = [];
  const refuses: FichierRefuse[] = [];
  for (const file of files) {
    if (!correspondAccept(file, accept)) {
      refuses.push({ file, raison: 'Type de fichier non accepté ici.' });
      continue;
    }
    const max = tailleMaxPourType(file.type);
    if (file.size > max) {
      refuses.push({ file, raison: `Trop volumineux (maximum ${Math.round(max / 1024 / 1024)} Mo).` });
      continue;
    }
    acceptes.push(file);
  }
  return { acceptes, refuses };
}

// ── Le hook ───────────────────────────────────────────────────────────────

let compteurIds = 0;
function nouvelId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  compteurIds += 1;
  return `envoi-${Date.now()}-${compteurIds}`;
}

export interface OptionsHook {
  /** Dossier logique — `library`, `rush`… Transmis à `uploadFile`. */
  purpose?: string;
  concurrency?: number;
  /** Remplace `uploadFile` — pour les tests. */
  upload?: FonctionEnvoi;
}

export function useUploadQueue(options: OptionsHook = {}) {
  const [elements, setElements] = useState<ElementEnvoi[]>([]);
  // Le miroir synchrone de l'état : un `ajouter` pendant un envoi doit voir
  // la liste réelle, pas celle du rendu d'avant.
  const elementsRef = useRef<ElementEnvoi[]>([]);
  const controleursRef = useRef<Map<string, AbortController>>(new Map());
  // Les lancements s'enchaînent : deux `runUploadQueue` simultanés se
  // marcheraient sur les instantanés.
  const chaineRef = useRef<Promise<unknown>>(Promise.resolve());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const poser = useCallback((fn: (prev: ElementEnvoi[]) => ElementEnvoi[]) => {
    elementsRef.current = fn(elementsRef.current);
    setElements(elementsRef.current);
  }, []);

  /** Envoie les éléments `attente` parmi `ids`, et rend leur état final. */
  const lancer = useCallback((ids: readonly string[]): Promise<ElementEnvoi[]> => {
    const cibles = new Set(ids);
    const promesse = chaineRef.current.then(async () => {
      const aEnvoyer = elementsRef.current.filter((e) => cibles.has(e.id));
      const { purpose, concurrency, upload } = optionsRef.current;
      const envoi: FonctionEnvoi = upload
        ?? ((file, o) => uploadFile(file, { purpose: purpose || 'library', ...o }));
      const finaux = await runUploadQueue(aEnvoyer, {
        upload: envoi,
        concurrency,
        signalPour: (id) => controleursRef.current.get(id)?.signal,
        onChange: (instantane) => {
          const parId = new Map(instantane.map((e) => [e.id, e]));
          poser((prev) => prev.map((e) => parId.get(e.id) ?? e));
        },
      });
      for (const e of finaux) controleursRef.current.delete(e.id);
      return finaux;
    });
    chaineRef.current = promesse.then(() => undefined, () => undefined);
    return promesse;
  }, [poser]);

  /** Ajoute des fichiers et les envoie. Résout avec leur état final. */
  const ajouter = useCallback((files: readonly File[]): Promise<ElementEnvoi[]> => {
    const nouveaux: ElementEnvoi[] = files.map((file) => {
      const id = nouvelId();
      controleursRef.current.set(id, new AbortController());
      return { id, file, nom: file.name, taille: file.size, pourcent: 0, statut: 'attente' };
    });
    if (nouveaux.length === 0) return Promise.resolve([]);
    poser((prev) => [...prev, ...nouveaux]);
    return lancer(nouveaux.map((e) => e.id));
  }, [lancer, poser]);

  /** Relance UNIQUEMENT les éléments en erreur ; les réussites restent. */
  const reessayer = useCallback((ids?: readonly string[]): Promise<ElementEnvoi[]> => {
    const cibles = elementsRef.current
      .filter((e) => e.statut === 'erreur' && (!ids || ids.includes(e.id)))
      .map((e) => e.id);
    if (cibles.length === 0) return Promise.resolve([]);
    for (const id of cibles) controleursRef.current.set(id, new AbortController());
    poser((prev) => prev.map((e) => (cibles.includes(e.id)
      ? { ...e, statut: 'attente', pourcent: 0, erreur: undefined }
      : e)));
    return lancer(cibles);
  }, [lancer, poser]);

  const reessayerEchecs = useCallback(() => reessayer(), [reessayer]);

  const annuler = useCallback((id: string) => {
    controleursRef.current.get(id)?.abort();
  }, []);

  const vider = useCallback(() => {
    for (const c of controleursRef.current.values()) c.abort();
    controleursRef.current.clear();
    poser(() => []);
  }, [poser]);

  const progression = useMemo(() => progressionGlobale(elements), [elements]);
  const enCours = elements.some((e) => e.statut === 'attente' || e.statut === 'envoi');

  return { elements, enCours, progression, ajouter, reessayer, reessayerEchecs, annuler, vider };
}
