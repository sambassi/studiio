'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Search, Trash2, Info } from 'lucide-react';
import { analyserCouvertureRushes, plansAutopilote, type ManqueCouverture } from '@/lib/stock/couverture';
import { importerStockClient, rechercherStockClient } from '@/lib/stock/client';
import { orientationDuFormat, type FormatStock, type MediaStock } from '@/lib/stock/types';

/**
 * Compléter les rushes de l'Autopilote avec des vidéos STOCK — étape CLIENT,
 * validée par l'utilisateur.
 *
 * ⚠️ RIEN N'ENTRE DANS LA BANQUE SANS « CONSERVER ». Les propositions ne sont
 * que des vignettes ; seul le clic importe la vidéo dans la Médiathèque
 * (`/api/stock/importer`) et l'ajoute à la banque par le chemin EXISTANT du
 * panneau (`ajouterRushes`) — même enregistrement, même vérification. Le
 * moteur serveur (cron, smart montage) n'en sait rien : un rush stock
 * accepté est un rush comme un autre.
 *
 * ⚠️ VIDÉOS PEXELS UNIQUEMENT. Un rush est une vidéo ; Unsplash ne sert que
 * des photos et ses règles interdisent l'usage automatisé.
 *
 * ⚠️ JAMAIS BLOQUANT. Fournisseur en panne, quota, aucun résultat : un message
 * discret, et l'Autopilote continue avec les rushes de l'utilisateur.
 */

/** Ce que l'on garde d'un média stock accepté — affiché dans la banque. */
export interface MetaRushStock {
  provider: 'pexels';
  providerAssetId: string;
  auteur: string;
  sourceUrl: string;
  licence: string;
}

/** Le fichier qu'écrit `/api/stock/importer` : `stock-pexels-video-<id>.mp4`. */
const NOM_RUSH_STOCK = /\/stock-pexels-video-([A-Za-z0-9_-]+)\.mp4(?:[?#].*)?$/;

/** Ce rush vient-il d'un import stock (reconnu à son nom de fichier) ? */
export function idStockDuRush(url: string): string | null {
  return NOM_RUSH_STOCK.exec(url)?.[1] ?? null;
}

export const MESSAGE_STOCK_INDISPONIBLE = 'Recherche stock indisponible pour le moment — l’Autopilote continue avec vos rushes.';

type EtatSlot = 'recherche' | 'propose' | 'vide' | 'import' | 'conserve' | 'supprime';

interface Slot {
  manque: ManqueCouverture;
  media: MediaStock | null;
  etat: EtatSlot;
  /** Médias déjà montrés pour ce plan — « Remplacer » ne les repropose pas. */
  vus: string[];
  /** Requêtes de ce plan : celles du moteur, ou la saisie libre. */
  requetes: string[];
  erreur?: string | null;
}

function dureeLisible(s?: number): string {
  if (!s || !Number.isFinite(s)) return '';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Nom lisible d'un plan du smart montage (jamais « plan-2 »). */
function libellePlan(role: string): string {
  return role === 'HOOK' ? 'Plan d’accroche' : role === 'BUILD' ? 'Plan de développement' : role === 'PEAK' ? 'Plan temps fort' : role === 'FOCUS' ? 'Plan focus' : 'Plan final';
}

export default function CompleterRushesStock({
  sujet, message, objectif, rushUrls, format = '9:16', accent, onConserver,
}: {
  sujet: string;
  message?: string | null;
  objectif?: string | null;
  /** La banque telle qu'enregistrée — les rushes de l'utilisateur en tête. */
  rushUrls: string[];
  format?: FormatStock;
  accent: string;
  /** Le chemin d'ajout EXISTANT du panneau (`ajouterRushes`). */
  onConserver: (url: string, meta: MetaRushStock) => void;
}) {
  // Les imports de CETTE session ne recalculent pas les plans : sinon chaque
  // « Conserver » relancerait la recherche et ferait disparaître la carte
  // qu'on vient de valider. Après rechargement, ils comptent comme « stock ».
  /** Identifiants Pexels acceptés — comparés au nom du fichier, que l'URL soit relative ou absolue. */
  const [acceptes, setAcceptes] = useState<string[]>([]);
  const entreeRushes = useMemo(
    () => rushUrls.filter((u) => { const id = idStockDuRush(u); return !id || !acceptes.includes(id); }),
    [rushUrls, acceptes],
  );
  const cleRushes = entreeRushes.join('\n');

  const couverture = useMemo(() => analyserCouvertureRushes({
    plans: plansAutopilote(sujet, message),
    rushes: entreeRushes.map((url) => ({ url, origine: idStockDuRush(url) ? 'stock' as const : 'utilisateur' as const })),
    sujet,
    objectif,
    format,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sujet, message, objectif, format, cleRushes]);

  const [slots, setSlots] = useState<Slot[]>([]);
  const [indisponible, setIndisponible] = useState(false);
  const [libre, setLibre] = useState<Record<string, string>>({});
  /** Résultats par requête — une requête n'est envoyée qu'une fois. */
  const cache = useRef(new Map<string, Promise<{ medias: MediaStock[]; echec: boolean }>>());
  const generation = useRef(0);

  const orientation = orientationDuFormat(format);
  const chercher = useCallback((requete: string) => {
    const deja = cache.current.get(requete);
    if (deja) return deja;
    const p = rechercherStockClient({ requete, type: 'video', format, fournisseurs: ['pexels'] })
      .then((r) => {
        // Le bon format d'abord (vertical pour un 9:16) — tri stable : l'ordre
        // du moteur est gardé à orientation égale.
        const medias = r.medias
          .filter((m) => m.type === 'video' && m.provider === 'pexels')
          .map((m, i) => ({ m, i }))
          .sort((a, b) => Number(b.m.orientation === orientation) - Number(a.m.orientation === orientation) || a.i - b.i)
          .map((x) => x.m);
        return { medias, echec: r.echecs.length > 0 };
      });
    cache.current.set(requete, p);
    return p;
  }, [format, orientation]);

  /** Le premier média des requêtes, dans l'ordre, qui n'est pas exclu. */
  const premierLibre = useCallback(async (requetes: string[], exclus: Set<string>) => {
    let echec = false;
    for (const requete of requetes) {
      const r = await chercher(requete);
      echec = echec || r.echec;
      const media = r.medias.find((m) => !exclus.has(m.id) && !exclus.has(m.providerAssetId));
      if (media) return { media, echec };
    }
    return { media: null, echec };
  }, [chercher]);

  /** Médias déjà présents : dans la banque (par nom de fichier) ou sur une autre carte. */
  const exclusDe = useCallback((courants: Slot[], sauf?: string) => {
    const s = new Set<string>();
    for (const u of rushUrls) { const id = idStockDuRush(u); if (id) s.add(id); }
    for (const x of courants) {
      if (x.manque.sequence === sauf) continue;
      if (x.media && x.etat !== 'supprime') s.add(x.media.id);
    }
    return s;
  }, [rushUrls]);

  // ── Une proposition par manque, jamais deux fois le même média ──────────
  const cleManques = couverture.manques.map((m) => `${m.sequence}:${m.searchQueries.join('|')}`).join(';');
  useEffect(() => {
    const g = ++generation.current;
    setIndisponible(false);
    if (couverture.couvertureSuffisante) { setSlots([]); return; }
    const initiaux: Slot[] = couverture.manques.map((manque) => ({
      manque, media: null, etat: 'recherche', vus: [], requetes: manque.searchQueries,
    }));
    setSlots(initiaux);
    (async () => {
      const pris = exclusDe([]);
      const finaux: Slot[] = [];
      let echecs = 0;
      for (const s of initiaux) {
        const r = await premierLibre(s.requetes, pris);
        if (g !== generation.current) return;
        if (r.echec) echecs += 1;
        if (r.media) pris.add(r.media.id);
        finaux.push({ ...s, media: r.media, etat: r.media ? 'propose' : 'vide', vus: r.media ? [r.media.id] : [] });
        setSlots([...finaux, ...initiaux.slice(finaux.length)]);
      }
      if (echecs > 0 || finaux.every((s) => !s.media)) setIndisponible(true);
    })();
    return () => { generation.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleManques, couverture.couvertureSuffisante]);

  const majSlot = useCallback((sequence: string, f: (s: Slot) => Slot) => {
    setSlots((t) => t.map((s) => (s.manque.sequence === sequence ? f(s) : s)));
  }, []);

  const remplacer = useCallback(async (slot: Slot, requetes?: string[]) => {
    const q = requetes ?? slot.requetes;
    majSlot(slot.manque.sequence, (s) => ({ ...s, etat: 'recherche', requetes: q, erreur: null }));
    const exclus = exclusDe(slots, slot.manque.sequence);
    // Une nouvelle saisie repart de zéro ; « Remplacer » saute ce qui a été vu.
    if (!requetes) for (const v of slot.vus) exclus.add(v);
    const r = await premierLibre(q, exclus);
    majSlot(slot.manque.sequence, (s) => ({
      ...s,
      media: r.media,
      etat: r.media ? 'propose' : 'vide',
      vus: r.media ? [...(requetes ? [] : s.vus), r.media.id] : s.vus,
      erreur: r.media ? null : r.echec ? MESSAGE_STOCK_INDISPONIBLE : 'Aucune autre proposition pour ce plan.',
    }));
  }, [slots, exclusDe, premierLibre, majSlot]);

  const conserver = useCallback(async (slot: Slot) => {
    const m = slot.media;
    if (!m) return;
    majSlot(slot.manque.sequence, (s) => ({ ...s, etat: 'import', erreur: null }));
    const r = await importerStockClient({ provider: 'pexels', type: 'video', providerAssetId: m.providerAssetId });
    if ('erreur' in r || !r.url) {
      majSlot(slot.manque.sequence, (s) => ({ ...s, etat: 'propose', erreur: 'Import impossible pour le moment — réessayez ou gardez vos rushes.' }));
      return;
    }
    setAcceptes((a) => [...a, m.providerAssetId]);
    majSlot(slot.manque.sequence, (s) => ({ ...s, etat: 'conserve' }));
    onConserver(r.url, {
      provider: 'pexels',
      providerAssetId: m.providerAssetId,
      auteur: r.media?.auteur ?? m.auteur,
      sourceUrl: r.media?.sourceUrl ?? m.sourceUrl,
      licence: r.media?.licence ?? m.licence,
    });
  }, [majSlot, onConserver]);

  if (couverture.couvertureSuffisante) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-emerald-400" data-autopilot-stock-suffisant>
        <Check className="w-3 h-3 mt-0.5 shrink-0" />
        Vos rushes suffisent : aucun média stock nécessaire.
      </p>
    );
  }

  // « Proposés » = encore en attente de votre choix ; un média conservé est déjà dans la banque.
  const proposes = slots.filter((s) => s.media && s.etat !== 'supprime' && s.etat !== 'conserve').length;

  return (
    <div className="space-y-2" data-autopilot-stock>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-300">
        <span data-autopilot-stock-personnels>Rushes personnels : {couverture.rushesPersonnels}</span>
        <span data-autopilot-stock-proposes>Médias stock proposés : {proposes}</span>
      </div>
      <p className="text-[11px] text-gray-500">
        Rien n’est ajouté sans votre accord : conservez une proposition pour l’ajouter à la banque,
        après vos propres rushes.
      </p>
      {indisponible && (
        <p className="flex items-start gap-1.5 text-[11px] text-gray-400" data-autopilot-stock-indisponible>
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          {MESSAGE_STOCK_INDISPONIBLE}
        </p>
      )}
      <ul className="space-y-2">
        {slots.map((s) => {
          const cle = s.manque.sequence;
          if (s.etat === 'supprime') {
            return (
              <li key={cle} className="text-[11px] text-gray-500" data-autopilot-stock-slot={cle} data-etat="supprime">
                {libellePlan(s.manque.role)} : proposition retirée — ce plan reprendra vos rushes.
              </li>
            );
          }
          return (
            <li key={cle} className="rounded-lg border border-gray-800 bg-gray-900 p-2 space-y-1.5" data-autopilot-stock-slot={cle} data-etat={s.etat}>
              <p className="text-[11px] text-gray-400">
                <span className="font-medium text-gray-300">{libellePlan(s.manque.role)}</span> — {s.manque.raison}
                <span className="block text-[10px] text-gray-500">Recherche : {s.manque.searchQueries[0] ?? s.manque.theme}</span>
              </p>
              {s.etat === 'recherche' && (
                <p className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <Loader2 className="w-3 h-3 animate-spin" /> Recherche en cours…
                </p>
              )}
              {s.etat !== 'recherche' && !s.media && (
                <p className="text-[11px] text-gray-500" data-autopilot-stock-vide>
                  {s.erreur ?? 'Aucune proposition pour ce plan.'}
                </p>
              )}
              {s.media && s.etat !== 'recherche' && (
                <div className="flex gap-2">
                  {/* Vignette seulement : le fichier HD n'est téléchargé qu'à « Conserver ». */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.media.vignetteUrl}
                    alt={s.media.description || 'Vidéo stock'}
                    className="w-14 h-20 rounded object-cover bg-gray-800 shrink-0"
                    data-autopilot-stock-vignette={s.media.providerAssetId}
                  />
                  <div className="min-w-0 space-y-1 text-[10px] text-gray-400">
                    {s.media.dureeSecondes ? <p>Durée : {dureeLisible(s.media.dureeSecondes)}</p> : null}
                    <p>
                      Vidéo de {s.media.auteur} sur{' '}
                      <a
                        href={s.media.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 underline hover:text-white"
                      >
                        Pexels <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </p>
                    {s.etat === 'conserve' ? (
                      <p className="flex items-center gap-1 text-emerald-400" data-autopilot-stock-conserve>
                        <Check className="w-3 h-3" /> Ajouté à la banque de rushes
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => conserver(s)}
                          disabled={s.etat === 'import'}
                          data-autopilot-stock-conserver={cle}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white disabled:opacity-40"
                          style={{ backgroundColor: accent }}
                        >
                          {s.etat === 'import' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />} Conserver
                        </button>
                        <button
                          type="button"
                          onClick={() => remplacer(s)}
                          disabled={s.etat === 'import'}
                          data-autopilot-stock-remplacer={cle}
                          className="flex items-center gap-1 rounded border border-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-white disabled:opacity-40"
                        >
                          <RefreshCw className="w-2.5 h-2.5" /> Remplacer
                        </button>
                        <button
                          type="button"
                          onClick={() => majSlot(cle, (x) => ({ ...x, etat: 'supprime' }))}
                          disabled={s.etat === 'import'}
                          data-autopilot-stock-supprimer={cle}
                          className="flex items-center gap-1 rounded border border-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-red-400 disabled:opacity-40"
                        >
                          <Trash2 className="w-2.5 h-2.5" /> Supprimer
                        </button>
                      </div>
                    )}
                    {s.media && s.erreur && <p className="text-amber-400">{s.erreur}</p>}
                  </div>
                </div>
              )}
              {s.etat !== 'conserve' && s.etat !== 'import' && (
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = (libre[cle] ?? '').trim().slice(0, 80);
                    if (q) remplacer(s, [q]);
                  }}
                >
                  <input
                    type="text"
                    value={libre[cle] ?? ''}
                    onChange={(e) => setLibre((l) => ({ ...l, [cle]: e.target.value }))}
                    placeholder="Chercher autre chose…"
                    aria-label={`Chercher autre chose pour ${cle}`}
                    data-autopilot-stock-libre={cle}
                    className="flex-1 min-w-0 rounded border border-gray-800 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-200 placeholder:text-gray-600"
                  />
                  <button
                    type="submit"
                    data-autopilot-stock-chercher={cle}
                    className="flex items-center gap-1 rounded border border-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-white"
                  >
                    <Search className="w-2.5 h-2.5" /> Chercher autre chose
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
