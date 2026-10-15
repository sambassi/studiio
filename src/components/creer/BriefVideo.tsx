'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Pencil, Sparkles, Wand2 } from 'lucide-react';
import {
  BRIEF_KEYS, BRIEF_LABELS, BRIEF_MAX_CHARS, DUREES_BRIEF, DUREE_BRIEF_MIN, DUREE_BRIEF_MAX,
  RYTHMES_BRIEF, RYTHME_LABELS, briefRempli,
  type BriefKey, type VideoBrief,
} from '@/lib/creer/brief';
import {
  analyserCoherenceBrief, placeholdersBrief, profilBrief, remplirBrief, suggestionChamp, suggestionsRapides,
} from '@/lib/creer/brief-assistant';
import { themeLabel } from '@/lib/themes';
import { SEQUENCE_KEYS, type SequenceKey } from '@/lib/types/voice';

/** « l'objectif », « le message »… — pour « Adapter l'objectif au thème Finance ». */
const CHAMP_ARTICLE: Record<BriefKey, string> = {
  objectif: 'l’objectif',
  message: 'le message',
  public: 'le public',
  cta: 'l’appel à l’action',
};

/** Les champs qui affichent des suggestions rapides quand ils sont vides. */
const AVEC_RAPIDES: ReadonlySet<BriefKey> = new Set<BriefKey>(['objectif', 'public', 'cta']);

/**
 * Le « Brief de la vidéo » — objectif, message, public, CTA.
 *
 * Quatre champs OPTIONNELS. Le composant ne possède que l'état de l'AIDE
 * (rang des suggestions, alertes écartées, texte à rétablir) : le brief, lui,
 * appartient au parent, qui le persiste — brouillon de « Créer »,
 * configuration de l'Autopilote. Rien n'est généré ni facturé ici.
 *
 * `sujets` (le ou les thèmes choisis) active l'ASSISTANT : exemples et
 * suggestions du thème, « M'aider à remplir », « Suggérer », et l'alerte
 * quand un champ parle d'autre chose que le thème. Sans `sujets`, le bloc est
 * celui d'avant, à l'identique.
 *
 * ⚠️ JAMAIS D'ÉCRASEMENT SILENCIEUX : « M'aider à remplir » ne touche que les
 * champs vides ; « Suggérer » et « Adapter » ne remplacent un texte saisi que
 * sur un clic explicite, et proposent de le rétablir.
 */
export default function BriefVideo({
  brief,
  onChange,
  onCommit,
  disabled = false,
  titre = 'Brief de la vidéo',
  aide = 'Un thème ne dit pas ce que la vidéo doit transmettre. Ces quatre lignes guident le contenu généré et la narration.',
  idPrefix = 'brief',
  sujets,
  avecDureeRythme = false,
  onChangerTheme,
  conseilDuree = null,
}: {
  brief: VideoBrief;
  onChange: (brief: VideoBrief) => void;
  /**
   * Appelé quand un champ perd le focus — pour un parent qui ENREGISTRE
   * côté serveur (Autopilote) et ne veut pas un appel par frappe. Le
   * brouillon de Créer, lui, écoute `onChange` : sa minuterie suffit.
   * Une aide (suggestion, remplissage, durée) l'appelle aussi : aucun focus
   * ne se perd alors.
   */
  onCommit?: (brief: VideoBrief) => void;
  disabled?: boolean;
  titre?: string;
  aide?: string;
  /** Préfixe des `id` des champs — deux instances sur une même page ne doivent pas se lier. */
  idPrefix?: string;
  /** Le ou les thèmes choisis — active l'assistant de brief. */
  sujets?: ReadonlyArray<string>;
  /** Montre « Durée souhaitée » et « Rythme » (Autopilote). */
  avecDureeRythme?: boolean;
  /** « Changer le thème » dans l'alerte de cohérence. */
  onChangerTheme?: () => void;
  /**
   * A4 v2 — conseil affiché sous la durée (Autopilote avec avatar seul : cible
   * trop courte pour un message complet). Absent : le bloc d'avant, à
   * l'identique. Le bouton ne change la durée que sur un clic explicite.
   */
  conseilDuree?: { message: string; recommandee: number } | null;
}) {
  const listeSujets = useMemo(() => (sujets ?? []).filter((s) => s && s.trim()), [sujets]);
  const profil = useMemo(() => profilBrief(listeSujets), [listeSujets]);
  const placeholders = useMemo(() => placeholdersBrief(listeSujets), [listeSujets]);
  const coherence = useMemo(() => analyserCoherenceBrief(listeSujets, brief), [listeSujets, brief]);
  const [rangs, setRangs] = useState<Partial<Record<BriefKey, number>>>({});
  const [ecartes, setEcartes] = useState<ReadonlySet<string>>(new Set());
  const [aRetablir, setARetablir] = useState<Partial<Record<BriefKey, string>>>({});
  const [annonce, setAnnonce] = useState<string | null>(null);
  const [dureeLibre, setDureeLibre] = useState(false);

  const poser = (cle: BriefKey, valeur: string) => {
    // La borne s'applique à la frappe : au-delà, le brouillon rognerait de
    // toute façon (`sanitizeBrief`), et l'écran doit montrer ce qui sera gardé.
    const suivant: VideoBrief = { ...brief, [cle]: valeur.slice(0, BRIEF_MAX_CHARS) };
    onChange(suivant);
  };

  /** Une aide modifie le brief : on le remonte ET on l'enregistre (aucun blur ne suivra). */
  const appliquer = (suivant: VideoBrief) => {
    onChange(suivant);
    onCommit?.(suivant);
  };

  /** Remplace un champ sur un clic explicite, en gardant de quoi rétablir le texte saisi. */
  const remplacer = (cle: BriefKey, texte: string) => {
    const avant = (brief[cle] ?? '').trim();
    setARetablir((r) => ({ ...r, [cle]: avant || undefined }));
    appliquer({ ...brief, [cle]: texte.slice(0, BRIEF_MAX_CHARS) });
  };

  const suggerer = (cle: BriefKey) => {
    const rang = rangs[cle] ?? 0;
    const s = suggestionChamp(listeSujets, cle, brief[cle], rang);
    setRangs((r) => ({ ...r, [cle]: rang + 1 }));
    if (!s) { setAnnonce(`Aucune autre suggestion pour ${CHAMP_ARTICLE[cle]} : votre texte est conservé.`); return; }
    setAnnonce(null);
    remplacer(cle, s);
  };

  const aiderARemplir = () => {
    const { brief: suivant, remplis } = remplirBrief(listeSujets, brief);
    if (remplis.length === 0) {
      setAnnonce('Tous les champs sont déjà remplis : rien n’a été remplacé. Utilisez « Suggérer » sur un champ pour le changer.');
      return;
    }
    setAnnonce(`${remplis.length} champ${remplis.length > 1 ? 's' : ''} rempli${remplis.length > 1 ? 's' : ''} — modifiez-les librement. Vos textes déjà saisis n’ont pas été touchés.`);
    appliquer(suivant);
  };

  const poserDuree = (duree: number | undefined) => {
    const suivant: VideoBrief = { ...brief };
    if (duree === undefined) delete suivant.duree; else suivant.duree = duree;
    appliquer(suivant);
  };

  const poserRythme = (rythme: VideoBrief['rythme']) => {
    const suivant: VideoBrief = { ...brief };
    if (!rythme || brief.rythme === rythme) delete suivant.rythme; else suivant.rythme = rythme;
    appliquer(suivant);
  };

  const libelleTheme = profil?.libelle ?? null;
  const dureePersonnalisee = dureeLibre || (brief.duree !== undefined && !(DUREES_BRIEF as readonly number[]).includes(brief.duree));
  const chip = (actif: boolean) => `rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
    actif ? 'border-purple-500 bg-purple-500/15 text-white' : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
  }`;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-2.5" data-brief-video data-brief-theme={libelleTheme ?? ''}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{titre}</div>
          <p className="text-[11px] text-gray-500 mt-0.5">{aide}</p>
        </div>
        {profil && (
          <button
            type="button"
            onClick={aiderARemplir}
            disabled={disabled}
            data-brief-aider
            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-purple-500/40 px-2 py-1 text-[11px] text-purple-200 hover:text-white hover:border-purple-400 disabled:opacity-40 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            M’aider à remplir
          </button>
        )}
      </div>
      {profil?.personnalise && (
        <p className="text-[11px] text-gray-500" data-brief-theme-personnalise>
          Thème personnalisé : les exemples reprennent simplement vos mots « {profil.libelle} ».
        </p>
      )}
      {annonce && (
        <p className="text-[11px] text-gray-400" data-brief-annonce role="status">{annonce}</p>
      )}
      {BRIEF_KEYS.map((cle) => {
        const id = `${idPrefix}-${cle}`;
        const valeur = brief[cle] ?? '';
        const conflit = coherence.conflits.find((c) => c.champ === cle);
        const conflitVisible = conflit && !ecartes.has(`${cle}|${valeur.trim()}`) ? conflit : null;
        const rapides = profil && AVEC_RAPIDES.has(cle) && !valeur.trim() ? suggestionsRapides(listeSujets, cle, cle === 'public' ? 5 : 4) : [];
        const retablir = aRetablir[cle];
        return (
          <div key={cle}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor={id} className="block text-xs font-medium text-gray-300">
                {BRIEF_LABELS[cle]}
                <span className="text-gray-600 font-normal"> · facultatif</span>
              </label>
              {profil && (
                <button
                  type="button"
                  onClick={() => suggerer(cle)}
                  disabled={disabled}
                  data-brief-suggerer={cle}
                  className="inline-flex items-center gap-1 text-[11px] text-purple-300 hover:text-white disabled:opacity-40 transition-colors"
                >
                  <Wand2 className="w-3 h-3" />
                  Suggérer
                </button>
              )}
            </div>
            <textarea
              id={id}
              value={valeur}
              onChange={(e) => poser(cle, e.target.value)}
              onBlur={() => onCommit?.(brief)}
              placeholder={placeholders[cle]}
              disabled={disabled}
              rows={cle === 'cta' ? 1 : 2}
              maxLength={BRIEF_MAX_CHARS}
              data-brief-field={cle}
              className="w-full resize-none rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
            />
            {retablir && retablir !== valeur.trim() && (
              <button
                type="button"
                onClick={() => { setARetablir((r) => ({ ...r, [cle]: undefined })); appliquer({ ...brief, [cle]: retablir }); }}
                disabled={disabled}
                data-brief-retablir={cle}
                className="mt-1 text-[11px] text-gray-400 underline hover:text-white disabled:opacity-40"
              >
                Rétablir mon texte
              </button>
            )}
            {rapides.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5" data-brief-rapides={cle}>
                {rapides.map((r) => (
                  <button key={r} type="button" onClick={() => remplacer(cle, r)} disabled={disabled} data-brief-rapide={r} className={chip(false)}>
                    {r}
                  </button>
                ))}
              </div>
            )}
            {conflitVisible && (
              <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-1.5" data-brief-conflit={cle}>
                <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{conflitVisible.message}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => { const s = suggestionChamp(listeSujets, cle, valeur, 0); if (s) remplacer(cle, s); }}
                    disabled={disabled}
                    data-brief-adapter={cle}
                    className="rounded-md border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-200 hover:text-white disabled:opacity-40"
                  >
                    Adapter {CHAMP_ARTICLE[cle]} au thème {libelleTheme}
                  </button>
                  {onChangerTheme && (
                    <button
                      type="button"
                      onClick={onChangerTheme}
                      disabled={disabled}
                      data-brief-changer-theme
                      className="rounded-md border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300 hover:text-white disabled:opacity-40"
                    >
                      Changer le thème
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setEcartes((e) => new Set(e).add(`${cle}|${valeur.trim()}`))}
                    data-brief-continuer={cle}
                    className="rounded-md px-2 py-0.5 text-[11px] text-gray-500 hover:text-white"
                  >
                    Continuer quand même
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {avecDureeRythme && (
        <div className="space-y-2 pt-1" data-brief-duree-rythme>
          <div>
            <p className="text-xs font-medium text-gray-300 mb-1">
              Durée souhaitée<span className="text-gray-600 font-normal"> · facultatif</span>
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {DUREES_BRIEF.map((d) => {
                const actif = brief.duree === d && !dureePersonnalisee;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDureeLibre(false); poserDuree(actif ? undefined : d); }}
                    disabled={disabled}
                    aria-pressed={actif}
                    data-brief-duree={d}
                    className={chip(actif)}
                  >
                    {d} s
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setDureeLibre(true)}
                disabled={disabled}
                aria-pressed={dureePersonnalisee}
                data-brief-duree="personnalisee"
                className={chip(dureePersonnalisee)}
              >
                Personnalisée
              </button>
              {dureePersonnalisee && (
                <input
                  type="number"
                  min={DUREE_BRIEF_MIN}
                  max={DUREE_BRIEF_MAX}
                  value={brief.duree ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!e.target.value) { poserDuree(undefined); return; }
                    if (Number.isFinite(n) && n >= DUREE_BRIEF_MIN && n <= DUREE_BRIEF_MAX) poserDuree(Math.round(n));
                  }}
                  disabled={disabled}
                  aria-label="Durée personnalisée en secondes"
                  data-brief-duree-libre
                  className="w-16 rounded-md bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none px-1.5 py-0.5 text-[11px]"
                />
              )}
            </div>
            {conseilDuree && (
              <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-300" role="status" data-brief-conseil-duree>
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span className="flex-1">{conseilDuree.message}</span>
                <button
                  type="button"
                  onClick={() => { setDureeLibre(false); poserDuree(conseilDuree.recommandee); }}
                  disabled={disabled}
                  data-brief-conseil-duree-appliquer
                  className="shrink-0 rounded-md border border-amber-500/40 px-1.5 py-0.5 text-amber-200 hover:bg-amber-500/10"
                >
                  Passer à {conseilDuree.recommandee} s
                </button>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-300 mb-1">
              Rythme<span className="text-gray-600 font-normal"> · facultatif</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {RYTHMES_BRIEF.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => poserRythme(r)}
                  disabled={disabled}
                  aria-pressed={brief.rythme === r}
                  data-brief-rythme={r}
                  className={chip(brief.rythme === r)}
                >
                  {RYTHME_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SEQUENCE_LABELS: Record<SequenceKey, string> = {
  titre: 'Titre',
  cartes: 'Cartes',
  video: 'Vidéo',
  cta: 'CTA',
};

/**
 * « Ce que la vidéo dira » — le texte EXACT de la narration, par séquence.
 *
 * Ce sont les textes de `SequenceVoicesPanel` (étape Contenu), ni plus ni
 * moins : ce composant ne les recompose pas, il les montre. Le bouton mène
 * là où ils se modifient. Tant qu'aucun contenu n'est généré, il n'y a rien
 * à montrer — et on le dit, sans rien générer.
 */
export function NarrationRecap({
  textes,
  onModifier,
  brief,
}: {
  /** Les textes courants par séquence ; `null` tant que rien n'est généré. */
  textes: Partial<Record<SequenceKey, string>> | null;
  onModifier?: () => void;
  brief?: VideoBrief;
}) {
  const lignes = textes
    ? SEQUENCE_KEYS.map((k) => [k, (textes[k] ?? '').trim()] as const).filter(([, t]) => t.length > 0)
    : [];
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-2" data-brief-narration>
      <div className="text-sm font-medium text-white">Ce que la vidéo dira</div>
      {lignes.length > 0 ? (
        <ul className="space-y-1.5">
          {lignes.map(([k, t]) => (
            <li key={k} className="text-xs" data-brief-narration-sequence={k}>
              <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">{SEQUENCE_LABELS[k]}</span>
              <span className="text-gray-300">{t}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] text-gray-500" data-brief-narration-vide>
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            La narration est pré-remplie à partir du contenu généré à l’étape Contenu
            {briefRempli(brief) ? ', en tenant compte de ce brief' : ''}. Rien n’est généré ni facturé ici.
          </span>
        </p>
      )}
      {onModifier && (
        <button
          type="button"
          onClick={onModifier}
          data-brief-modifier-narration
          className="inline-flex items-center gap-1.5 text-[11px] text-purple-300 hover:text-white transition-colors"
        >
          <Pencil className="w-3 h-3" />
          Modifier le texte de la narration (étape Contenu)
        </button>
      )}
    </div>
  );
}

/**
 * « Ce que dira chaque vidéo » — la version AUTOPILOTE.
 *
 * Ici il n'y a pas de texte exact à montrer : la narration de chaque vidéo
 * est produite à sa production, à partir du brief récurrent et du sujet du
 * jour, et son audio n'existe qu'après le rendu payant. Ce bloc montre donc
 * le sujet, le brief, la durée et le rythme visés, dit si le brief est
 * cohérent avec le thème — et ne génère rien.
 */
export function BriefRecurrentRecap({ brief, sujets, admin = false }: {
  brief: VideoBrief;
  sujets?: ReadonlyArray<string>;
  /** Montre le score brut de cohérence (diagnostic). */
  admin?: boolean;
}) {
  const rempli = briefRempli(brief);
  const liste = (sujets ?? []).filter((s) => s && s.trim());
  const coherence = analyserCoherenceBrief(liste, brief);
  const sujetPrincipal = liste.length > 0 ? liste.map(themeLabel).join(', ') : null;
  return (
    <div
      className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-2"
      data-autopilot-brief-recap
      data-brief-coherence={coherence.niveau}
      data-brief-score={coherence.score ?? ''}
    >
      <div className="text-sm font-medium text-white">Ce que dira chaque vidéo</div>
      <ul className="space-y-1">
        {sujetPrincipal && (
          <li className="text-xs" data-autopilot-brief-recap-sujet>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">{liste.length > 1 ? 'Sujets' : 'Sujet principal'}</span>
            <span className="text-gray-300">{sujetPrincipal}</span>
          </li>
        )}
        {BRIEF_KEYS.filter((k) => (brief[k] ?? '').trim()).map((k) => (
          <li key={k} className="text-xs" data-autopilot-brief-recap-champ={k}>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">{BRIEF_LABELS[k]}</span>
            <span className="text-gray-300">{brief[k]}</span>
          </li>
        ))}
        {brief.duree && (
          <li className="text-xs" data-autopilot-brief-recap-duree>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">Durée cible</span>
            <span className="text-gray-300">{brief.duree} s</span>
          </li>
        )}
        {brief.rythme && (
          <li className="text-xs" data-autopilot-brief-recap-rythme>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1.5">Rythme</span>
            <span className="text-gray-300">{RYTHME_LABELS[brief.rythme]}</span>
          </li>
        )}
      </ul>
      {!rempli && (
        <p className="text-[11px] text-gray-500" data-autopilot-brief-recap-vide>
          Aucun brief : chaque vidéo ne dira que ce que son sujet du jour inspire.
        </p>
      )}
      {coherence.niveau === 'bonne' && (
        <p className="flex items-start gap-1.5 text-[11px] text-emerald-400" data-autopilot-brief-recap-coherent>
          <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Brief cohérent avec {liste.length > 1 ? 'les thèmes choisis' : `le thème ${coherence.sujet}`}</span>
        </p>
      )}
      {coherence.niveau === 'a-verifier' && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300" data-autopilot-brief-recap-incoherent>
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            {coherence.conflits[0]
              ? `Une incohérence a été détectée entre le sujet ${coherence.sujet} et ${CHAMP_ARTICLE[coherence.conflits[0].champ]} « ${brief[coherence.conflits[0].champ]} ».`
              : `Brief à vérifier : il parle peu du sujet ${coherence.sujet}.`}
          </span>
        </p>
      )}
      {admin && coherence.score !== null && (
        <p className="text-[10px] text-gray-500" data-autopilot-brief-recap-score>Score de cohérence (admin) : {coherence.score}/100</p>
      )}
      <p className="flex items-start gap-1.5 text-[11px] text-gray-500" data-autopilot-brief-recap-note>
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          La narration exacte de chaque vidéo est produite à chaque cycle, à partir de ce brief et du
          sujet du jour. Aucun audio n’existe avant le rendu — rien n’est généré ni facturé ici.
        </span>
      </p>
    </div>
  );
}
