'use client';

/**
 * AMÉLIORER MA PHOTO — « Embellir le visage », avant tout fournisseur.
 *
 * 1. L'ORIGINAL est déposé tel quel (`POST /api/avatar/sources/photo`), avec
 *    la progression RÉELLE de l'envoi.
 * 2. Le lissage (0–100 %, continu) est appliqué par le SERVEUR
 *    (`POST /api/avatar/sources/photo/traiter`, ffmpeg, filtre bilatéral —
 *    aucune déformation) ; ce qui s'affiche est le fichier qui partira.
 * 3. Avant / Après, « Voir l'original », « Réinitialiser » (= l'original).
 *
 * L'original n'est jamais modifié. Aucun fournisseur n'est appelé ici :
 * « Utiliser cette photo » rend les deux clés au parcours (`onPret`).
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react';
import ProgressStatus from '@/components/ux/ProgressStatus';
import { detailEnvoi, envoyerFormulaire, type ProgressionEnvoi } from '@/lib/http/envoiAvecProgression';
import { LISSAGE_PAR_DEFAUT, libelleLissage } from '@/lib/avatar/preparation-source-regles';
import CurseurLissage from '@/components/avatar/studio/CurseurLissage';
import { dessinerApercuLisse } from '@/lib/avatar/lissage-apercu';

type Etape = 'envoi' | 'erreur' | 'edition' | 'traitement' | 'resultat';
interface Reponse<T> { success?: boolean; error?: string; data?: T }

const apercu = (cle: string) => `/api/avatar/sources/apercu?cle=${encodeURIComponent(cle)}`;

export default function PreparationPhoto(props: {
  fichier: File;
  onAnnuler: () => void;
  onPret: (r: { cleOriginal: string; cleTraitee: string; lissage: number; largeur: number | null; hauteur: number | null }) => void;
}) {
  const { fichier } = props;
  const [etape, setEtape] = useState<Etape>('envoi');
  const [progression, setProgression] = useState<ProgressionEnvoi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [cleOriginal, setCleOriginal] = useState<string | null>(null);
  const [lissage, setLissage] = useState<number>(LISSAGE_PAR_DEFAUT);
  const [resultat, setResultat] = useState<{ cleTraitee: string; lissage: number } | null>(null);
  const [voirOriginal, setVoirOriginal] = useState(false);
  const [urlLocale, setUrlLocale] = useState<string | null>(null);
  const [dims, setDims] = useState<{ l: number; h: number } | null>(null);
  /** Aperçu EN DIRECT du lissage (même filtre, à la taille affichée) ; « Avant » montre l'original. */
  const imageSource = useRef<HTMLImageElement | null>(null);
  const toile = useRef<HTMLCanvasElement | null>(null);
  const [avantEdition, setAvantEdition] = useState(false);
  const [apercuDirect, setApercuDirect] = useState(false);
  useEffect(() => {
    if (!dims || !imageSource.current || !toile.current) return;
    // Une image par rafraîchissement d'écran : le curseur reste fluide, aucun envoi réseau.
    const id = requestAnimationFrame(() => {
      if (imageSource.current && toile.current) setApercuDirect(dessinerApercuLisse(toile.current, imageSource.current, dims.l, dims.h, lissage));
    });
    return () => cancelAnimationFrame(id);
  }, [lissage, dims]);
  const [essai, setEssai] = useState(0);

  // L'aperçu LOCAL de l'original (le navigateur applique l'orientation de la photo).
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(fichier);
    setUrlLocale(url);
    return () => { URL.revokeObjectURL?.(url); };
  }, [fichier]);

  // 1. L'envoi de l'original.
  useEffect(() => {
    const abandon = new AbortController();
    setEtape('envoi'); setErreur(null); setProgression(null);
    const corps = new FormData();
    corps.append('file', fichier);
    envoyerFormulaire<Reponse<{ cleOriginal: string }>>('/api/avatar/sources/photo', corps, { onProgression: setProgression, signal: abandon.signal })
      .then((r) => {
        if (abandon.signal.aborted) return;
        if (r.ok && r.json?.success && r.json.data?.cleOriginal) { setCleOriginal(r.json.data.cleOriginal); setEtape('edition'); return; }
        setErreur(r.json?.error ?? 'L’envoi a échoué. Réessayez.');
        setEtape('erreur');
      })
      .catch((e: unknown) => {
        if (abandon.signal.aborted) return;
        setErreur(e instanceof Error ? e.message : 'L’envoi a échoué. Réessayez.');
        setEtape('erreur');
      });
    return () => abandon.abort();
  }, [fichier, essai]);

  /** 2. Le rendu RÉEL du lissage choisi, par le serveur. */
  const appliquer = async (l: number) => {
    if (!cleOriginal) return;
    setEtape('traitement'); setErreur(null);
    try {
      const r = await fetch('/api/avatar/sources/photo/traiter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleOriginal, lissage: l }),
      });
      const j = (await r.json().catch(() => null)) as Reponse<{ cleTraitee: string; lissage: number }> | null;
      if (r.ok && j?.success && j.data?.cleTraitee) {
        setResultat({ cleTraitee: j.data.cleTraitee, lissage: typeof j.data.lissage === 'number' ? j.data.lissage : l });
        setVoirOriginal(false);
        setEtape('resultat');
        return;
      }
      setErreur(j?.error ?? 'Le lissage a échoué. Réessayez.');
      setEtape('edition');
    } catch {
      setErreur('Connexion impossible. Réessayez.');
      setEtape('edition');
    }
  };

  /** Réinitialiser : aucun lissage — la photo utilisée redevient l'original, tel quel. */
  const reinitialiser = () => {
    if (!cleOriginal) return;
    setLissage(0);
    setResultat({ cleTraitee: cleOriginal, lissage: 0 });
    setVoirOriginal(false);
    setEtape('resultat');
  };

  const utiliser = () => {
    if (!cleOriginal || !resultat) return;
    props.onPret({ cleOriginal, cleTraitee: resultat.cleTraitee, lissage: resultat.lissage, largeur: dims?.l ?? null, hauteur: dims?.h ?? null });
  };

  return (
    <div data-preparation-photo={etape} className="card-base space-y-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">Améliorer ma photo</h3>
        <button type="button" onClick={props.onAnnuler} aria-label="Annuler" className="rounded-full p-1.5 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>

      {etape === 'envoi' && (
        <div role="status" aria-live="polite" data-preparation-photo-envoi>
          <ProgressStatus
            titre="Envoi de la photo d’origine"
            statut="en_cours"
            {...(progression ? { pourcentage: progression.pourcentage } : {})}
            detail={progression ? detailEnvoi(progression) : 'Démarrage…'}
            note={null}
          />
        </div>
      )}

      {etape === 'erreur' && (
        <div className="space-y-3">
          <p data-preparation-photo-erreur role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{erreur}</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={props.onAnnuler} className="button-secondary py-2.5 text-sm">Annuler</button>
            <button type="button" onClick={() => setEssai((n) => n + 1)} className="button-primary py-2.5 text-sm">Réessayer</button>
          </div>
        </div>
      )}

      {(etape === 'edition' || etape === 'traitement') && (
        <div className="space-y-4">
          <div className="relative mx-auto max-w-xs rounded-2xl overflow-hidden bg-black">
            {urlLocale && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img ref={imageSource} data-preparation-photo-image="originale" src={urlLocale} alt="Votre photo d’origine" onLoad={(e) => setDims({ l: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="w-full object-contain" />
            )}
            {/* L'aperçu lissé, dessiné PAR-DESSUS l'original (qui reste intact dessous). */}
            <canvas ref={toile} data-preparation-photo-apercu-direct={apercuDirect && !avantEdition ? 'visible' : 'masque'} aria-label={`Aperçu du lissage à ${lissage} %`} className={`absolute inset-0 w-full h-full ${apercuDirect && !avantEdition ? '' : 'hidden'}`} />
            <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">{avantEdition || !apercuDirect ? 'Original' : `Aperçu — lissage ${lissage} %`}</span>
          </div>
          <div role="radiogroup" aria-label="Comparer" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-900/70 p-1">
            <button type="button" role="radio" aria-checked={avantEdition} data-preparation-photo-direct="avant" onClick={() => setAvantEdition(true)} className={`rounded-lg py-1.5 text-xs ${avantEdition ? 'bg-studiio-primary text-white' : 'text-gray-300'}`}>Avant — original</button>
            <button type="button" role="radio" aria-checked={!avantEdition} data-preparation-photo-direct="apres" onClick={() => setAvantEdition(false)} className={`rounded-lg py-1.5 text-xs ${!avantEdition ? 'bg-studiio-primary text-white' : 'text-gray-300'}`}>Après — aperçu en direct</button>
          </div>
          {/* LISSAGE DU VISAGE — même filtre que la vidéo : peau lissée, traits intacts. */}
          <div data-preparation-embellir className="rounded-xl bg-gray-900/60 px-4 py-3">
            <CurseurLissage valeur={lissage} onChange={(v) => { setLissage(v); setAvantEdition(false); }} disabled={etape === 'traitement'} onReinitialiser={() => setLissage(0)} />
            <p className="mt-2 text-[11px] text-gray-500">L’aperçu suit le curseur en direct ; « Prévisualiser » produit le fichier réel.</p>
          </div>
          {erreur && <p data-preparation-photo-echec role="alert" className="rounded-xl bg-red-500/10 p-3 text-xs text-red-200">{erreur}</p>}
          {etape === 'traitement' ? (
            <ProgressStatus titre="Embellissement de votre photo" statut="en_cours" detail="Traitement en cours — progression exacte indisponible." note="Votre original reste intact." />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={props.onAnnuler} className="button-secondary py-2.5 text-sm">Annuler</button>
              <button type="button" data-preparation-photo-previsualiser onClick={() => void appliquer(lissage)} className="button-primary py-2.5 text-sm">Prévisualiser</button>
            </div>
          )}
        </div>
      )}

      {etape === 'resultat' && resultat && cleOriginal && (
        <div data-preparation-photo-resultat className="space-y-4">
          <div className="mx-auto max-w-xs rounded-2xl overflow-hidden bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              data-preparation-photo-image={voirOriginal ? 'originale' : 'utilisee'}
              src={apercu(voirOriginal ? cleOriginal : resultat.cleTraitee)}
              alt={voirOriginal ? 'Votre photo d’origine' : 'La photo qui sera utilisée'}
              className="w-full object-contain"
            />
          </div>
          <div role="radiogroup" aria-label="Comparer" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-900/70 p-1">
            <button type="button" role="radio" aria-checked={voirOriginal} data-preparation-photo-voir="original" onClick={() => setVoirOriginal(true)} className={`rounded-lg py-1.5 text-xs ${voirOriginal ? 'bg-studiio-primary text-white' : 'text-gray-300'}`}>Avant — voir l’original</button>
            <button type="button" role="radio" aria-checked={!voirOriginal} data-preparation-photo-voir="apres" onClick={() => setVoirOriginal(false)} className={`rounded-lg py-1.5 text-xs ${!voirOriginal ? 'bg-studiio-primary text-white' : 'text-gray-300'}`}>Après — lissage {resultat.lissage} %</button>
          </div>
          <p className="text-xs text-gray-500" data-preparation-photo-lissage>Lissage : {libelleLissage(resultat.lissage)}. Votre photo d’origine est conservée telle quelle.</p>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" data-preparation-photo-modifier onClick={() => setEtape('edition')} className="button-secondary inline-flex items-center justify-center gap-1 py-2.5 text-xs"><ArrowLeft className="w-3.5 h-3.5" /> Modifier</button>
            <button type="button" data-preparation-photo-reinitialiser onClick={reinitialiser} className="button-secondary inline-flex items-center justify-center gap-1 py-2.5 text-xs"><RotateCcw className="w-3.5 h-3.5" /> Réinitialiser</button>
            <button type="button" data-preparation-photo-utiliser onClick={utiliser} className="button-primary inline-flex items-center justify-center gap-1 py-2.5 text-xs"><Check className="w-3.5 h-3.5" /> Utiliser</button>
          </div>
        </div>
      )}
    </div>
  );
}
