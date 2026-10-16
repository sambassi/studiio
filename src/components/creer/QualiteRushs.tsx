'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import type { MediaVideo } from '@/lib/creer/medias-video';
import { cleSource, type AnalyseRush, type ContexteMontage } from '@/lib/creer/smart-montage';
import { evaluerQualiteRushs, libelleQualite, type QualiteRush } from '@/lib/creer/qualite-rushs';
import { conceptsDuSujet, pertinenceRush, type PertinenceRush } from '@/lib/creer/pertinence-rushs';
import { langueDe, nomConcept, TEXTES_PANNEAU, texteMotif, type LanguePertinence } from '@/lib/creer/pertinence-rushs-textes';
import { chargerFicheV2, chargerFichesContenu } from '@/lib/creer/fiche-contenu-client';
import type { FicheContenuRush } from '@/lib/creer/fiche-contenu';
import type { FicheContenuRushV2 } from '@/lib/creer/fiche-contenu-v2';
import { useLocale } from '@/i18n/client';

/**
 * M1 — QUALITÉ DES RUSHES, sous la liste des médias de la séquence Vidéo.
 *
 * RECOMMANDATION, JAMAIS DÉCISION : par défaut rien n'est écarté, le plan et
 * le fichier final restent ceux d'aujourd'hui. Deux gestes explicites :
 *  - « Écarter ce rush » : le même retrait que « Supprimer » sur la carte
 *    (l'appelant le passe au montage comme un retrait manuel) ;
 *  - « Utiliser quand même » : masque l'avertissement, le rush reste.
 *
 * L'analyse est CELLE de l'export (`analyserRushMemo`, locale, gratuite,
 * aucun fournisseur) : une seule mesure par rush, mêmes chiffres. Mise en
 * pause pendant un export, abandonnée après un délai, jamais bloquante.
 */

type Analyseur = (url: string) => Promise<AnalyseRush | null>;

/** Au-delà, une analyse qui ne répond pas est abandonnée (le panneau ne reste jamais « en cours »). */
export const DELAI_ANALYSE_PANNEAU_MS = 90_000;
/** Rush plus court : aucune analyse possible (`analyserRush` exige 1 s). */
const DUREE_ANALYSABLE_MIN = 1;
/** « Utiliser quand même », mémorisé par rush (clé de stockage), comme les autres préférences de Créer. */
export const CLE_ACCEPTES = 'studiio:creer:qualite-rushs:acceptes';

/**
 * M2-c — « Utiliser quand même » sur un avis de PERTINENCE : mémoire SÉPARÉE
 * de la qualité (accepter un rush flou ne masque pas un hors-sujet, et
 * inversement), par rush ET par sujet (`<clé>|<concepts du sujet>`).
 */
export const CLE_PERTINENCE_ACCEPTES = 'studiio:creer:pertinence-rushs:acceptes';

function lireAcceptes(cleStockage: string = CLE_ACCEPTES): Set<string> {
  try {
    const brut = window.localStorage.getItem(cleStockage);
    const v = brut ? JSON.parse(brut) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-200) : []);
  } catch {
    return new Set();
  }
}
function ecrireAcceptes(s: Set<string>, cleStockage: string = CLE_ACCEPTES) {
  try { window.localStorage.setItem(cleStockage, JSON.stringify(Array.from(s).slice(-200))); } catch { /* stockage indisponible : préférence de session seulement */ }
}

/** L'analyse PARTAGÉE avec l'export (`analyserRushMemo`) : une seule mesure par rush. */
const analyseurParDefaut: Analyseur = async (url) => {
  const { analyserRushMemo } = await import('@/lib/creer/analyse-rush');
  // Borne 180 s pour le panneau SEUL (une analyse partielle n'est jamais reprise par l'export).
  return analyserRushMemo(url, undefined, { borne: true });
};

const avecDelai = <T,>(p: Promise<T>, ms: number): Promise<T | 'delai'> =>
  Promise.race([p, new Promise<'delai'>((ok) => setTimeout(() => ok('delai'), ms))]);

type EtatAnalyse = { etat: 'mesuree'; analyse: AnalyseRush } | { etat: 'echec' };

type FicheLue = FicheContenuRush | FicheContenuRushV2 | null;
/** Lit les fiches de contenu (v1, puis v2 en cache pour les rushes personnels). LECTURE SEULE. */
export type LecteurFiches = (urls: string[], personnels: ReadonlySet<string>) => Promise<Map<string, FicheLue>>;

/**
 * Lecture par défaut : `GET /api/creer/fiches-contenu` (v1, 0 €), puis, pour
 * les rushes personnels seulement, `GET …/approfondir` (v2 en CACHE). Jamais
 * le POST : aucune analyse n'est déclenchée d'ici.
 */
const lecteurFichesParDefaut: LecteurFiches = async (urls, personnels) => {
  const v1 = await chargerFichesContenu(urls);
  const out = new Map<string, FicheLue>();
  for (const u of urls) {
    let f: FicheLue = v1.get(u) ?? null;
    if (personnels.has(u)) f = (await chargerFicheV2(u)) ?? f;
    out.set(u, f);
  }
  return out;
};

export interface QualiteRushsProps {
  medias: MediaVideo[];
  /** URL que le serveur peut relire (jamais une `blob:`) ; les autres ne sont pas analysées. */
  estDurable: (url: string) => boolean;
  /** « Écarter ce rush » : retrait explicite du montage. Rend `false` si le rush n'a pas été retrouvé (rien n'est fait). */
  onEcarter: (url: string) => boolean;
  /** Export en cours : aucune nouvelle analyse lancée (elles ne doivent pas se disputer le décodage). */
  enPause?: boolean;
  /** Tests : analyse injectée (défaut : analyse locale partagée avec l'export). */
  analyser?: Analyseur;
  delaiMs?: number;
  /**
   * M2-c — Contexte du montage (`contexteMontageDepuis`, le MÊME que l'export).
   * Facultatif : sans lui, le panneau est exactement celui de M1 (aucune
   * lecture de fiche, aucun avis de pertinence).
   */
  contexte?: ContexteMontage | null;
  /** Tests : lecture des fiches injectée (défaut : routes GET existantes). */
  lireFiches?: LecteurFiches;
}

export default function QualiteRushs({ medias, estDurable, onEcarter, enPause = false, analyser = analyseurParDefaut, delaiMs = DELAI_ANALYSE_PANNEAU_MS, contexte = null, lireFiches = lecteurFichesParDefaut }: QualiteRushsProps) {
  // Rushes vidéo de l'utilisateur ou suggérés — jamais l'avatar, jamais une photo.
  const rushs = useMemo(
    () => medias.filter((m): m is MediaVideo & { url: string } => m.type === 'video' && m.source !== 'avatar' && !!m.url && estDurable(m.url)),
    [medias, estDurable],
  );
  /** Rushes dont la durée MESURÉE est sous la seconde : pas d'analyse, on le dit. */
  const tropCourts = rushs.filter((m) => typeof m.duree === 'number' && m.duree > 0 && m.duree < DUREE_ANALYSABLE_MIN);
  const aAnalyser = rushs.filter((m) => !tropCourts.includes(m));
  const cles = aAnalyser.map((m) => m.url).join('\n');
  const [resultats, setResultats] = useState<Record<string, EtatAnalyse>>({});
  /** « Utiliser quand même » : avertissements masqués, par clé de rush, mémorisés. */
  const [acceptes, setAcceptes] = useState<Set<string>>(() => new Set());
  const [introuvable, setIntrouvable] = useState(false);
  useEffect(() => { setAcceptes(lireAcceptes()); }, []);

  useEffect(() => {
    if (enPause) return;
    let vivant = true;
    const manquantes = (cles ? cles.split('\n') : []).filter((u) => !(u in resultats));
    if (!manquantes.length) return;
    void (async () => {
      // Un rush après l'autre : décoder plusieurs vidéos à la fois ralentit la page.
      for (const u of manquantes) {
        if (!vivant) return;
        const r = await avecDelai(analyser(u).catch(() => null), delaiMs);
        if (!vivant) return;
        setResultats((prev) => ({ ...prev, [u]: r && r !== 'delai' ? { etat: 'mesuree', analyse: r } : { etat: 'echec' } }));
      }
    })();
    return () => { vivant = false; };
    // `resultats` exclu : seules les URL nouvelles (ou la fin de la pause) relancent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cles, analyser, enPause, delaiMs]);

  // « En cours » DÉDUIT de la liste actuelle : un rush retiré pendant sa mesure
  // ne laisse jamais le panneau bloqué.
  const enCours = !enPause && aAnalyser.some((m) => !(m.url in resultats));

  const diagnostic = useMemo(() => {
    const mesurees = aAnalyser.map((m) => resultats[m.url]).filter((r): r is Extract<EtatAnalyse, { etat: 'mesuree' }> => r?.etat === 'mesuree').map((r) => r.analyse);
    if (!mesurees.length) return [];
    // Un rush importé ou pris dans la Médiathèque est un CHOIX de l'utilisateur.
    const choisis = rushs.filter((m) => m.source === 'rush' || m.source === 'mediatheque').map((m) => m.url);
    return evaluerQualiteRushs(mesurees, { choisisParUtilisateur: choisis }).rushs;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cles, resultats, rushs]);

  // ── M2-c — PERTINENCE (recommandation seulement, jamais lue par le montage) ──
  const langue: LanguePertinence = langueDe(useLocale());
  const sujet = useMemo(() => (contexte ? conceptsDuSujet(contexte) : null), [contexte]);
  const pertinenceActive = !!sujet && sujet.activites.length > 0;
  const signatureSujet = sujet ? [...sujet.activites, ...sujet.lieuxObjets].join(',') : '';
  const clesPertinence = pertinenceActive ? rushs.map((m) => m.url).join('\n') : '';
  const [fiches, setFiches] = useState<Record<string, FicheLue>>({});
  const [acceptesPertinence, setAcceptesPertinence] = useState<Set<string>>(() => new Set());
  useEffect(() => { if (pertinenceActive) setAcceptesPertinence(lireAcceptes(CLE_PERTINENCE_ACCEPTES)); }, [pertinenceActive]);
  useEffect(() => {
    if (enPause || !clesPertinence) return;
    let vivant = true;
    const manquantes = clesPertinence.split('\n').filter((u) => !(u in fiches));
    if (!manquantes.length) return;
    // Rushes PERSONNELS (importés, Médiathèque) : seuls à pouvoir avoir une fiche v2.
    const personnels = new Set(rushs.filter((m) => m.source === 'rush' || m.source === 'mediatheque').map((m) => m.url));
    void (async () => {
      const lues = await avecDelai(lireFiches(manquantes, personnels).catch(() => new Map<string, FicheLue>()), delaiMs);
      if (!vivant) return;
      setFiches((prev) => {
        const n = { ...prev };
        for (const u of manquantes) n[u] = lues !== 'delai' ? lues.get(u) ?? null : null;
        return n;
      });
    })();
    return () => { vivant = false; };
    // `fiches` exclu : seules les URL nouvelles (ou la fin de la pause) relancent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clesPertinence, enPause, lireFiches, delaiMs]);
  const pertinences = useMemo(
    () => (pertinenceActive && contexte
      ? rushs.filter((m) => m.url in fiches).map((m) => ({ url: m.url, p: pertinenceRush(fiches[m.url], contexte, { cle: cleSource(m.url) }) }))
      : []),
    [pertinenceActive, contexte, rushs, fiches],
  );
  const cleAccord = (p: PertinenceRush) => `${p.cle}|${signatureSujet}`;
  const pertinencesASignaler = pertinences.filter(({ p }) => (p.niveau === 'hors_sujet' || p.aVerifier) && !acceptesPertinence.has(cleAccord(p)));
  const nbCoherents = pertinences.filter(({ p }) => !p.aVerifier && (p.niveau === 'pertinent' || p.niveau === 'partiel')).length;
  const nbInconnus = pertinences.filter(({ p }) => !p.aVerifier && p.niveau === 'inconnu').length;
  const textes = TEXTES_PANNEAU[langue];
  const resumePertinence = [nbCoherents ? textes.coherents(nbCoherents) : '', nbInconnus ? textes.inconnus(nbInconnus) : ''].filter(Boolean).join(' · ');
  const accepterPertinence = (p: PertinenceRush) => setAcceptesPertinence((prev) => {
    const n = new Set(prev).add(cleAccord(p));
    ecrireAcceptes(n, CLE_PERTINENCE_ACCEPTES);
    return n;
  });

  const position = (url: string) => medias.findIndex((m) => m.url === url) + 1;
  const aSignaler = diagnostic.filter((q) => q.verdict !== 'ok' && !acceptes.has(q.cle));
  const courtsASignaler = tropCourts.filter((m) => !acceptes.has(cleSource(m.url)));
  const accepter = (cle: string) => setAcceptes((prev) => { const n = new Set(prev).add(cle); ecrireAcceptes(n); return n; });
  const ecarter = (url: string) => { setIntrouvable(!onEcarter(url)); };

  if (!rushs.length || (!enCours && aSignaler.length === 0 && courtsASignaler.length === 0 && !introuvable
    && pertinencesASignaler.length === 0 && !resumePertinence)) return null;

  return (
    <div className="mt-2 space-y-1.5" data-qualite-rushs>
      {enCours && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-500" data-qualite-rushs-analyse>
          <Loader2 className="h-3 w-3 animate-spin" />
          Vérification de la qualité de vos rushes…
        </p>
      )}
      {enPause && aAnalyser.some((m) => !(m.url in resultats)) && (
        <p className="text-[11px] text-gray-500" data-qualite-rushs-pause>Vérification de la qualité reprise après l&apos;export.</p>
      )}
      {introuvable && (
        <p className="text-[11px] text-amber-400/90" data-qualite-introuvable>
          Ce rush n&apos;est plus dans la liste : rien n&apos;a été retiré.
        </p>
      )}
      {courtsASignaler.map((m) => (
        <LigneQualite
          key={m.url}
          q={{ url: m.url, cle: cleSource(m.url), verdict: 'a_verifier', motifs: [{ code: 'trop_court', gravite: 'faible', texte: `trop court pour être analysé : ${String(Math.round((m.duree as number) * 10) / 10).replace('.', ',')} s`, mesure: m.duree as number, seuil: DUREE_ANALYSABLE_MIN }], protections: [], choisiParVous: m.source === 'rush' || m.source === 'mediatheque' }}
          position={position(m.url)}
          onEcarter={() => ecarter(m.url)}
          onAccepter={() => accepter(cleSource(m.url))}
        />
      ))}
      {aSignaler.map((q) => (
        <LigneQualite
          key={q.url}
          q={q}
          position={position(q.url)}
          onEcarter={() => ecarter(q.url)}
          onAccepter={() => accepter(q.cle)}
        />
      ))}
      {pertinencesASignaler.map(({ url, p }) => (
        <LignePertinence
          key={`pertinence-${url}`}
          p={p}
          theme={nomConcept(sujet?.activites[0], langue)}
          langue={langue}
          position={position(url)}
          onEcarter={() => ecarter(url)}
          onAccepter={() => accepterPertinence(p)}
        />
      ))}
      {resumePertinence && (
        <p className="text-[11px] text-gray-500" data-pertinence-resume>{resumePertinence}</p>
      )}
    </div>
  );
}

type LignePertinenceProps = { p: PertinenceRush; theme: string; langue: LanguePertinence; position: number; onEcarter: () => void; onAccepter: () => void };

/** M2-c — Un avis de pertinence : « Hors sujet pour … » ou « À vérifier », 1 à 2 raisons, les deux gestes existants. */
function LignePertinence({ p, theme, langue, position, onEcarter, onAccepter }: LignePertinenceProps) {
  const hors = p.niveau === 'hors_sujet';
  const Icone = hors ? XCircle : AlertTriangle;
  const t = TEXTES_PANNEAU[langue];
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${hors ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
      data-pertinence-rush={p.cle}
      data-niveau={p.niveau}
    >
      <div className="flex items-center gap-2">
        <Icone className={`h-3.5 w-3.5 flex-shrink-0 ${hors ? 'text-red-400' : 'text-amber-400'}`} />
        <span className="text-[11px] text-gray-400">{t.media(position)}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${hors ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}
          data-pertinence-badge
        >
          {hors ? t.badgeHorsSujet(theme) : t.badgeAVerifier}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5">
        {p.motifs.slice(0, 2).map((m, i) => (
          <li key={`${m.code}-${i}`} className="text-[11px] text-gray-400" data-pertinence-motif={m.code}>{texteMotif(m, langue)}</li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-gray-500">{t.mention}</p>
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={onEcarter}
          className="rounded-lg border border-gray-700 px-2.5 py-1 text-[11px] text-gray-200 transition hover:border-gray-500 hover:text-white"
          data-pertinence-ecarter
        >
          {t.ecarter}
        </button>
        <button
          type="button"
          onClick={onAccepter}
          className="rounded-lg px-2.5 py-1 text-[11px] text-gray-400 transition hover:text-white"
          data-pertinence-accepter
        >
          {t.accepter}
        </button>
      </div>
    </div>
  );
}

type LigneProps = { q: Pick<QualiteRush, 'url' | 'cle' | 'verdict' | 'motifs' | 'protections' | 'choisiParVous'>; position: number; onEcarter: () => void; onAccepter: () => void };

function LigneQualite({ q, position, onEcarter, onAccepter }: LigneProps) {
  const grave = q.verdict === 'inutilisable';
  const Icone = grave ? XCircle : AlertTriangle;
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${grave ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
      data-qualite-rush={q.cle}
      data-verdict={q.verdict}
    >
      <div className="flex items-center gap-2">
        <Icone className={`h-3.5 w-3.5 flex-shrink-0 ${grave ? 'text-red-400' : 'text-amber-400'}`} />
        <span className="text-[11px] text-gray-400">Média {position > 0 ? position : ''}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${grave ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}
          data-qualite-badge
        >
          {libelleQualite(q)}
        </span>
        {q.choisiParVous && (
          <span className="text-[11px] text-gray-500" data-qualite-choisi>choisi par vous</span>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {q.motifs.map((m) => (
          <li key={m.code} className="text-[11px] text-gray-400" data-qualite-motif={m.code}>{m.texte}</li>
        ))}
        {q.protections.map((p) => (
          <li key={p} className="text-[11px] text-gray-500">{p}</li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-gray-500">
        Recommandation seulement : ce rush reste dans votre montage tant que vous ne l&apos;écartez pas.
      </p>
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={onEcarter}
          className="rounded-lg border border-gray-700 px-2.5 py-1 text-[11px] text-gray-200 transition hover:border-gray-500 hover:text-white"
          data-qualite-ecarter
        >
          Écarter ce rush
        </button>
        <button
          type="button"
          onClick={onAccepter}
          className="rounded-lg px-2.5 py-1 text-[11px] text-gray-400 transition hover:text-white"
          data-qualite-accepter
        >
          Utiliser quand même
        </button>
      </div>
    </div>
  );
}
