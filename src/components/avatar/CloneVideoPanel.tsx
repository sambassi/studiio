'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Film, Loader2, Upload, Video, X, Library, Circle, Square,
} from 'lucide-react';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import { cleDepuisUrlMediatheque } from '@/lib/creatif/audio';
import { CONSEILS_CAPTURE, type VerdictQualite } from '@/lib/avatar/qualite';
import { TEXTE_CONSENTEMENT, ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';
import { estEtatPret } from '@/lib/avatar/etats';

/**
 * A_8c — CRÉER MON CLONE VIDÉO.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CET ÉCRAN CHANGE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Le parcours principal n'est plus « animer une photo ». Un clone crédible
 * s'entraîne sur une VRAIE vidéo de la personne — deux à cinq minutes, où elle
 * parle, bouge la tête, sourit. C'est ce que cet écran demande, et il le dit
 * avant de demander quoi que ce soit d'autre.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ CE QUE STUDIIO MESURE, ET CE QU'IL CONSEILLE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Durée, dimensions, cadence, présence du son, lisibilité : mesurés côté
 * serveur par ffprobe, et affichés comme des verdicts.
 *
 * Lumière, cadrage, naturel des gestes : personne ne les mesure. Ils sont
 * affichés comme CONSEILS, séparément. Annoncer « éclairage ✓ » sans avoir
 * rien regardé serait une mesure inventée, et elle serait crue.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN ENTRAÎNEMENT N'EST LANCÉ ICI
 * ═════════════════════════════════════════════════════════════════════════
 *
 * L'écran s'arrête à « Vidéo prête ». Écrire « Clone créé » alors qu'aucun
 * modèle n'existe serait le pire des retours : celui qui a l'air d'un succès.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A_8e — ⚠️ ET AUCUN APERÇU N'EST MONTRÉ TANT QU'IL N'EN EXISTE PAS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * La tentation, à cet endroit, est d'occuper le vide : un mannequin, une voix
 * générique, une vignette « à titre indicatif ». Ce serait montrer à quelqu'un
 * un visage qui n'est pas le sien en lui laissant croire que c'est le sien.
 *
 * Donc : la seule vidéo affichée ici est CELLE QUE LA PERSONNE VIENT DE
 * FOURNIR. Tant que le fournisseur n'a rien produit, l'écran dit ce qui manque
 * — et le bouton « Je valide mon clone » n'apparaît même pas.
 */

interface Props {
  /** L'inscription déjà enregistrée, s'il y en a une. */
  avatarId: string | null;
  statut: string | null;
  /** L'identifiant chez le fournisseur. `null` tant qu'aucun entraînement. */
  providerAvatarId?: string | null;
  /** La date d'acceptation par le propriétaire, si elle a eu lieu. */
  valideLe?: string | null;
  /** Rejoué après une inscription réussie, pour que la page se resynchronise. */
  onInscrit: () => void;
}

type Source = 'aucune' | 'fichier' | 'mediatheque' | 'enregistrement';

const TAILLE_LISIBLE = (o: number) => (o < 1024 * 1024
  ? `${Math.round(o / 1024)} Ko`
  : `${(o / (1024 * 1024)).toFixed(1)} Mo`);

export default function CloneVideoPanel({
  avatarId, statut, providerAvatarId = null, valideLe = null, onInscrit,
}: Props) {
  const [, setSource] = useState<Source>('aucune');
  const [fichier, setFichier] = useState<File | null>(null);
  const [cheminMediatheque, setCheminMediatheque] = useState<string | null>(null);
  const [nomSource, setNomSource] = useState<string | null>(null);
  const [apercuLocal, setApercuLocal] = useState<string | null>(null);
  const [consentement, setConsentement] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [verdict, setVerdict] = useState<VerdictQualite | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [bibliothequeOuverte, setBibliothequeOuverte] = useState(false);
  const [remplacer, setRemplacer] = useState(false);
  const [validation, setValidation] = useState(false);

  // ── L'enregistrement webcam ───────────────────────────────────────────
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [enregistre, setEnregistre] = useState(false);
  const [secondes, setSecondes] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const morceauxRef = useRef<Blob[]>([]);
  const minuterieRef = useRef<NodeJS.Timeout | null>(null);
  const fichierRef = useRef<HTMLInputElement>(null);

  const prete = statut === ETAT_SOURCE_PRETE && avatarId !== null;
  /* ⚠️ « UN CLONE EXISTE » NE VEUT PAS DIRE « LA VIDÉO EST ENVOYÉE ». Ce sont
     deux faits distincts, et les confondre est exactement ce qui produit un
     faux clone à l'écran : un identifiant chez le fournisseur, ou rien. */
  const cloneChezFournisseur = typeof providerAvatarId === 'string' && providerAvatarId.length > 0;
  const cloneEntraine = cloneChezFournisseur && estEtatPret(statut);
  const valide = typeof valideLe === 'string' && valideLe.length > 0;
  const aUneInscription = prete || cloneChezFournisseur;

  /* ⚠️ LA CAMÉRA S'ARRÊTE QUAND L'ÉCRAN DISPARAÎT. Sans cela, la diode reste
     allumée après la navigation — et personne ne comprend pourquoi. */
  useEffect(() => () => {
    camera?.getTracks().forEach((t) => t.stop());
    if (minuterieRef.current) clearInterval(minuterieRef.current);
  }, [camera]);

  useEffect(() => {
    if (camera && videoRef.current) videoRef.current.srcObject = camera;
  }, [camera]);

  const reinitialiser = useCallback(() => {
    setFichier(null);
    setCheminMediatheque(null);
    setNomSource(null);
    setVerdict(null);
    setErreur(null);
    if (apercuLocal) URL.revokeObjectURL(apercuLocal);
    setApercuLocal(null);
    setSource('aucune');
  }, [apercuLocal]);

  const preparerCamera = async () => {
    setErreur(null);
    try {
      const flux = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      setCamera(flux);
      setSource('enregistrement');
    } catch {
      /* ⚠️ UN SEUL MESSAGE, PAS UNE BOUCLE DE DEMANDES. Redemander en rafale
         fait basculer le navigateur en refus permanent. */
      setErreur(
        'Studiio n’a pas accès à votre caméra ou à votre micro. '
        + 'Autorisez-les dans votre navigateur, puis réessayez.',
      );
    }
  };

  const demarrer = () => {
    if (!camera) return;
    morceauxRef.current = [];
    const rec = new MediaRecorder(camera, { mimeType: 'video/webm' });
    rec.ondataavailable = (e) => { if (e.data.size > 0) morceauxRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(morceauxRef.current, { type: 'video/webm' });
      const f = new File([blob], 'clone-video.webm', { type: 'video/webm' });
      setFichier(f);
      setNomSource(`Enregistrement — ${TAILLE_LISIBLE(f.size)}`);
      setApercuLocal(URL.createObjectURL(blob));
      camera.getTracks().forEach((t) => t.stop());
      setCamera(null);
    };
    recorderRef.current = rec;
    rec.start();
    setEnregistre(true);
    setSecondes(0);
    minuterieRef.current = setInterval(() => setSecondes((s) => s + 1), 1000);
  };

  const arreter = () => {
    recorderRef.current?.stop();
    setEnregistre(false);
    if (minuterieRef.current) clearInterval(minuterieRef.current);
  };

  const surFichier = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErreur(null);
    setVerdict(null);
    setFichier(f);
    setCheminMediatheque(null);
    setNomSource(`${f.name} — ${TAILLE_LISIBLE(f.size)}`);
    setApercuLocal(URL.createObjectURL(f));
    setSource('fichier');
  };

  const surMediatheque = (url: string, nom: string) => {
    const cle = cleDepuisUrlMediatheque(url, 'media');
    if (!cle) {
      setErreur('Cette vidéo ne vient pas de votre bibliothèque.');
      return;
    }
    setErreur(null);
    setVerdict(null);
    setFichier(null);
    setCheminMediatheque(cle);
    setNomSource(nom);
    setApercuLocal(url);
    setSource('mediatheque');
    setBibliothequeOuverte(false);
  };

  const envoyer = async () => {
    if (!consentement || (!fichier && !cheminMediatheque)) return;
    setEnvoi(true);
    setErreur(null);
    setVerdict(null);
    try {
      const fd = new FormData();
      fd.append('consentement', 'true');
      /* ⚠️ LE FICHIER PART TEL QUEL. Il n'est jamais relu dans un tampon
         React : une capture de cinq minutes pèse plusieurs centaines de
         mégaoctets, et le navigateur n'a aucune raison de la porter en
         mémoire pour l'envoyer. */
      if (fichier) fd.append('fichier', fichier);
      else if (cheminMediatheque) fd.append('cheminMediatheque', cheminMediatheque);

      const res = await fetch('/api/avatar/enrollment', { method: 'POST', body: fd });
      const json = await res.json();
      if (json?.verdict) setVerdict(json.verdict as VerdictQualite);
      if (!res.ok || !json?.success) {
        if (!json?.verdict) setErreur(json?.error ?? 'Votre vidéo n’a pas pu être enregistrée.');
        return;
      }
      reinitialiser();
      setRemplacer(false);
      onInscrit();
    } catch {
      setErreur('Votre vidéo n’a pas pu être envoyée. Vérifiez votre connexion.');
    } finally {
      setEnvoi(false);
    }
  };

  /**
   * « JE VALIDE MON CLONE ».
   *
   * ⚠️ LE REFUS EST UNE RÉPONSE NORMALE, PAS UNE PANNE. Le serveur seul sait
   * si un aperçu réel existe ; il répond 409 avec un motif nommé quand ce
   * n'est pas le cas, et c'est ce motif que la personne lit. Décider ici,
   * dans le navigateur, reviendrait à se fier à un état que n'importe qui
   * peut réécrire.
   */
  const valider = async () => {
    if (!avatarId) return;
    setValidation(true);
    setErreur(null);
    try {
      const res = await fetch(`/api/avatar/${avatarId}/validation`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setErreur(json?.error ?? 'Votre validation n’a pas pu être enregistrée.');
        return;
      }
      onInscrit();
    } catch {
      setErreur('Votre validation n’a pas pu être envoyée. Vérifiez votre connexion.');
    } finally {
      setValidation(false);
    }
  };

  const aUneSource = fichier !== null || cheminMediatheque !== null;

  return (
    <div className="card-base p-6 space-y-5" data-clone-video>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center flex-shrink-0">
          <Video className="w-5 h-5 text-purple-300" />
        </div>
        <div className="min-w-0">
          <h2 className="font-semibold">Créer mon clone vidéo</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Filmez-vous une fois, puis Studiio pourra produire de nouvelles prises
            sans que vous ayez à reprendre la caméra.
          </p>
        </div>
      </div>

      {/* ── Le guide, AVANT de demander la vidéo ────────────────────── */}
      <div className="rounded-xl bg-gray-900/60 p-4 space-y-2" data-clone-guide>
        <p className="text-sm text-gray-200 font-medium">
          Pour un clone réaliste, filmez-vous idéalement 2 à 5 minutes.
        </p>
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
          {CONSEILS_CAPTURE.map((c) => (
            <li key={c} className="flex items-start gap-1.5">
              <span className="text-gray-600 mt-0.5">•</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Où en est ce clone ─────────────────────────────────────── */}
      {aUneInscription && !aUneSource && (
        <div className="space-y-3" data-clone-etat>
          {valide ? (
            <div
              className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"
              data-clone-valide
            >
              <Check className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-emerald-200">Clone validé</div>
                <p className="text-emerald-100/70 mt-0.5">
                  Vous avez accepté que ce clone parle à votre place.
                </p>
              </div>
            </div>
          ) : cloneEntraine ? (
            <div
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3"
              data-clone-a-valider
            >
              <div className="flex items-start gap-3 text-sm">
                <Check className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-emerald-200">Votre clone est prêt</div>
                  <p className="text-emerald-100/70 mt-0.5">
                    Regardez l’aperçu, puis dites-nous s’il vous ressemble.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={valider}
                disabled={validation}
                data-clone-valider
                className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              >
                {validation ? (<><Loader2 className="w-4 h-4 animate-spin" /> Enregistrement…</>)
                  : 'Je valide mon clone'}
              </button>
            </div>
          ) : cloneChezFournisseur ? (
            <div
              className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
              data-clone-entrainement
            >
              <Loader2 className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5 animate-spin" />
              <div className="text-sm">
                <div className="font-medium text-amber-200">Clone en cours de création</div>
                <p className="text-amber-100/70 mt-0.5">
                  Nous vous préviendrons dès qu’un aperçu sera disponible.
                </p>
              </div>
            </div>
          ) : (
            <div
              className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"
              data-clone-prete
            >
              <Check className="w-5 h-5 text-emerald-300 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-emerald-200">Vidéo prête</div>
                <p className="text-emerald-100/70 mt-0.5">
                  Votre vidéo est prête pour créer votre clone. L’entraînement sera
                  activé prochainement.
                </p>
                {/* ⚠️ DIRE CE QUI MANQUE PLUTÔT QUE DE LE REMPLACER. Il n'y a
                    pas d'aperçu, donc l'écran l'annonce — il n'invente ni
                    visage ni voix pour occuper la place. */}
                <p className="text-emerald-100/50 mt-2">
                  Aucun aperçu de votre clone n’existe encore : rien ne sera
                  affiché tant que votre vraie vidéo n’aura pas été générée.
                </p>
              </div>
            </div>
          )}

          {!remplacer && (
            <button
              type="button"
              onClick={() => { setRemplacer(true); setErreur(null); }}
              data-clone-recommencer
              className="text-sm text-gray-400 hover:text-gray-200 underline underline-offset-4"
            >
              Recommencer avec une autre vidéo
            </button>
          )}
          {remplacer && (
            <p className="text-xs text-gray-500" data-clone-remplacement-avis>
              Votre nouvelle vidéo remplacera la précédente, qui sera supprimée.
            </p>
          )}
        </div>
      )}

      {erreur && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{erreur}</span>
        </div>
      )}

      {/* ── Les trois sources ───────────────────────────────────────── */}
      {!aUneSource && !camera && (!aUneInscription || remplacer) && (
        <div className="grid sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={preparerCamera}
            data-clone-enregistrer
            className="rounded-xl border border-gray-800 hover:border-purple-500/60 transition p-4 text-left"
          >
            <Circle className="w-5 h-5 text-purple-300 mb-2" />
            <div className="text-sm font-medium">Enregistrer</div>
            <div className="text-xs text-gray-500 mt-0.5">Avec votre caméra</div>
          </button>
          <button
            type="button"
            onClick={() => fichierRef.current?.click()}
            data-clone-importer
            className="rounded-xl border border-gray-800 hover:border-purple-500/60 transition p-4 text-left"
          >
            <Upload className="w-5 h-5 text-purple-300 mb-2" />
            <div className="text-sm font-medium">Importer</div>
            <div className="text-xs text-gray-500 mt-0.5">Depuis votre ordinateur</div>
          </button>
          <button
            type="button"
            onClick={() => setBibliothequeOuverte(true)}
            data-clone-bibliotheque
            className="rounded-xl border border-gray-800 hover:border-purple-500/60 transition p-4 text-left"
          >
            <Library className="w-5 h-5 text-purple-300 mb-2" />
            <div className="text-sm font-medium">Ma bibliothèque</div>
            <div className="text-xs text-gray-500 mt-0.5">Une vidéo déjà envoyée</div>
          </button>
        </div>
      )}

      <input
        ref={fichierRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        onChange={surFichier}
        className="hidden"
        data-clone-input
      />

      {/* ── L'enregistrement en cours ───────────────────────────────── */}
      {camera && (
        <div className="space-y-3" data-clone-camera>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full rounded-xl bg-black aspect-video object-cover"
          />
          <div className="flex items-center gap-3">
            {!enregistre ? (
              <button
                type="button"
                onClick={demarrer}
                className="rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-medium"
              >
                Démarrer l’enregistrement
              </button>
            ) : (
              <button
                type="button"
                onClick={arreter}
                className="flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-500 px-4 py-2 text-sm font-medium"
              >
                <Square className="w-4 h-4" /> Arrêter
              </button>
            )}
            {enregistre && (
              <span className="text-sm text-gray-300 tabular-nums" data-clone-compteur>
                {Math.floor(secondes / 60)}:{String(secondes % 60).padStart(2, '0')}
              </span>
            )}
            <button
              type="button"
              onClick={() => { camera.getTracks().forEach((t) => t.stop()); setCamera(null); }}
              className="ml-auto text-sm text-gray-400 hover:text-gray-200"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── La source choisie ───────────────────────────────────────── */}
      {aUneSource && (
        <div className="space-y-4" data-clone-source>
          {apercuLocal && (
            <video
              src={apercuLocal}
              controls
              playsInline
              className="w-full rounded-xl bg-black aspect-video object-contain"
            />
          )}
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Film className="w-4 h-4 text-gray-500" />
            <span className="truncate">{nomSource}</span>
            <button
              type="button"
              onClick={reinitialiser}
              className="ml-auto text-gray-400 hover:text-gray-200"
              aria-label="Changer de vidéo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <label className="flex items-start gap-3 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={consentement}
              onChange={(e) => setConsentement(e.target.checked)}
              data-clone-consentement
              className="mt-0.5 accent-purple-600"
            />
            <span>{TEXTE_CONSENTEMENT}</span>
          </label>

          <button
            type="button"
            onClick={envoyer}
            disabled={!consentement || envoi}
            data-clone-envoyer
            className="w-full rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2"
          >
            {envoi ? (<><Loader2 className="w-4 h-4 animate-spin" /> Analyse en cours…</>)
              : 'Utiliser cette vidéo'}
          </button>
        </div>
      )}

      {/* ── Le verdict, critère par critère ─────────────────────────── */}
      {verdict && (
        <div className="rounded-xl border border-gray-800 p-4 space-y-2" data-clone-verdict>
          {verdict.criteres.map((c) => (
            <div key={c.cle} className="flex items-start gap-2 text-sm" data-clone-critere={c.cle}>
              <span
                className={c.gravite === 'succes' ? 'text-emerald-400'
                  : c.gravite === 'avertissement' ? 'text-amber-400' : 'text-red-400'}
              >
                {c.gravite === 'succes' ? '✓' : c.gravite === 'avertissement' ? '⚠' : '✕'}
              </span>
              <span className="text-gray-400 w-40 flex-shrink-0">{c.libelle}</span>
              <span className="text-gray-200">{c.message}</span>
            </div>
          ))}
        </div>
      )}

      <MediaLibrary
        isOpen={bibliothequeOuverte}
        onClose={() => setBibliothequeOuverte(false)}
        mediaType="video"
        onSelect={surMediatheque}
      />
    </div>
  );
}
