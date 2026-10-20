'use client';

import { useCallback, useState } from 'react';
import { Check, Info, Loader2, Plus, Search, X } from 'lucide-react';
import CarteMedia, { GrilleMedias } from '@/components/medias/CarteMedia';
import { LIBELLES_ORIGINE, creditMedia, origineSuggeree } from '@/lib/medias/libelles';
import { importerStockClient, rechercherStockClient } from '@/lib/stock/client';
import type { FormatStock, MediaStock, TypeStock } from '@/lib/stock/types';
import type { MediaStockRetenu } from '@/lib/autopilot/sources';

/**
 * Rechercher et RETENIR des médias stock pour l'Autopilote — vidéos Pexels,
 * photos Pexels et Unsplash.
 *
 * ⚠️ PAR LES ROUTES STUDIIO UNIQUEMENT. La recherche passe par
 * `/api/stock/recherche` (le moteur commun à Créer), la sélection par
 * `/api/stock/importer` — jamais un appel direct à api.pexels.com ou
 * api.unsplash.com depuis le navigateur.
 *
 *   - vidéo Pexels : importée dans la Médiathèque (URL de stockage Studiio),
 *     elle rejoint aussi la banque de rushes ;
 *   - photo Unsplash : `importer` SIGNALE le téléchargement (règle Unsplash)
 *     et rend l'URL hotlink ; rien n'est recopié ;
 *   - photo Pexels : aucune importation, l'URL Pexels est retenue telle quelle.
 *
 * ⚠️ JAMAIS BLOQUANT. Fournisseur en panne : un message discret, rien d'autre.
 *
 * ⚠️ AUCUN FOURNISSEUR À L'ÉCRAN, AUCUNE NAVIGATION. Un filtre Tout / Vidéos
 * / Photos (jamais un choix de plateforme), des cartes « Vidéo suggérée » /
 * « Photo suggérée » dont le clic ouvre un APERÇU dans la page. L'attribution
 * exigée par les plateformes vit dans « Informations du média » (aperçu de
 * chaque carte, élément `data-credit-media`) — plus de pied « fournisseurs »
 * sur la surface principale.
 */

/** Résultats montrés par recherche libre (vidéos et photos entrelacées). */
export const MAX_RESULTATS_RECHERCHE = 18;

export const MESSAGE_RECHERCHE_INDISPONIBLE = 'Recherche de médias indisponible pour le moment. Réessayez plus tard.';

export function cleMediaStock(m: { provider: string; type: string; providerAssetId: string }): string {
  return `${m.provider}-${m.type}-${m.providerAssetId}`;
}

/**
 * « Vidéo de X sur Pexels » — l'ATTRIBUTION d'un média. Réservée aux crédits
 * (`data-credit-media`) : jamais un libellé principal.
 */
export const libelleAttribution = creditMedia;

type Filtre = 'tout' | TypeStock;

const FILTRES: Array<{ v: Filtre; label: string }> = [
  { v: 'tout', label: 'Tout' },
  { v: 'video', label: 'Vidéos' },
  { v: 'photo', label: 'Photos' },
];

/** Une recherche d'UN type, telle que le moteur commun la sert. */
async function chercherType(type: TypeStock, requete: string, format: FormatStock, page = 1) {
  const r = await rechercherStockClient({
    requete, type, format, fournisseurs: type === 'video' ? ['pexels'] : ['pexels', 'unsplash'], page,
  });
  // Une seule plateforme sert des vidéos : un résultat vidéo d'une autre n'existe pas.
  const medias = r.medias.filter((m) => m.type === type && (type === 'photo' || m.provider === 'pexels'));
  return { medias, echec: r.echecs.length > 0 };
}

/** Vidéos et photos entrelacées — « Tout » montre les deux dès la première ligne. */
function entrelacer(a: MediaStock[], b: MediaStock[]): MediaStock[] {
  const out: MediaStock[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

export default function StockRechercheAutopilote({
  sujet, format, accent, dejaRetenus, onRetenir, titre, onFermer, ident = 'general',
}: {
  sujet: string;
  format: FormatStock;
  accent: string;
  /** Clés (`cleMediaStock`) des médias déjà retenus. */
  dejaRetenus: string[];
  /** Reçoit le média prêt à enregistrer (URL d'import pour une vidéo). */
  onRetenir: (m: MediaStockRetenu) => void;
  titre?: string;
  onFermer?: () => void;
  ident?: string;
}) {
  const [requete, setRequete] = useState(sujet);
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [resultats, setResultats] = useState<MediaStock[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [imports, setImports] = useState<Record<string, 'import' | 'erreur'>>({});

  const chercher = useCallback(async (f: Filtre, q: string) => {
    const texte = q.trim().slice(0, 80);
    if (!texte) return;
    setEnCours(true);
    setMessage(null);
    const types: TypeStock[] = f === 'tout' ? ['video', 'photo'] : [f];
    const r = await Promise.all(types.map((t) => chercherType(t, texte, format)));
    let medias = r.length === 2 ? entrelacer(r[0].medias, r[1].medias) : r[0].medias;
    let echec = r.some((x) => x.echec);
    // Un seul type : une page ne suffit pas à remplir la grille — la suivante complète.
    if (types.length === 1 && !echec && medias.length > 0 && medias.length < MAX_RESULTATS_RECHERCHE) {
      const suite = await chercherType(types[0], texte, format, 2);
      echec = echec || suite.echec;
      medias = [...medias, ...suite.medias.filter((m) => !medias.some((x) => cleMediaStock(x) === cleMediaStock(m)))];
    }
    setResultats(medias.slice(0, MAX_RESULTATS_RECHERCHE));
    if (medias.length === 0) setMessage(echec ? MESSAGE_RECHERCHE_INDISPONIBLE : 'Aucun résultat pour cette recherche.');
    else if (echec) setMessage('Certains résultats sont indisponibles pour le moment.');
    setEnCours(false);
  }, [format]);

  const retenir = useCallback(async (m: MediaStock) => {
    const cle = cleMediaStock(m);
    let url = m.fichierUrl;
    // Vidéo → Médiathèque ; photo Unsplash → téléchargement signalé (règle de la plateforme).
    if (m.type === 'video' || m.provider === 'unsplash') {
      setImports((x) => ({ ...x, [cle]: 'import' }));
      const r = await importerStockClient({ provider: m.provider, type: m.type, providerAssetId: m.providerAssetId });
      if ('erreur' in r || !r.url) {
        setImports((x) => ({ ...x, [cle]: 'erreur' }));
        return;
      }
      url = r.url;
    }
    setImports((x) => { const y = { ...x }; delete y[cle]; return y; });
    onRetenir({
      url,
      type: m.type,
      provider: m.provider,
      providerAssetId: m.providerAssetId,
      auteur: m.auteur,
      sourceUrl: m.sourceUrl,
      licence: m.licence,
      vignetteUrl: m.vignetteUrl,
    });
  }, [onRetenir]);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-2 space-y-2 min-w-0" data-autopilot-stock-recherche={ident}>
      {(titre || onFermer) && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-gray-300 min-w-0 truncate">{titre}</p>
          {onFermer && (
            <button type="button" onClick={onFermer} aria-label="Fermer la recherche" className="shrink-0 text-gray-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex gap-1" role="group" aria-label="Type de média">
        {FILTRES.map((t) => (
          <button
            key={t.v}
            type="button"
            aria-pressed={filtre === t.v}
            onClick={() => { setFiltre(t.v); setResultats(null); setMessage(null); }}
            data-autopilot-stock-mode={t.v}
            className={`rounded px-2 py-0.5 text-[10px] border ${filtre === t.v ? 'border-purple-500 text-white bg-purple-500/10' : 'border-gray-800 text-gray-400 hover:text-white'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-1 min-w-0"
        onSubmit={(e) => { e.preventDefault(); void chercher(filtre, requete); }}
      >
        <input
          type="text"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Que recherchez-vous ?"
          aria-label="Que recherchez-vous ?"
          data-autopilot-stock-requete={ident}
          className="flex-1 min-w-0 rounded border border-gray-800 bg-gray-950 px-1.5 py-1 text-[11px] text-gray-200 placeholder:text-gray-600"
        />
        <button
          type="submit"
          disabled={enCours}
          data-autopilot-stock-lancer={ident}
          className="shrink-0 flex items-center gap-1 rounded border border-gray-800 px-2 py-1 text-[10px] text-gray-300 hover:text-white disabled:opacity-40"
        >
          {enCours ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Rechercher
        </button>
      </form>
      {message && (
        <p className="flex items-start gap-1.5 text-[11px] text-gray-400" data-autopilot-stock-recherche-message>
          <Info className="w-3 h-3 mt-0.5 shrink-0" /> {message}
        </p>
      )}
      {resultats && resultats.length > 0 && (
        <GrilleMedias min={96}>
          {resultats.map((m) => {
            const cle = cleMediaStock(m);
            const deja = dejaRetenus.includes(cle);
            const etat = imports[cle];
            const origine = origineSuggeree(m.type);
            return (
              <li key={cle} className="min-w-0 space-y-1" data-autopilot-stock-resultat={cle}>
                <CarteMedia
                  url={m.type === 'video' ? m.fichierUrl : (m.apercuUrl || m.fichierUrl)}
                  type={m.type}
                  vignetteUrl={m.vignetteUrl}
                  dureeSecondes={m.dureeSecondes}
                  metadonnees={false}
                  origine={origine}
                  credit={{ texte: creditMedia(m), lien: m.sourceUrl }}
                  accent={accent}
                  actions={[deja
                    ? {
                      cle: 'ajoute', libelle: 'Ajouté', icone: Check, variante: 'fait', disabled: true, onClick: () => {},
                      attrs: { 'data-autopilot-stock-ajoute': cle },
                    }
                    : {
                      cle: 'ajouter', libelle: 'Ajouter', icone: Plus, variante: 'principal',
                      onClick: () => { void retenir(m); }, disabled: etat === 'import', enCours: etat === 'import',
                      ariaLabel: `Ajouter cette ${LIBELLES_ORIGINE[origine].toLowerCase()}`,
                      attrs: { 'data-autopilot-stock-retenir': cle },
                    }]}
                />
                {etat === 'erreur' && <p className="text-[10px] text-amber-400" data-autopilot-stock-retenir-erreur>Ajout impossible pour le moment — réessayez.</p>}
              </li>
            );
          })}
        </GrilleMedias>
      )}
    </div>
  );
}
