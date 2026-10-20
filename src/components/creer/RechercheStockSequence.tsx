'use client';

/**
 * MÉDIAS SUGGÉRÉS — trouver une photo ou une vidéo pour une séquence.
 *
 * ⚠️ ADDITIF. La recherche manuelle de photos (`/api/pexels`) reste intacte ;
 * ce panneau passe par le moteur stock commun (`src/lib/stock`) et n'est
 * MONTÉ qu'à l'ouverture : tant qu'on ne l'ouvre pas, aucune requête ne part.
 *
 * ⚠️ L'UTILISATEUR NE CHOISIT PAS DE FOURNISSEUR. Studiio cherche lui-même
 * là où il faut (photos : toutes les banques, entrelacées et classées ;
 * vidéos : la seule banque qui en sert). Aucun nom de banque sur les cartes
 * ni dans les boutons : il n'apparaît que dans les crédits exigés par leurs
 * conditions d'utilisation — la ligne discrète sous les résultats, et
 * « Informations du média » dans l'aperçu.
 *
 * - Suggestions DÉTERMINISTES (`construireRecherchesStock`, aucun appel IA),
 *   affichées en français ; la requête envoyée reste anglaise. Une saisie
 *   libre en français passe par le même lexique (`traduireRequete`).
 * - Un clic sur une vignette SÉLECTIONNE et prévisualise : jamais d'ajout,
 *   jamais d'onglet ouvert. « Ajouter » ajoute, une fois ; le bouton devient
 *   « Ajouté ».
 * - Photo → arrière-plan de la séquence (un fond existant est signalé :
 *   jamais d'écrasement muet). Vidéo → ajoutée à la suite des rushes ; le
 *   rush principal ne change pas.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Film, ImageIcon, Info, LayoutGrid, Loader2, Play, Plus, Search, X } from 'lucide-react';
import { construireRecherchesStock, traduireRequete, type RoleSequence } from '@/lib/stock/requetes';
import { importerStockClient, rechercherStockClient } from '@/lib/stock/client';
import {
  orientationDuFormat,
  type FormatStock,
  type MediaStock,
  type TypeStock,
} from '@/lib/stock/types';
import ApercuMedia, { formatDuree, type EtatAjoutMedia, type MediaApercu } from './ApercuMedia';

/** Ce que l'on garde d'un média stock choisi : de quoi le créditer et le retrouver. */
export interface MetaStock {
  provider: MediaStock['provider'];
  providerAssetId: string;
  auteur: string;
  sourceUrl: string;
  licence: string;
  attribution: string;
  /**
   * Durée ANNONCÉE par la recherche (s) — information seulement. La durée
   * active d'une vidéo ajoutée est celle MESURÉE à l'import (`loadedmetadata`).
   */
  dureeAnnoncee?: number;
}

export function metaStockDe(m: MediaStock): MetaStock {
  return {
    provider: m.provider,
    providerAssetId: m.providerAssetId,
    auteur: m.auteur,
    sourceUrl: m.sourceUrl,
    licence: m.licence,
    attribution: m.attribution,
  };
}

/** Contenu généré du wizard, réduit à ce que lit la recherche. */
export interface ContenuPourStock {
  title?: string;
  subtitle?: string;
  cards?: Array<{ title?: string; description?: string }>;
  cta?: string;
  ctaSub?: string;
}

/** Le texte qui décrit une séquence : c'est lui qui oriente la recherche. */
export function texteDeSequence(contenu: ContenuPourStock | null | undefined, role: RoleSequence | null): string {
  if (!contenu || !role) return '';
  if (role === 'titre') return [contenu.title, contenu.subtitle].filter(Boolean).join(' ');
  if (role === 'cartes') return (contenu.cards ?? []).map((c) => [c.title, c.description].filter(Boolean).join(' ')).join(' ');
  if (role === 'cta') return [contenu.cta, contenu.ctaSub].filter(Boolean).join(' ');
  if (role === 'video') return [contenu.title, contenu.subtitle].filter(Boolean).join(' ');
  return '';
}

/**
 * Banques d'images : noms et liens des CRÉDITS, rien d'autre. `utm_*` : exigé
 * par les règles d'attribution d'Unsplash.
 */
export const BANQUES: Record<MediaStock['provider'], { nom: string; url: string }> = {
  pexels: { nom: 'Pexels', url: 'https://www.pexels.com' },
  unsplash: { nom: 'Unsplash', url: 'https://unsplash.com/?utm_source=studiio&utm_medium=referral' },
};

/** Libellé lisible d'un média stock — jamais un nom de fichier. */
export function libelleMediaStock(m: Pick<MediaStock, 'type'>): string {
  return m.type === 'video' ? 'Vidéo suggérée' : 'Photo suggérée';
}

/** Un média stock vu par l'aperçu : libellé lisible, crédit à part. */
export function mediaApercuDeStock(m: MediaStock): MediaApercu {
  return {
    type: m.type,
    url: m.type === 'video' ? m.fichierUrl : (m.fichierUrl || m.apercuUrl),
    posterUrl: m.type === 'video' ? (m.apercuUrl || m.vignetteUrl) : undefined,
    libelle: libelleMediaStock(m),
    dureeSecondes: m.dureeSecondes,
    credit: {
      auteur: m.auteur,
      auteurUrl: m.auteurUrl,
      sourceUrl: m.sourceUrl,
      banque: BANQUES[m.provider].nom,
      banqueUrl: BANQUES[m.provider].url,
    },
  };
}

/**
 * « Crédits médias » sous des résultats de banques d'images : exigés par
 * leurs conditions, mais REPLIÉS (motif « Informations du média ») — jamais
 * un nom de fournisseur sur la surface principale. Le lien reste accessible
 * en un clic, au clavier comme à la souris (`<details>` natif).
 */
export function CreditBanques({ attribut, className = '' }: { attribut?: string; className?: string }) {
  return (
    <details {...(attribut ? { [attribut]: '' } : {})} data-credit-media data-media-infos className={`text-[10px] text-gray-600 ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-gray-300">
        <Info className="w-3 h-3" aria-hidden="true" />
        Crédits médias
      </summary>
      <p className="mt-1 pl-4">
        Photos et vidéos fournies par{' '}
        <a href={BANQUES.pexels.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">Pexels</a>
        {' '}et{' '}
        <a href={BANQUES.unsplash.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">Unsplash</a>
      </p>
    </details>
  );
}

type FiltreType = 'tout' | TypeStock;

const LIBELLE_FILTRE: Record<FiltreType, string> = { tout: 'Tout', video: 'Vidéos', photo: 'Photos' };
const ICONE_FILTRE = { tout: LayoutGrid, video: Film, photo: ImageIcon } as const;

/** Commandes que l'aperçu de droite envoie au panneau. */
export interface PanneauStockHandle {
  ajouterSelection: () => void;
  deselectionner: () => void;
}

export interface RechercheStockSequenceProps {
  /** Rôle de la séquence visée (`null` = onglet « Tout » : affiche globale). */
  role: RoleSequence | null;
  /** Libellé lisible de la séquence (« Titre », « Vidéo »…). */
  libelleSequence: string;
  sujet: string;
  objectif?: string | null;
  texte?: string | null;
  format: FormatStock;
  /** Type ouvert d'emblée ; à défaut « Tout » (ou le seul type accepté). */
  typeInitial?: TypeStock;
  /**
   * Types que cette zone accepte. Défaut : photos et vidéos (filtre « Tout »
   * proposé). Arrière-plan / affiche → `['photo']` ; rushes → `['video']`.
   */
  typesAutorises?: TypeStock[];
  /** La séquence a-t-elle déjà un arrière-plan choisi par l'utilisateur ? */
  fondExistant: boolean;
  onUtiliserPhoto: (url: string, meta: MetaStock) => void;
  onAjouterRush: (url: string, nom: string, meta: MetaStock) => void;
  onFermer: () => void;
  /**
   * Sélection courante, remontée à l'aperçu de droite. Fournie ⇒ l'aperçu
   * intégré au panneau ne s'affiche plus qu'en petit écran (`lg:hidden`).
   */
  onSelection?: (m: MediaStock | null, etat: EtatAjoutMedia) => void;
  /** Dans la page, sans fenêtre modale : l'aperçu de droite reste visible. */
  integre?: boolean;
}

const RechercheStockSequence = forwardRef<PanneauStockHandle, RechercheStockSequenceProps>(function RechercheStockSequence(props, ref) {
  const { role, sujet, objectif, texte, format } = props;
  const recherches = useMemo(
    () => construireRecherchesStock({ sujet, objectif, texte, role, format }),
    [sujet, objectif, texte, role, format],
  );
  const autorises: TypeStock[] = props.typesAutorises?.length ? props.typesAutorises : ['video', 'photo'];
  const filtres: FiltreType[] = autorises.length > 1 ? ['tout', ...autorises] : autorises;
  const typeDepart: FiltreType = props.typeInitial && autorises.includes(props.typeInitial)
    ? props.typeInitial
    : autorises.length > 1 ? 'tout' : autorises[0];

  const [filtre, setFiltre] = useState<FiltreType>(typeDepart);
  const premiere = recherches.suggestions[0];
  // Le champ montre du FRANÇAIS ; la requête anglaise vit à part.
  const [saisie, setSaisie] = useState(premiere?.libelle ?? sujet);
  const [suggestionActive, setSuggestionActive] = useState<string | null>(premiere?.requete ?? null);
  const [medias, setMedias] = useState<MediaStock[]>([]);
  const [echec, setEchec] = useState(false);
  const [partiel, setPartiel] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [cherche, setCherche] = useState(false);
  const [selection, setSelection] = useState<MediaStock | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [ajoutes, setAjoutes] = useState<Record<string, true>>({});
  const [message, setMessage] = useState<string | null>(null);
  // Jeton : une recherche plus récente l'emporte, quel que soit l'ordre des réponses.
  const jeton = useRef(0);
  const grilleRef = useRef<HTMLDivElement | null>(null);

  /** Ce que la saisie veut dire pour le moteur : la suggestion, sinon la traduction. */
  const requetePour = (texteSaisi: string): string => {
    const propre = texteSaisi.trim();
    const s = recherches.suggestions.find((x) => x.libelle.toLowerCase() === propre.toLowerCase());
    return s ? s.requete : traduireRequete(propre);
  };

  const lancer = async (requete: string, f: FiltreType) => {
    const propre = requete.trim();
    if (!propre) return;
    const id = ++jeton.current;
    setChargement(true);
    setSelection(null);
    setMessage(null);
    const types: TypeStock[] = f === 'tout' ? autorises : [f];
    // Vidéo : une seule banque en sert — ne pas la demander aux autres.
    // Photo : toutes les banques (défaut du moteur, entrelacées et classées).
    const reponses = await Promise.all(types.map((t) => rechercherStockClient({
      requete: propre,
      type: t,
      format,
      fournisseurs: t === 'video' ? ['pexels'] : undefined,
    })));
    if (id !== jeton.current) return;
    // Plusieurs types : entrelacés (vidéo, photo, vidéo…).
    const listes = reponses.map((r) => r.medias);
    const fusion: MediaStock[] = [];
    const longueur = Math.max(0, ...listes.map((l) => l.length));
    for (let i = 0; i < longueur; i += 1) for (const l of listes) if (i < l.length) fusion.push(l[i]);
    // Le serveur classe déjà selon le format ; ce tri STABLE le garantit à
    // l'écran (les autres orientations restent proposées, en second).
    const voulue = orientationDuFormat(format);
    const tries = [...fusion.filter((m) => m.orientation === voulue), ...fusion.filter((m) => m.orientation !== voulue)];
    const echecs = reponses.flatMap((r) => r.echecs);
    setMedias(tries);
    setEchec(tries.length === 0 && echecs.length > 0);
    setPartiel(tries.length > 0 && echecs.length > 0);
    setCherche(true);
    setChargement(false);
  };

  // L'ouverture EST le geste : on cherche aussitôt la première suggestion.
  useEffect(() => {
    void lancer(premiere?.requete ?? requetePour(saisie), filtre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const etatDe = (m: MediaStock | null): EtatAjoutMedia =>
    !m ? 'pret' : ajoutes[m.id] ? 'ajoute' : enCours === m.id ? 'en-cours' : 'pret';

  // L'aperçu de droite suit la sélection ET son état d'ajout.
  const onSelection = props.onSelection;
  const etatSelection = etatDe(selection);
  useEffect(() => {
    onSelection?.(selection, etatSelection);
  }, [selection, etatSelection, onSelection]);

  const changerFiltre = (f: FiltreType) => {
    if (f === filtre) return;
    setFiltre(f);
    void lancer(suggestionActive ?? requetePour(saisie), f);
  };

  const rechercher = () => {
    const s = recherches.suggestions.find((x) => x.libelle.toLowerCase() === saisie.trim().toLowerCase());
    setSuggestionActive(s ? s.requete : null);
    void lancer(requetePour(saisie), filtre);
  };

  const ajouter = async (m: MediaStock) => {
    if (enCours || ajoutes[m.id]) return;
    setEnCours(m.id);
    setMessage(null);
    try {
      const r = await importerStockClient({ provider: m.provider, type: m.type, providerAssetId: m.providerAssetId });
      if ('erreur' in r) {
        setMessage('Ajout impossible pour le moment. Réessayez ou choisissez un autre média.');
        return;
      }
      const meta = metaStockDe(r.media ?? m);
      if (m.type === 'video') {
        // Le nom VISIBLE dans la liste des rushes : lisible, jamais un nom de
        // fichier — et SANS la durée annoncée par la recherche : la légende et
        // l'infobulle montrent la durée MESURÉE à l'import (une seule vérité).
        props.onAjouterRush(r.url, 'Vidéo suggérée', m.dureeSecondes ? { ...meta, dureeAnnoncee: m.dureeSecondes } : meta);
        setAjoutes((prev) => ({ ...prev, [m.id]: true }));
        setMessage('Vidéo ajoutée à vos rushes et à la Médiathèque.');
      } else {
        props.onUtiliserPhoto(r.url, meta);
        // Une séquence n'a qu'UN arrière-plan : la photo précédente ne l'est plus.
        setAjoutes((prev) => {
          const next: Record<string, true> = {};
          for (const id of Object.keys(prev)) if (id.includes('-video-')) next[id] = true;
          next[m.id] = true;
          return next;
        });
        setMessage(`Photo appliquée à la séquence « ${props.libelleSequence} ».`);
      }
    } finally {
      setEnCours(null);
    }
  };

  const selectionner = (m: MediaStock) => {
    setSelection(m);
    setMessage(null);
  };

  useImperativeHandle(ref, () => ({
    ajouterSelection: () => { if (selection) void ajouter(selection); },
    deselectionner: () => {
      setSelection(null);
      grilleRef.current?.querySelector<HTMLElement>('[data-stock-media]')?.focus();
    },
  }));

  const libelleAjoutSelection = (m: MediaStock) =>
    m.type === 'video' ? 'Ajouter aux rushes' : props.fondExistant ? 'Remplacer l’arrière-plan' : 'Utiliser dans cette séquence';
  const aideAjout = (m: MediaStock) =>
    m.type === 'video'
      ? 'Ajouter cette vidéo à vos rushes'
      : props.fondExistant
        ? `Remplacer l’arrière-plan de la séquence « ${props.libelleSequence} »`
        : `Utiliser comme arrière-plan de la séquence « ${props.libelleSequence} »`;

  const contenu = (
    <div
      data-recherche-stock
      role={props.integre ? 'region' : 'dialog'}
      aria-modal={props.integre ? undefined : true}
      aria-label="Médias suggérés"
      className={props.integre ? '' : 'fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4'}
    >
      <div
        className={`w-full p-4 space-y-3 bg-[#0A0A0F] rounded-xl border border-gray-800 ${props.integre ? '' : 'max-w-lg overflow-y-auto'}`}
        style={props.integre ? undefined : { maxHeight: '90vh' }}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm">
              Médias suggérés
              <span className="ml-1.5 text-gray-500 font-normal">— {props.libelleSequence}</span>
            </h3>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Trouvez rapidement une photo ou une vidéo adaptée à votre contenu.
            </p>
          </div>
          <button
            type="button"
            aria-label="Fermer les médias suggérés"
            title="Fermer"
            onClick={props.onFermer}
            className="p-1 text-gray-400 hover:text-white rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Filtre par TYPE — seulement ceux que la zone accepte. */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Type de média">
          {filtres.map((f) => {
            const Icone = ICONE_FILTRE[f];
            return (
              <button
                key={f}
                type="button"
                data-stock-type={f}
                aria-pressed={filtre === f}
                onClick={() => changerFiltre(f)}
                className={`flex items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                  filtre === f ? 'border-purple-500 bg-purple-600/15 text-white' : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                }`}
              >
                <Icone className="w-3.5 h-3.5" />
                {LIBELLE_FILTRE[f]}
              </button>
            );
          })}
        </div>

        {/* Recherche libre */}
        {/* Étroit (mobile) : le bouton passe sous le champ plutôt que de l'écraser. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative grow basis-48 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={saisie}
              data-stock-requete
              aria-label="Que recherchez-vous ?"
              onChange={(e) => { setSaisie(e.target.value); setSuggestionActive(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rechercher(); } }}
              placeholder="Que recherchez-vous ?"
              className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none pl-8 pr-2.5 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            data-stock-chercher
            onClick={rechercher}
            disabled={chargement}
            className="flex grow sm:grow-0 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-40 transition-colors"
          >
            {chargement ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Rechercher
          </button>
        </div>

        {/* Suggestions — en français ; la requête anglaise reste en coulisse. */}
        {recherches.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-stock-suggestions>
            {recherches.suggestions.map((s) => (
              <button
                key={s.requete}
                type="button"
                data-stock-suggestion={s.requete}
                onClick={() => { setSaisie(s.libelle); setSuggestionActive(s.requete); void lancer(s.requete, filtre); }}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  suggestionActive === s.requete ? 'border-purple-500 text-white' : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                }`}
              >
                {s.libelle}
              </button>
            ))}
          </div>
        )}

        {props.fondExistant && autorises.includes('photo') && (
          <p className="text-[11px] text-amber-400">Cette séquence a déjà un arrière-plan : une photo ajoutée le remplacera.</p>
        )}

        {/* Une banque tombée : discret, jamais bloquant, jamais nommé. */}
        {(echec || partiel) && (
          <p data-stock-echecs className="text-[11px] text-gray-500">
            {echec
              ? 'La recherche est momentanément indisponible. Réessayez dans un instant.'
              : 'Une partie des résultats n’est pas disponible pour le moment.'}
          </p>
        )}

        {/* Grille de cartes */}
        {medias.length > 0 ? (
          <>
            <p className="text-[11px] text-gray-500">Cliquez sur un média pour le prévisualiser avant de l’ajouter.</p>
            <div ref={grilleRef} className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1" data-stock-grille>
              {medias.map((m) => {
                const choisi = selection?.id === m.id;
                const etat = etatDe(m);
                const libelle = libelleMediaStock(m);
                return (
                  <div
                    key={m.id}
                    data-stock-carte={m.id}
                    data-stock-carte-type={m.type}
                    className={`min-w-0 overflow-hidden rounded-lg border bg-gray-900/60 transition-colors ${
                      choisi ? 'border-purple-500' : 'border-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <button
                      type="button"
                      data-stock-media={m.id}
                      data-stock-orientation={m.orientation}
                      onClick={() => selectionner(m)}
                      aria-pressed={choisi}
                      aria-label={`Prévisualiser : ${libelle}${m.type === 'video' && m.dureeSecondes ? `, ${formatDuree(m.dureeSecondes)}` : ''}`}
                      title={libelleMediaStock(m)}
                      className="relative block w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.vignetteUrl} alt="" loading="lazy" className="w-full object-cover" style={{ aspectRatio: '3 / 4' }} />
                      {m.type === 'video' && (
                        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/75 px-1 py-0.5 text-[10px] text-white" data-stock-duree>
                          <Play className="w-2.5 h-2.5" />
                          {formatDuree(m.dureeSecondes)}
                        </span>
                      )}
                      {choisi && (
                        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </button>
                    <div className="p-1.5 space-y-1">
                      <p className="truncate text-[11px] text-gray-300" title={libelleMediaStock(m)}>
                        {libelle}
                      </p>
                      {/* Carte étroite (2 colonnes, mobile) : boutons empilés, libellés entiers. */}
                      <div className="flex flex-col sm:flex-row items-stretch gap-1">
                        <button
                          type="button"
                          data-stock-apercu={m.id}
                          onClick={() => selectionner(m)}
                          aria-label={`Aperçu : ${libelle}`}
                          title="Prévisualiser"
                          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-gray-800 px-1.5 py-1 text-[11px] text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
                        >
                          <Play className="w-3 h-3 shrink-0" />
                          <span className="truncate">Aperçu</span>
                        </button>
                        <button
                          type="button"
                          data-stock-ajouter={m.id}
                          onClick={() => void ajouter(m)}
                          disabled={etat !== 'pret' || (!!enCours && enCours !== m.id)}
                          aria-label={etat === 'ajoute' ? `${libelle} : déjà ajoutée` : aideAjout(m)}
                          title={etat === 'ajoute' ? 'Déjà ajouté' : aideAjout(m)}
                          className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
                            etat === 'ajoute'
                              ? 'bg-emerald-600/20 text-emerald-300'
                              : 'bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40'
                          }`}
                        >
                          {etat === 'en-cours' ? <Loader2 className="w-3 h-3 shrink-0 animate-spin" /> : etat === 'ajoute' ? <Check className="w-3 h-3 shrink-0" /> : <Plus className="w-3 h-3 shrink-0" />}
                          <span className="truncate">{etat === 'ajoute' ? 'Ajouté' : 'Ajouter'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          cherche && !chargement && !echec && (
            <p data-stock-vide className="text-xs text-gray-500 text-center py-4">
              Aucun résultat pour « {saisie} ». Essayez une autre suggestion ou une autre recherche.
            </p>
          )
        )}

        {/* Aperçu dans le panneau : toujours en fenêtre modale ; en page,
            seulement en petit écran (la colonne de droite le montre déjà). */}
        {selection && (
          <div data-stock-selection className={props.onSelection ? 'lg:hidden' : ''}>
            <ApercuMedia
              media={mediaApercuDeStock(selection)}
              format={format}
              etat={etatDe(selection)}
              largeurMax={format === '16:9' ? 420 : 220}
              libelleAjouter={libelleAjoutSelection(selection)}
              onAjouter={() => void ajouter(selection)}
              onRemplacer={() => setSelection(null)}
            />
          </div>
        )}

        {message && <p data-stock-message className="text-[11px] text-gray-400" role="status">{message}</p>}

        {/* Crédit des banques — exigé par leurs conditions, replié. */}
        <CreditBanques attribut="data-stock-credits" />
      </div>
    </div>
  );

  if (props.integre) return contenu;
  if (typeof document === 'undefined') return null;
  return createPortal(contenu, document.body);
});

export default RechercheStockSequence;
