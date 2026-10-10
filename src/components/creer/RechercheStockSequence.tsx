'use client';

/**
 * RECHERCHE STOCK GUIDÉE — « Rechercher des médias pour cette séquence ».
 *
 * ⚠️ ADDITIF. La recherche manuelle de photos (`/api/pexels`) reste intacte ;
 * ce panneau passe par le moteur stock commun (`src/lib/stock`) et n'est
 * MONTÉ qu'à l'ouverture : tant qu'on ne l'ouvre pas, aucune requête ne part.
 *
 * - Les suggestions viennent de `construireRecherchesStock` (déterministe,
 *   aucun appel IA) : sujet, objectif, texte de la séquence, format.
 * - La grille n'affiche que des VIGNETTES (chargement paresseux) : le fichier
 *   HD d'une vidéo n'est téléchargé qu'à la sélection réelle, côté serveur.
 * - Photo → « Utiliser dans cette séquence » ; si la séquence a déjà un fond,
 *   le bouton devient « Remplacer l’arrière-plan » : jamais d'écrasement muet.
 * - Vidéo (Pexels seulement) → « Ajouter aux rushes » : le serveur l'importe
 *   dans la Médiathèque, le wizard l'AJOUTE à la liste sans toucher au rush
 *   principal.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ExternalLink, Film, ImageIcon, Loader2, Plus, Search, X } from 'lucide-react';
import { construireRecherchesStock, type RoleSequence } from '@/lib/stock/requetes';
import { importerStockClient, rechercherStockClient } from '@/lib/stock/client';
import {
  orientationDuFormat,
  type EchecStock,
  type FormatStock,
  type MediaStock,
  type TypeStock,
} from '@/lib/stock/types';

/** Ce que l'on garde d'un média stock choisi : de quoi le créditer et le retrouver. */
export interface MetaStock {
  provider: MediaStock['provider'];
  providerAssetId: string;
  auteur: string;
  sourceUrl: string;
  licence: string;
  attribution: string;
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

const NOM_FOURNISSEUR: Record<MediaStock['provider'], string> = { pexels: 'Pexels', unsplash: 'Unsplash' };

const MOTIF_ECHEC: Record<EchecStock['motif'], string> = {
  non_configure: 'non configuré',
  quota: 'quota atteint',
  refus: 'accès refusé',
  indisponible: 'indisponible',
};

function duree(s?: number): string {
  if (!s || !Number.isFinite(s)) return '';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
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
  /** Type ouvert d'emblée ; à défaut, celui que suggère la séquence. */
  typeInitial?: TypeStock;
  /** La séquence a-t-elle déjà un arrière-plan choisi par l'utilisateur ? */
  fondExistant: boolean;
  onUtiliserPhoto: (url: string, meta: MetaStock) => void;
  onAjouterRush: (url: string, nom: string, meta: MetaStock) => void;
  onFermer: () => void;
}

export default function RechercheStockSequence(props: RechercheStockSequenceProps) {
  const { role, sujet, objectif, texte, format } = props;
  const recherches = useMemo(
    () => construireRecherchesStock({ sujet, objectif, texte, role, format }),
    [sujet, objectif, texte, role, format],
  );
  const [type, setType] = useState<TypeStock>(props.typeInitial ?? recherches.type);
  const [requete, setRequete] = useState(recherches.requetes[0] ?? sujet);
  const [medias, setMedias] = useState<MediaStock[]>([]);
  const [echecs, setEchecs] = useState<EchecStock[]>([]);
  const [chargement, setChargement] = useState(false);
  const [cherche, setCherche] = useState(false);
  const [selection, setSelection] = useState<MediaStock | null>(null);
  const [action, setAction] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Jeton : une recherche plus récente l'emporte, quel que soit l'ordre des réponses.
  const jeton = useRef(0);

  const lancer = async (q: string, t: TypeStock) => {
    const propre = q.trim();
    if (!propre) return;
    const id = ++jeton.current;
    setChargement(true);
    setSelection(null);
    setMessage(null);
    // Unsplash ne sert pas de vidéo : ne pas le lui demander.
    const r = await rechercherStockClient({
      requete: propre,
      type: t,
      format,
      fournisseurs: t === 'video' ? ['pexels'] : undefined,
    });
    if (id !== jeton.current) return;
    const voulue = orientationDuFormat(format);
    // Le serveur classe déjà selon le format ; ce tri STABLE le garantit à
    // l'écran (les autres orientations restent proposées, en second).
    const tries = [...r.medias.filter((m) => m.orientation === voulue), ...r.medias.filter((m) => m.orientation !== voulue)];
    setMedias(tries);
    setEchecs(r.echecs);
    setCherche(true);
    setChargement(false);
  };

  // L'ouverture EST le geste : on cherche aussitôt la première suggestion.
  useEffect(() => {
    void lancer(requete, type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changerType = (t: TypeStock) => {
    if (t === type) return;
    setType(t);
    void lancer(requete, t);
  };

  const utiliser = async () => {
    const m = selection;
    if (!m || action) return;
    setAction(true);
    setMessage(null);
    try {
      const r = await importerStockClient({ provider: m.provider, type: m.type, providerAssetId: m.providerAssetId });
      if ('erreur' in r) {
        setMessage('Import impossible pour le moment. Réessayez ou choisissez un autre média.');
        return;
      }
      const meta = metaStockDe(r.media ?? m);
      if (m.type === 'video') {
        props.onAjouterRush(r.url, `${NOM_FOURNISSEUR[m.provider]} — ${m.auteur || 'vidéo'}`, meta);
        setMessage('Ajoutée aux rushes et à la Médiathèque.');
      } else {
        props.onUtiliserPhoto(r.url, meta);
        setMessage(`Arrière-plan appliqué à la séquence « ${props.libelleSequence} ».`);
      }
    } finally {
      setAction(false);
    }
  };

  const libelleAction = selection?.type === 'video'
    ? 'Ajouter aux rushes'
    : props.fondExistant ? 'Remplacer l’arrière-plan' : 'Utiliser dans cette séquence';
  const videoImportable = selection?.type !== 'video' || selection.provider === 'pexels';

  const fenetre = (
    <div
      data-recherche-stock
      role="dialog"
      aria-modal="true"
      aria-label="Rechercher des médias pour cette séquence"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-lg card-base p-4 space-y-3 bg-[#0A0A0F] overflow-y-auto" style={{ maxHeight: '90vh' }}>
        <header className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">
            Rechercher des médias pour cette séquence
            <span className="ml-1.5 text-gray-500 font-normal">— {props.libelleSequence}</span>
          </h3>
          <button type="button" aria-label="Fermer" onClick={props.onFermer} className="p-1 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Type */}
        <div className="flex items-center gap-1.5">
          {([
            { id: 'video', label: 'Vidéo', Icone: Film },
            { id: 'photo', label: 'Photo', Icone: ImageIcon },
          ] as const).map(({ id, label, Icone }) => (
            <button
              key={id}
              type="button"
              data-stock-type={id}
              aria-pressed={type === id}
              onClick={() => changerType(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                type === id ? 'border-purple-500 text-white' : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
              }`}
            >
              <Icone className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Suggestions */}
        {recherches.requetes.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-stock-suggestions>
            {recherches.requetes.map((q) => (
              <button
                key={q}
                type="button"
                data-stock-suggestion={q}
                onClick={() => { setRequete(q); void lancer(q, type); }}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  requete === q ? 'border-purple-500 text-white' : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Recherche libre */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={requete}
              data-stock-requete
              onChange={(e) => setRequete(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lancer(requete, type); } }}
              placeholder="Rechercher (en anglais, de préférence)…"
              className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none pl-8 pr-2.5 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            data-stock-chercher
            onClick={() => void lancer(requete, type)}
            disabled={chargement}
            className="rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
          >
            {chargement ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Chercher'}
          </button>
        </div>

        {/* Fournisseurs tombés : discret, jamais bloquant. */}
        {echecs.length > 0 && (
          <p data-stock-echecs className="text-[11px] text-gray-500">
            {echecs.map((e) => `${NOM_FOURNISSEUR[e.provider]} ${MOTIF_ECHEC[e.motif]}`).join(' · ')}
          </p>
        )}

        {/* Grille de vignettes */}
        {medias.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5 max-h-72 overflow-y-auto pr-1" data-stock-grille>
            {medias.map((m) => {
              const choisi = selection?.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  data-stock-media={m.id}
                  data-stock-orientation={m.orientation}
                  onClick={() => { setSelection(m); setMessage(null); }}
                  title={m.attribution}
                  className={`relative overflow-hidden rounded-lg border transition-colors ${
                    choisi ? 'border-purple-500' : 'border-gray-800 hover:border-gray-600'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.vignetteUrl} alt={m.description || ''} loading="lazy" className="w-full object-cover" style={{ aspectRatio: '3 / 4' }} />
                  {m.type === 'video' && (
                    <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/70 px-1 text-[10px] text-white">
                      <Film className="w-2.5 h-2.5" />
                      {duree(m.dureeSecondes)}
                    </span>
                  )}
                  {choisi && (
                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          cherche && !chargement && (
            <p data-stock-vide className="text-xs text-gray-500 text-center py-4">
              Aucun résultat pour « {requete} ». Essayez une autre suggestion ou une autre recherche.
            </p>
          )
        )}

        {/* Sélection : crédit + action */}
        {selection && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3 space-y-2" data-stock-selection>
            <p className="text-[11px] text-gray-400" data-stock-attribution>
              {selection.type === 'video' ? 'Vidéo' : 'Photo'} de {selection.auteur || 'auteur inconnu'} sur{' '}
              <a
                href={selection.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-purple-300 hover:text-white underline"
              >
                {NOM_FOURNISSEUR[selection.provider]}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </p>
            {selection.type === 'photo' && props.fondExistant && (
              <p className="text-[11px] text-amber-400">Cette séquence a déjà un arrière-plan : il sera remplacé.</p>
            )}
            {selection.type === 'video' && (
              <p className="text-[11px] text-gray-500">La vidéo est ajoutée à la suite de vos rushes ; votre rush principal ne change pas.</p>
            )}
            <button
              type="button"
              data-stock-utiliser
              onClick={() => void utiliser()}
              disabled={action || !videoImportable}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-2 text-xs font-medium text-white disabled:opacity-40 transition-colors"
            >
              {action ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : selection.type === 'video' ? <Plus className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
              {libelleAction}
            </button>
          </div>
        )}

        {message && <p data-stock-message className="text-[11px] text-gray-400">{message}</p>}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(fenetre, document.body);
}
