'use client';

/**
 * AMÉLIORER MA PHOTO — « Embellir le visage », avant tout fournisseur.
 *
 * 1. L'ORIGINAL est déposé tel quel (`POST /api/avatar/sources/photo`), avec
 *    la progression RÉELLE de l'envoi.
 * 2. Le niveau (Aucun / Naturel / Doux / Lissé) est appliqué par le SERVEUR
 *    (`POST /api/avatar/sources/photo/traiter`, ffmpeg, filtre bilatéral —
 *    aucune déformation) ; ce qui s'affiche est le fichier qui partira.
 * 3. Avant / Après, « Voir l'original », « Réinitialiser » (= l'original).
 *
 * L'original n'est jamais modifié. Aucun fournisseur n'est appelé ici :
 * « Utiliser cette photo » rend les deux clés au parcours (`onPret`).
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react';
import ProgressStatus from '@/components/ux/ProgressStatus';
import { detailEnvoi, envoyerFormulaire, type ProgressionEnvoi } from '@/lib/http/envoiAvecProgression';
import {
  EMBELLISSEMENT_PAR_DEFAUT, LIBELLE_EMBELLISSEMENT, NIVEAUX_EMBELLISSEMENT, type NiveauEmbellissement,
} from '@/lib/avatar/preparation-source-regles';

type Etape = 'envoi' | 'erreur' | 'edition' | 'traitement' | 'resultat';
interface Reponse<T> { success?: boolean; error?: string; data?: T }

const apercu = (cle: string) => `/api/avatar/sources/apercu?cle=${encodeURIComponent(cle)}`;

export default function PreparationPhoto(props: {
  fichier: File;
  onAnnuler: () => void;
  onPret: (r: { cleOriginal: string; cleTraitee: string; embellissement: NiveauEmbellissement; largeur: number | null; hauteur: number | null }) => void;
}) {
  const { fichier } = props;
  const [etape, setEtape] = useState<Etape>('envoi');
  const [progression, setProgression] = useState<ProgressionEnvoi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [cleOriginal, setCleOriginal] = useState<string | null>(null);
  const [niveau, setNiveau] = useState<NiveauEmbellissement>(EMBELLISSEMENT_PAR_DEFAUT);
  const [resultat, setResultat] = useState<{ cleTraitee: string; niveau: NiveauEmbellissement } | null>(null);
  const [voirOriginal, setVoirOriginal] = useState(false);
  const [urlLocale, setUrlLocale] = useState<string | null>(null);
  const [dims, setDims] = useState<{ l: number; h: number } | null>(null);
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

  /** 2. Le rendu RÉEL du niveau choisi, par le serveur. */
  const appliquer = async (n: NiveauEmbellissement) => {
    if (!cleOriginal) return;
    setEtape('traitement'); setErreur(null);
    try {
      const r = await fetch('/api/avatar/sources/photo/traiter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleOriginal, embellissement: n }),
      });
      const j = (await r.json().catch(() => null)) as Reponse<{ cleTraitee: string; embellissement: NiveauEmbellissement }> | null;
      if (r.ok && j?.success && j.data?.cleTraitee) {
        setResultat({ cleTraitee: j.data.cleTraitee, niveau: j.data.embellissement ?? n });
        setVoirOriginal(false);
        setEtape('resultat');
        return;
      }
      setErreur(j?.error ?? 'L’embellissement a échoué. Réessayez.');
      setEtape('edition');
    } catch {
      setErreur('Connexion impossible. Réessayez.');
      setEtape('edition');
    }
  };

  /** Réinitialiser : aucun embellissement — la photo utilisée redevient l'original, tel quel. */
  const reinitialiser = () => {
    if (!cleOriginal) return;
    setNiveau('aucun');
    setResultat({ cleTraitee: cleOriginal, niveau: 'aucun' });
    setVoirOriginal(false);
    setEtape('resultat');
  };

  const utiliser = () => {
    if (!cleOriginal || !resultat) return;
    props.onPret({ cleOriginal, cleTraitee: resultat.cleTraitee, embellissement: resultat.niveau, largeur: dims?.l ?? null, hauteur: dims?.h ?? null });
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
          <div className="mx-auto max-w-xs rounded-2xl overflow-hidden bg-black">
            {urlLocale && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img data-preparation-photo-image="originale" src={urlLocale} alt="Votre photo d’origine" onLoad={(e) => setDims({ l: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="w-full object-contain" />
            )}
          </div>
          {/* EMBELLIR LE VISAGE — même filtre que la vidéo : peau lissée, traits intacts. */}
          <div data-preparation-embellir className="rounded-xl bg-gray-900/60 px-4 py-3 space-y-2">
            <div className="text-sm text-white">Embellir le visage</div>
            <div role="radiogroup" aria-label="Intensité de l’embellissement" className="grid grid-cols-4 gap-1">
              {NIVEAUX_EMBELLISSEMENT.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={niveau === n} data-preparation-embellissement={n} disabled={etape === 'traitement'} onClick={() => setNiveau(n)}
                  className={`rounded-lg py-1.5 text-xs ${niveau === n ? 'bg-studiio-primary text-white' : 'bg-gray-800 text-gray-300 hover:text-white'}`}>
                  {LIBELLE_EMBELLISSEMENT[n]}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400">Lissage léger de la peau, rides et petites imperfections atténuées, teint légèrement homogénéisé. Forme du visage, yeux, nez, bouche et mâchoire ne sont jamais modifiés.</p>
          </div>
          {erreur && <p data-preparation-photo-echec role="alert" className="rounded-xl bg-red-500/10 p-3 text-xs text-red-200">{erreur}</p>}
          {etape === 'traitement' ? (
            <ProgressStatus titre="Embellissement de votre photo" statut="en_cours" detail="Traitement en cours — progression exacte indisponible." note="Votre original reste intact." />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={props.onAnnuler} className="button-secondary py-2.5 text-sm">Annuler</button>
              <button type="button" data-preparation-photo-previsualiser onClick={() => void appliquer(niveau)} className="button-primary py-2.5 text-sm">Prévisualiser</button>
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
            <button type="button" role="radio" aria-checked={!voirOriginal} data-preparation-photo-voir="apres" onClick={() => setVoirOriginal(false)} className={`rounded-lg py-1.5 text-xs ${!voirOriginal ? 'bg-studiio-primary text-white' : 'text-gray-300'}`}>Après — {LIBELLE_EMBELLISSEMENT[resultat.niveau]}</button>
          </div>
          <p className="text-xs text-gray-500">Votre photo d’origine est conservée telle quelle.</p>
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
