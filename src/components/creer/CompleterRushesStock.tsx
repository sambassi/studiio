'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, Image as ImageIcon, Loader2, RefreshCw, Search, Trash2, Info } from 'lucide-react';
import CarteMedia from '@/components/medias/CarteMedia';
import { creditMedia, origineSuggeree } from '@/lib/medias/libelles';
import { descriptionMediaStock, pertinenceMedia, scenarioPertinence, type ScenarioPertinence } from '@/lib/autopilot/pertinence-medias';
import type { MediaStockRetenu } from '@/lib/autopilot/sources';
import { analyserCouvertureRushes, plansAutopilote, AVATAR_PRINCIPAL, type ManqueCouverture } from '@/lib/stock/couverture';
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
 * ⚠️ PROPOSITIONS PEXELS UNIQUEMENT. Vidéos d'abord (un rush est une vidéo) ;
 * quand elles ne suffisent pas à donner `CANDIDATS_PAR_PLAN` propositions à
 * un plan, des PHOTOS Pexels complètent (si le panneau sait les retenir).
 * Unsplash n'est jamais interrogé ici : ses règles interdisent l'usage
 * automatisé (il reste dans la recherche libre, au choix de l'utilisateur).
 *
 * ⚠️ PLUSIEURS CANDIDATS, UN SEUL CHOIX. Trois propositions par plan,
 * classées par pertinence de contenu (`pertinence-medias`) ; « Remplacer »
 * alterne entre elles. Seul « Conserver » ajoute — un choix de l'utilisateur
 * n'est jamais remplacé automatiquement.
 *
 * ⚠️ JAMAIS BLOQUANT. Fournisseur en panne, quota, aucun résultat : un message
 * discret, et l'Autopilote continue avec les rushes de l'utilisateur.
 *
 * ⚠️ À L'ÉCRAN : « Vidéo suggérée », jamais le nom de la plateforme. Son
 * attribution (exigée) vit dans « Informations du média » de l'aperçu.
 */

/** Ce que l'on garde d'un média stock accepté — affiché dans la banque. */
export interface MetaRushStock {
  provider: 'pexels';
  providerAssetId: string;
  auteur: string;
  sourceUrl: string;
  licence: string;
  /** Vignette du fournisseur — pour le résumé « Médias prévus » et le plan. */
  vignetteUrl?: string;
}

/** Le fichier qu'écrit `/api/stock/importer` : `stock-pexels-video-<id>.mp4`. */
const NOM_RUSH_STOCK = /\/stock-pexels-video-([A-Za-z0-9_-]+)\.mp4(?:[?#].*)?$/;

/** Ce rush vient-il d'un import stock (reconnu à son nom de fichier) ? */
export function idStockDuRush(url: string): string | null {
  return NOM_RUSH_STOCK.exec(url)?.[1] ?? null;
}

export const MESSAGE_STOCK_INDISPONIBLE = 'Suggestions de médias indisponibles pour le moment — l’Autopilote continue avec vos autres sources.';

type EtatSlot = 'recherche' | 'propose' | 'vide' | 'import' | 'conserve' | 'supprime';

/** Candidats proposés par plan manquant — l'utilisateur choisit, « Remplacer » alterne. */
export const CANDIDATS_PAR_PLAN = 3;
/** Requêtes interrogées au plus, par plan, pour réunir ses candidats (quota fournisseur). */
const REQUETES_MAX_PAR_PLAN = 2;

interface Slot {
  manque: ManqueCouverture;
  /** Les propositions de ce plan, dans l'ordre de pertinence (au plus `CANDIDATS_PAR_PLAN`, + « Remplacer »). */
  candidats: MediaStock[];
  /** Le candidat montré (et conservé au clic). */
  choix: number;
  etat: EtatSlot;
  /** Médias déjà montrés pour ce plan — « Remplacer » au-delà des candidats ne les repropose pas. */
  vus: string[];
  /** Requêtes de ce plan : celles du moteur, ou la saisie libre. */
  requetes: string[];
  erreur?: string | null;
}

const mediaDu = (s: Slot): MediaStock | null => s.candidats[s.choix] ?? null;

/** Nom lisible d'un plan du smart montage (jamais « plan-2 »). */
function libellePlan(role: string): string {
  return role === 'HOOK' ? 'Plan d’accroche' : role === 'BUILD' ? 'Plan de développement' : role === 'PEAK' ? 'Plan temps fort' : role === 'FOCUS' ? 'Plan focus' : 'Plan final';
}

/** Les propositions en attente de choix — remontées pour le résumé « Médias prévus ». */
export interface PropositionsStock { proposes: number; vignettes: string[] }

/**
 * CLASSEMENT des résultats d'un plan : pertinence de CONTENU d'abord (titre
 * du média lu par `pertinence-medias`, concepts abstraits compris), puis le
 * bon format (vertical pour un 9:16), puis l'ordre du moteur. Un média `hors`
 * sujet n'est jamais proposé automatiquement. Pur, tri stable.
 */
export function classerCandidats(
  medias: ReadonlyArray<MediaStock>,
  o: { orientation: string; scenario: ScenarioPertinence },
): MediaStock[] {
  return medias
    .map((m, i) => ({ m, i, p: pertinenceMedia(m.description || descriptionMediaStock(m), o.scenario) }))
    .filter((x) => x.p.niveau !== 'hors')
    .sort((a, b) => b.p.score - a.p.score
      || Number(b.m.orientation === o.orientation) - Number(a.m.orientation === o.orientation)
      || a.i - b.i)
    .map((x) => x.m);
}

/**
 * RÉPARTITION des candidats entre les plans manquants — au tour par tour :
 * chaque plan reçoit d'abord SA meilleure proposition, puis la deuxième…
 * Jamais deux fois le même média (ni déjà dans la banque, `exclus`). Pur.
 */
export function repartirCandidats(
  listes: ReadonlyArray<ReadonlyArray<MediaStock>>,
  exclus: ReadonlySet<string>,
  n = CANDIDATS_PAR_PLAN,
): MediaStock[][] {
  const pris = new Set(exclus);
  const out: MediaStock[][] = listes.map(() => []);
  for (let tour = 0; tour < n; tour += 1) {
    listes.forEach((liste, k) => {
      if (out[k].length > tour) return;
      const m = liste.find((x) => !pris.has(x.id) && !pris.has(x.providerAssetId));
      if (!m) return;
      pris.add(m.id);
      out[k].push(m);
    });
  }
  return out;
}

export default function CompleterRushesStock({
  sujet, message, objectif, rushUrls, format = '9:16', accent, onConserver, avatar = false, onPropositions,
  onRetenir, photosRetenues = [],
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
  /**
   * L'avatar personnel est le PERSONNAGE PRINCIPAL : il passe avant tout rush
   * et tient le premier plan (l'accroche) ; le stock ne complète que les
   * plans restants. Défaut `false` : l'analyse d'avant, à l'identique.
   */
  avatar?: boolean;
  onPropositions?: (p: PropositionsStock) => void;
  /**
   * Retenir une PHOTO suggérée (`retenirStock` du panneau). Fourni : quand les
   * vidéos ne suffisent pas à donner `CANDIDATS_PAR_PLAN` propositions à un
   * plan, des photos complètent. Absent : vidéos seules (le comportement d'avant).
   */
  onRetenir?: (m: MediaStockRetenu) => void;
  /** Photos suggérées déjà retenues : elles couvrent un plan comme un média stock accepté. */
  photosRetenues?: string[];
}) {
  // Les imports de CETTE session ne recalculent pas les plans : sinon chaque
  // « Conserver » relancerait la recherche et ferait disparaître la carte
  // qu'on vient de valider. Après rechargement, ils comptent comme « stock ».
  /** Identifiants Pexels acceptés — comparés au nom du fichier, que l'URL soit relative ou absolue. */
  const [acceptes, setAcceptes] = useState<string[]>([]);
  /** Photos retenues pendant CETTE session (par URL) — même raison. */
  const [photosAcceptees, setPhotosAcceptees] = useState<string[]>([]);
  const entreeRushes = useMemo(
    () => rushUrls.filter((u) => { const id = idStockDuRush(u); return !id || !acceptes.includes(id); }),
    [rushUrls, acceptes],
  );
  const entreePhotos = useMemo(
    () => (onRetenir ? photosRetenues.filter((u) => !photosAcceptees.includes(u)) : []),
    [onRetenir, photosRetenues, photosAcceptees],
  );
  const cleRushes = [...entreeRushes, ...entreePhotos].join('\n');

  const couverture = useMemo(() => analyserCouvertureRushes({
    plans: plansAutopilote(sujet, message),
    rushes: [
      ...(avatar ? [{ url: AVATAR_PRINCIPAL, origine: 'avatar' as const }] : []),
      ...entreeRushes.map((url) => ({ url, origine: idStockDuRush(url) ? 'stock' as const : 'utilisateur' as const })),
      ...entreePhotos.map((url) => ({ url, origine: 'stock' as const })),
    ],
    sujet,
    objectif,
    format,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sujet, message, objectif, format, cleRushes, avatar]);

  /** Le scénario de pertinence : le sujet et l'objectif ; le message n'est qu'une mention. */
  const scenario = useMemo(
    () => scenarioPertinence({ sujets: [sujet, objectif], textes: [message] }),
    [sujet, objectif, message],
  );

  const [slots, setSlots] = useState<Slot[]>([]);
  const [indisponible, setIndisponible] = useState(false);
  const [libre, setLibre] = useState<Record<string, string>>({});
  /** Résultats par requête et type — une requête n'est envoyée qu'une fois. */
  const cache = useRef(new Map<string, Promise<{ medias: MediaStock[]; echec: boolean }>>());
  const generation = useRef(0);
  const avecPhotos = !!onRetenir;

  const orientation = orientationDuFormat(format);
  const chercher = useCallback((requete: string, type: 'video' | 'photo' = 'video') => {
    const cle = `${type}|${requete}`;
    const deja = cache.current.get(cle);
    if (deja) return deja;
    const p = rechercherStockClient({ requete, type, format, fournisseurs: ['pexels'] })
      .then((r) => {
        const medias = classerCandidats(
          r.medias.filter((m) => m.type === type && m.provider === 'pexels'),
          { orientation, scenario },
        );
        return { medias, echec: r.echecs.length > 0 };
      });
    cache.current.set(cle, p);
    return p;
  }, [format, orientation, scenario]);

  /** Tous les résultats VIDÉO des requêtes d'un plan (au plus `REQUETES_MAX_PAR_PLAN`), dédoublonnés. */
  const reunir = useCallback(async (requetes: string[], exclus: Set<string>, type: 'video' | 'photo' = 'video') => {
    let echec = false;
    const out: MediaStock[] = [];
    for (const requete of requetes.slice(0, REQUETES_MAX_PAR_PLAN)) {
      const r = await chercher(requete, type);
      echec = echec || r.echec;
      for (const m of r.medias) if (!exclus.has(m.id) && !exclus.has(m.providerAssetId) && !out.some((x) => x.id === m.id)) out.push(m);
      if (out.length >= CANDIDATS_PAR_PLAN * 2) break;
    }
    return { medias: out, echec };
  }, [chercher]);

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
      if (x.manque.sequence === sauf || x.etat === 'supprime') continue;
      for (const m of x.candidats) s.add(m.id);
    }
    return s;
  }, [rushUrls]);

  // ── Trois propositions par manque, jamais deux fois le même média ───────
  const cleManques = couverture.manques.map((m) => `${m.sequence}:${m.searchQueries.join('|')}`).join(';');
  useEffect(() => {
    const g = ++generation.current;
    setIndisponible(false);
    if (couverture.couvertureSuffisante) { setSlots([]); return; }
    const initiaux: Slot[] = couverture.manques.map((manque) => ({
      manque, candidats: [], choix: 0, etat: 'recherche', vus: [], requetes: manque.searchQueries,
    }));
    setSlots(initiaux);
    (async () => {
      const banque = exclusDe([]);
      let echecs = 0;
      // 1. Les vidéos de chaque plan (ses requêtes à lui).
      const listes: MediaStock[][] = [];
      for (const s of initiaux) {
        const r = await reunir(s.requetes, banque);
        if (g !== generation.current) return;
        if (r.echec) echecs += 1;
        listes.push(r.medias);
      }
      let parPlan = repartirCandidats(listes, banque);
      // 2. Vidéos insuffisantes pour un plan : des PHOTOS complètent (si le panneau sait les retenir).
      if (avecPhotos && parPlan.some((c) => c.length < CANDIDATS_PAR_PLAN)) {
        const pris = new Set(banque);
        for (const c of parPlan) for (const m of c) pris.add(m.id);
        parPlan = await Promise.all(parPlan.map(async (c, k) => {
          if (c.length >= CANDIDATS_PAR_PLAN) return c;
          const r = await reunir(initiaux[k].requetes.slice(0, 1), pris, 'photo');
          if (r.echec) echecs += 1;
          const ajout: MediaStock[] = [];
          for (const m of r.medias) {
            if (c.length + ajout.length >= CANDIDATS_PAR_PLAN) break;
            if (pris.has(m.id)) continue;
            pris.add(m.id);
            ajout.push(m);
          }
          return [...c, ...ajout];
        }));
        if (g !== generation.current) return;
      }
      const finaux: Slot[] = initiaux.map((s, k) => ({
        ...s,
        candidats: parPlan[k],
        choix: 0,
        etat: parPlan[k].length ? 'propose' : 'vide',
        vus: parPlan[k].map((m) => m.id),
      }));
      setSlots(finaux);
      if (echecs > 0 || finaux.every((s) => !s.candidats.length)) setIndisponible(true);
    })();
    return () => { generation.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleManques, couverture.couvertureSuffisante]);

  const majSlot = useCallback((sequence: string, f: (s: Slot) => Slot) => {
    setSlots((t) => t.map((s) => (s.manque.sequence === sequence ? f(s) : s)));
  }, []);

  /**
   * « Remplacer » : ALTERNE parmi les candidats du plan (aucun appel) ; un seul
   * candidat → une nouvelle recherche qui saute ce qui a été vu. Une saisie
   * libre (`requetes`) repart de zéro avec ses propres candidats.
   */
  const remplacer = useCallback(async (slot: Slot, requetes?: string[]) => {
    if (!requetes && slot.candidats.length > 1) {
      majSlot(slot.manque.sequence, (s) => ({ ...s, choix: (s.choix + 1) % s.candidats.length, erreur: null }));
      return;
    }
    const q = requetes ?? slot.requetes;
    majSlot(slot.manque.sequence, (s) => ({ ...s, etat: 'recherche', requetes: q, erreur: null }));
    const exclus = exclusDe(slots, slot.manque.sequence);
    if (!requetes) {
      for (const v of slot.vus) exclus.add(v);
      const r = await premierLibre(q, exclus);
      majSlot(slot.manque.sequence, (s) => ({
        ...s,
        candidats: r.media ? [r.media] : s.candidats,
        choix: 0,
        etat: r.media || s.candidats.length ? 'propose' : 'vide',
        vus: r.media ? [...s.vus, r.media.id] : s.vus,
        erreur: r.media ? null : r.echec ? MESSAGE_STOCK_INDISPONIBLE : 'Aucune autre proposition pour ce plan.',
      }));
      return;
    }
    const v = await reunir(q, exclus);
    let candidats = v.medias.slice(0, CANDIDATS_PAR_PLAN);
    let echec = v.echec;
    if (avecPhotos && candidats.length < CANDIDATS_PAR_PLAN) {
      const ph = await reunir(q, exclus, 'photo');
      echec = echec || ph.echec;
      candidats = [...candidats, ...ph.medias].slice(0, CANDIDATS_PAR_PLAN);
    }
    majSlot(slot.manque.sequence, (s) => ({
      ...s,
      candidats,
      choix: 0,
      etat: candidats.length ? 'propose' : 'vide',
      vus: candidats.map((m) => m.id),
      erreur: candidats.length ? null : echec ? MESSAGE_STOCK_INDISPONIBLE : 'Aucune proposition pour cette recherche.',
    }));
  }, [slots, exclusDe, premierLibre, reunir, majSlot, avecPhotos]);

  const conserver = useCallback(async (slot: Slot) => {
    const m = mediaDu(slot);
    if (!m) return;
    majSlot(slot.manque.sequence, (s) => ({ ...s, etat: 'import', erreur: null }));
    if (m.type === 'photo') {
      // Photo Pexels : aucune importation, l'URL est retenue telle quelle (comme la recherche libre).
      const url = m.fichierUrl;
      setPhotosAcceptees((a) => [...a, url]);
      majSlot(slot.manque.sequence, (s) => ({ ...s, etat: 'conserve' }));
      onRetenir?.({
        url, type: 'photo', provider: m.provider, providerAssetId: m.providerAssetId,
        auteur: m.auteur, sourceUrl: m.sourceUrl, licence: m.licence, vignetteUrl: m.vignetteUrl,
      });
      return;
    }
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
      vignetteUrl: m.vignetteUrl,
    });
  }, [majSlot, onConserver, onRetenir]);

  // « Proposés » = encore en attente de votre choix ; un média conservé est déjà dans la banque.
  const enAttente = couverture.couvertureSuffisante
    ? []
    : slots.filter((s) => mediaDu(s) && s.etat !== 'supprime' && s.etat !== 'conserve');
  const proposes = enAttente.length;
  const cleVignettes = enAttente.map((s) => mediaDu(s)!.vignetteUrl).join('\n');
  useEffect(() => {
    onPropositions?.({ proposes, vignettes: cleVignettes ? cleVignettes.split('\n') : [] });
  }, [proposes, cleVignettes, onPropositions]);
  // Démonté (case décochée) : plus aucune proposition en attente.
  useEffect(() => () => onPropositions?.({ proposes: 0, vignettes: [] }), [onPropositions]);

  if (couverture.couvertureSuffisante) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-emerald-400" data-autopilot-stock-suffisant>
        <Check className="w-3 h-3 mt-0.5 shrink-0" />
        {avatar ? 'Votre avatar et vos rushes suffisent : aucun média suggéré nécessaire.' : 'Vos rushes suffisent : aucun média suggéré nécessaire.'}
      </p>
    );
  }

  return (
    <div className="space-y-2" data-autopilot-stock>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-300">
        {avatar && <span data-autopilot-stock-avatar>Avatar personnel : plan d’accroche</span>}
        <span data-autopilot-stock-personnels>Rushes personnels : {couverture.rushesPersonnels}</span>
        <span data-autopilot-stock-proposes>Médias suggérés : {proposes}</span>
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
          const media = mediaDu(s);
          const nomType = media?.type === 'photo' ? 'photo' : 'vidéo';
          if (s.etat === 'supprime') {
            return (
              <li key={cle} className="text-[11px] text-gray-500" data-autopilot-stock-slot={cle} data-etat="supprime">
                {libellePlan(s.manque.role)} : proposition retirée — ce plan reprendra vos rushes.
              </li>
            );
          }
          return (
            <li key={cle} className="flex flex-wrap gap-2 rounded-lg border border-gray-800 bg-gray-900 p-2 min-w-0" data-autopilot-stock-slot={cle} data-etat={s.etat}>
              {media && s.etat !== 'recherche' && (
                <div className="shrink-0 space-y-1" style={{ width: 132 }}>
                  <CarteMedia
                    key={media.id}
                    url={media.type === 'video' ? (media.fichierUrl || media.vignetteUrl) : (media.apercuUrl || media.fichierUrl)}
                    type={media.type}
                    vignetteUrl={media.vignetteUrl}
                    dureeSecondes={media.dureeSecondes}
                    metadonnees={false}
                    origine={origineSuggeree(media.type)}
                    credit={{ texte: creditMedia(media), lien: media.sourceUrl }}
                    accent={accent}
                    vignetteAttrs={{ 'data-autopilot-stock-vignette': media.providerAssetId }}
                    actions={s.etat === 'conserve' ? [] : [
                      {
                        cle: 'conserver', libelle: 'Conserver', icone: Check, variante: 'principal',
                        onClick: () => { void conserver(s); }, disabled: s.etat === 'import', enCours: s.etat === 'import',
                        ariaLabel: `Conserver cette ${nomType} pour le ${libellePlan(s.manque.role).toLowerCase()}`,
                        attrs: { 'data-autopilot-stock-conserver': cle },
                      },
                      {
                        cle: 'remplacer', libelle: 'Remplacer', icone: RefreshCw,
                        onClick: () => { void remplacer(s); }, disabled: s.etat === 'import',
                        ariaLabel: s.candidats.length > 1
                          ? `Montrer la proposition suivante pour le ${libellePlan(s.manque.role).toLowerCase()}`
                          : `Proposer un autre média pour le ${libellePlan(s.manque.role).toLowerCase()}`,
                        attrs: { 'data-autopilot-stock-remplacer': cle },
                      },
                      {
                        cle: 'supprimer', libelle: 'Supprimer', icone: Trash2, variante: 'danger',
                        onClick: () => majSlot(cle, (x) => ({ ...x, etat: 'supprime' })), disabled: s.etat === 'import',
                        ariaLabel: `Retirer cette proposition du ${libellePlan(s.manque.role).toLowerCase()}`,
                        attrs: { 'data-autopilot-stock-supprimer': cle },
                      },
                    ]}
                    badges={s.etat === 'conserve' ? (
                      <p className="flex items-center gap-1 text-[10px] text-emerald-400" data-autopilot-stock-conserve>
                        <Check className="w-3 h-3 shrink-0" /> Ajoutée à la banque
                      </p>
                    ) : null}
                  />
                  {/* Les AUTRES propositions de ce plan : un clic les montre (rien n'est ajouté). */}
                  {s.candidats.length > 1 && s.etat !== 'conserve' && (
                    <div className="flex gap-1" role="group" aria-label={`Propositions pour le ${libellePlan(s.manque.role).toLowerCase()}`} data-autopilot-stock-candidats={cle}>
                      {s.candidats.map((c, i) => {
                        const Icone = c.type === 'photo' ? ImageIcon : Film;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => majSlot(cle, (x) => ({ ...x, choix: i, erreur: null }))}
                            disabled={s.etat === 'import'}
                            aria-pressed={i === s.choix}
                            aria-label={`Proposition ${i + 1} sur ${s.candidats.length} (${c.type === 'photo' ? 'photo' : 'vidéo'})`}
                            data-autopilot-stock-candidat={c.providerAssetId}
                            className={`relative overflow-hidden rounded ${i === s.choix ? 'ring-2 ring-studiio-primary' : 'ring-1 ring-white/10 opacity-70 hover:opacity-100'}`}
                            style={{ width: 40, height: 40 }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.vignetteUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 p-0.5 text-white"><Icone className="w-2.5 h-2.5" /></span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1.5" style={{ flexBasis: 160 }}>
                <p className="text-[11px] text-gray-400">
                  <span className="font-medium text-gray-300">{libellePlan(s.manque.role)}</span> — {s.manque.raison}
                  <span className="block text-[10px] text-gray-500">Recherche : {s.manque.searchQueries[0] ?? s.manque.theme}</span>
                </p>
                {s.etat === 'recherche' && (
                  <p className="flex items-center gap-1.5 text-[11px] text-gray-500">
                    <Loader2 className="w-3 h-3 animate-spin" /> Recherche en cours…
                  </p>
                )}
                {s.etat !== 'recherche' && !media && (
                  <p className="text-[11px] text-gray-500" data-autopilot-stock-vide>
                    {s.erreur ?? 'Aucune proposition pour ce plan.'}
                  </p>
                )}
                {media && s.erreur && <p className="text-[10px] text-amber-400">{s.erreur}</p>}
                {s.etat !== 'conserve' && s.etat !== 'import' && (
                  <form
                    className="flex flex-wrap gap-1"
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
                      aria-label={`Chercher autre chose pour le ${libellePlan(s.manque.role).toLowerCase()}`}
                      data-autopilot-stock-libre={cle}
                      className="flex-1 min-w-0 rounded border border-gray-800 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-200 placeholder:text-gray-600"
                    />
                    <button
                      type="submit"
                      data-autopilot-stock-chercher={cle}
                      className="shrink-0 flex items-center gap-1 rounded border border-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-white"
                    >
                      <Search className="w-2.5 h-2.5" /> Chercher autre chose
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
