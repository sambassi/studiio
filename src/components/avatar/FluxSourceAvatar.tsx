'use client';

/**
 * LE PARCOURS D'UNE NOUVELLE SOURCE — « Remplacer cet avatar » (nouvelle
 * VERSION du même avatar) ou « Créer un nouvel avatar » (nouvelle identité).
 *
 *   1. Source        caméra | importer une vidéo | importer une photo
 *   2. Préparation   vidéo : recadrer, couper, améliorer, embellir ; photo : embellir —
 *                    serveur (ffmpeg), non destructif : l'original reste conservé
 *   3. Consentement
 *   4. Récapitulatif ce qui va être envoyé, exactement, avec l'aperçu
 *   5. Lancement     envoi (progression réelle pour une photo), puis la
 *                    progression de la version se suit dans « Mes avatars »
 *
 * Aucune étape ne touche à l'avatar utilisé : le serveur crée une version
 * candidate, et la bascule n'a lieu que sur « Utiliser cette version ».
 *
 * La QUALITÉ (Standard / Qualité / Premium) n'est PAS demandée ici : c'est
 * un réglage de chaque génération vidéo (moteur de rendu), sans effet sur
 * l'entraînement d'une version — elle se choisit dans « Générer la vidéo ».
 */
import { confirmerCreationAvatar, CHAMP_CONFIRMATION_COUT, MESSAGE_ANNULE } from '@/lib/fournisseurs/confirmation-client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, Image as ImageIcon, Clapperboard, X, Check } from 'lucide-react';
import EnregistreurSource from '@/components/avatar/studio/EnregistreurSource';
import PreparationSource from '@/components/avatar/studio/PreparationSource';
import PreparationPhoto from '@/components/avatar/studio/PreparationPhoto';
import ProgressStatus from '@/components/ux/ProgressStatus';
import { envoyerFormulaire, detailEnvoi, type ProgressionEnvoi } from '@/lib/http/envoiAvecProgression';
import { etapesParcoursSource, formatSource, type EtapeParcoursSource } from '@/lib/avatar/progression';
import { libelleLissage, type InfosVideo, type ParametresTraitement } from '@/lib/avatar/preparation-source-regles';
import { useTranslations } from '@/i18n/client';

type Etape = 'choix' | 'camera' | 'preparation' | 'consentement' | 'recapitulatif' | 'envoi';

export const MESSAGE_EMPLACEMENT_VIDEO_PLEIN =
  'Votre emplacement d’avatar vidéo est déjà utilisé. Pour changer de vidéo, utilisez « Remplacer cet avatar » sur votre avatar vidéo : il restera actif pendant la préparation.';

const etapeParcours = (e: Etape): EtapeParcoursSource => (
  e === 'choix' || e === 'camera' ? 'source' : e === 'envoi' ? 'lancement' : e
);

export default function FluxSourceAvatar(props: {
  mode: 'remplacer' | 'nouveau';
  avatar: { id: string; nom: string; type: 'photo' | 'video' } | null;
  capacite: { nouvelAvatarPhoto: boolean; nouvelAvatarVideo: boolean };
  onFermer: () => void;
  onTermine: () => void;
}) {
  const tUi = useTranslations('ui.componentsAvatarFluxSourceAvatar');
  const remplacer = props.mode === 'remplacer' && props.avatar;
  const [type, setType] = useState<'photo' | 'video'>(remplacer ? props.avatar!.type : 'photo');
  const [nom, setNom] = useState(remplacer ? props.avatar!.nom : '');
  const [etape, setEtape] = useState<Etape>('choix');
  const [fichier, setFichier] = useState<File | null>(null);
  /** D'où vient la source : la caméra, ou un fichier importé. */
  const [origine, setOrigine] = useState<'camera' | 'import'>('import');
  const [preparee, setPreparee] = useState<{ cleOriginal: string; cleTraitee: string; infos?: InfosVideo; parametres?: ParametresTraitement } | null>(null);
  /** Photo améliorée : les deux clés (original conservé + photo utilisée), le niveau et les dimensions réelles. */
  const [photoPreparee, setPhotoPreparee] = useState<{ cleOriginal: string; cleTraitee: string; lissage: number; largeur: number | null; hauteur: number | null } | null>(null);
  const [consent, setConsent] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  /** Envoi d'une photo : octets RÉELLEMENT transférés. */
  const [envoi, setEnvoi] = useState<ProgressionEnvoi | null>(null);
  /** Aperçu local d'une photo, et ses dimensions réelles (une fois chargée). */
  const [urlPhoto, setUrlPhoto] = useState<string | null>(null);
  const [dimsPhoto, setDimsPhoto] = useState<{ l: number; h: number } | null>(null);
  const entree = useRef<HTMLInputElement>(null);

  // « Nouvel avatar » vidéo : l'emplacement plein est dit AVANT tout envoi.
  const videoBloquee = props.mode === 'nouveau' && !props.capacite.nouvelAvatarVideo;

  useEffect(() => {
    if (type !== 'photo' || !fichier || typeof URL.createObjectURL !== 'function') { setUrlPhoto(null); return; }
    const url = URL.createObjectURL(fichier);
    setUrlPhoto(url);
    return () => { URL.revokeObjectURL?.(url); };
  }, [fichier, type]);

  const choisirFichier = (f: File | null, depuis: 'camera' | 'import') => {
    if (!f) return;
    setErreur(null);
    setFichier(f);
    setOrigine(depuis);
    setDimsPhoto(null);
    setPhotoPreparee(null);
    // Vidéo ET photo passent par la préparation (embellir) avant le consentement.
    setEtape('preparation');
  };

  const envoyer = async () => {
    if (!consent) return;
    setEtape('envoi'); setErreur(null);
    const fd = new FormData();
    fd.append('consent', 'true');
    fd.append('mode', props.mode);
    fd.append('name', (nom.trim() || (type === 'video' ? 'Mon avatar vidéo' : 'Mon avatar')).slice(0, 80));
    if (remplacer) fd.append('avatarId', props.avatar!.id);
    try {
      // COÛT FOURNISSEUR (admin) : créer chez HeyGen peut être facturé, sans
      // tarif public — l'avertissement et l'avatar déjà prêt AVANT l'envoi.
      const choix = await confirmerCreationAvatar({ type });
      if (choix === 'annuler' || choix === 'existant') {
        setErreur(choix === 'existant' ? 'Votre avatar existant reste utilisé : aucune nouvelle version créée.' : MESSAGE_ANNULE);
        setEtape('recapitulatif');
        return;
      }
      if (choix === 'continuer') fd.append(CHAMP_CONFIRMATION_COUT, '1');
      let ok: boolean; let j: { success?: boolean; error?: string } | null;
      const cles = type === 'video' ? preparee : photoPreparee;
      if (cles) {
        // La source est DÉJÀ en stockage (préparée) — seules ses clés partent, l'original avec.
        fd.append('cleSource', cles.cleTraitee);
        fd.append('cleOriginal', cles.cleOriginal);
        const r = await fetch('/api/avatar/create', { method: 'POST', body: fd });
        j = await r.json().catch(() => ({}));
        ok = r.ok && !!j?.success;
      } else {
        if (fichier) fd.append('file', fichier);
        setEnvoi({ charges: 0, total: fichier?.size ?? 0, pourcentage: 0 });
        const r = await envoyerFormulaire<{ success?: boolean; error?: string }>('/api/avatar/create', fd, { onProgression: setEnvoi });
        j = r.json;
        ok = r.ok && !!j?.success;
      }
      if (!ok) { setErreur(j?.error ?? 'L’envoi n’a pas abouti.'); setEtape('recapitulatif'); setEnvoi(null); return; }
      props.onTermine();
    } catch {
      setErreur(tUi('connexion_impossible_reessayez'));
      setEtape('recapitulatif');
      setEnvoi(null);
    }
  };

  const parcours = etapesParcoursSource(type);
  const courante = etapeParcours(etape);
  const iCourante = parcours.findIndex((p) => p.cle === courante);
  const libelleSource = origine === 'camera' ? 'Vidéo enregistrée avec la caméra' : type === 'video' ? 'Vidéo importée' : 'Photo importée';
  const format = type === 'video'
    ? formatSource(preparee?.infos?.largeurEffective, preparee?.infos?.hauteurEffective)
    : formatSource(photoPreparee?.largeur ?? dimsPhoto?.l, photoPreparee?.hauteur ?? dimsPhoto?.h);
  const lissage = type === 'video' ? (preparee?.parametres?.amelioration?.lissage ?? 0) : (photoPreparee?.lissage ?? 0);

  return (
    <div data-flux-source={props.mode} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-2xl card-base p-5 space-y-4 bg-[#0A0A0F]">
        <header className="flex items-center justify-between">
          <h3 className="font-semibold">{remplacer ? `Remplacer « ${props.avatar!.nom} » — nouvelle version` : tUi('creer_un_nouvel_avatar')}</h3>
          <button type="button" aria-label={tUi('fermer')} onClick={props.onFermer} disabled={etape === 'envoi'} className="p-1 text-gray-400 hover:text-white disabled:opacity-40"><X className="w-4 h-4" /></button>
        </header>

        {/* Où l'on en est dans le parcours. */}
        <ol data-flux-etapes className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" aria-label={tUi('etapes')}>
          {parcours.map((p, i) => (
            <li key={p.cle} data-flux-etape={p.cle} data-flux-etape-etat={i < iCourante ? 'terminee' : i === iCourante ? 'courante' : 'a_venir'}
              aria-current={i === iCourante ? 'step' : undefined}
              className={`flex items-center gap-1 ${i < iCourante ? 'text-emerald-300' : i === iCourante ? 'text-white font-medium' : 'text-gray-500'}`}>
              {i < iCourante ? <Check className="w-3 h-3" aria-hidden /> : <span className={`w-2 h-2 rounded-full inline-block ${i === iCourante ? 'bg-studiio-primary' : 'border border-gray-600'}`} aria-hidden />}
              {i + 1}. {p.libelle}
            </li>
          ))}
        </ol>

        {remplacer && (
          <p data-flux-rassurance className="text-xs text-gray-300 rounded-lg bg-gray-900/60 p-2.5">
            {tUi('votre_avatar_actuel_reste_utilise_dans')}
          </p>
        )}

        {erreur && <div data-flux-erreur role="alert" className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 text-xs text-red-200">{erreur}</div>}

        {etape === 'choix' && (
          <div className="space-y-4">
            {props.mode === 'nouveau' && (
              <label className="block text-xs text-gray-400">
                Nom de l’avatar
                <input data-flux-nom value={nom} onChange={(e) => setNom(e.target.value)} maxLength={80} placeholder="Ex. Bassi studio" className="mt-1 w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-white" />
              </label>
            )}
            {!remplacer && (
              <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Type d’avatar">
                {([
                  { id: 'photo' as const, Icon: ImageIcon, titre: 'À partir d’une photo', bloque: false },
                  { id: 'video' as const, Icon: Clapperboard, titre: 'À partir d’une vidéo', bloque: videoBloquee },
                ]).map(({ id, Icon, titre, bloque }) => (
                  <button key={id} type="button" role="radio" aria-checked={type === id} disabled={bloque} data-flux-type={id}
                    onClick={() => setType(id)}
                    className={`rounded-xl p-3 text-left text-sm ${bloque ? 'opacity-40 cursor-not-allowed bg-gray-900' : type === id ? 'bg-studiio-primary/20 ring-1 ring-studiio-primary/50' : 'bg-gray-900/60 hover:bg-gray-800/70'}`}>
                    <Icon className="w-4 h-4 mb-1.5" />{titre}
                  </button>
                ))}
              </div>
            )}
            {remplacer && (
              <p data-flux-type-fixe className="text-xs text-gray-400">
                {type === 'video' ? tUi('avatar_video_la_nouvelle_version_part') : tUi('avatar_photo_la_nouvelle_version_part')}
              </p>
            )}
            {!remplacer && videoBloquee && (
              <p data-emplacement-plein className="text-xs text-amber-200">{MESSAGE_EMPLACEMENT_VIDEO_PLEIN}</p>
            )}

            {type === 'video' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" data-flux-enregistrer onClick={() => setEtape('camera')} className="rounded-xl p-4 text-left bg-gray-900/60 hover:bg-gray-800/70">
                  <Camera className="w-5 h-5 mb-2 text-purple-300" /><div className="text-sm font-medium">{tUi('enregistrer_avec_la_camera')}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{tUi('guide_pas_a_pas')}</div>
                </button>
                <button type="button" data-flux-importer onClick={() => entree.current?.click()} className="rounded-xl p-4 text-left bg-gray-900/60 hover:bg-gray-800/70">
                  <Upload className="w-5 h-5 mb-2 text-purple-300" /><div className="text-sm font-medium">{tUi('importer_une_video')}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{tUi('mp4_webm_ou_mov_15_s_a_10_min')}</div>
                </button>
              </div>
            ) : (
              <button type="button" data-flux-importer onClick={() => entree.current?.click()} className="w-full rounded-xl border-2 border-dashed border-gray-700 hover:border-studiio-primary p-6 text-sm text-gray-300">
                <Upload className="w-5 h-5 mx-auto mb-2 text-purple-300" aria-hidden />
                {tUi('importer_une_photo_portrait_net_de_fac')}
              </button>
            )}
            <input ref={entree} type="file" className="hidden"
              accept={type === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp'}
              onChange={(e) => { choisirFichier(e.target.files?.[0] ?? null, 'import'); e.target.value = ''; }} />
          </div>
        )}

        {etape === 'camera' && (
          <EnregistreurSource
            mp4Requis={false}
            onUtiliser={(f) => choisirFichier(f, 'camera')}
            onImporterAlaPlace={() => { setEtape('choix'); setTimeout(() => entree.current?.click(), 0); }}
          />
        )}

        {etape === 'preparation' && fichier && type === 'photo' && (
          <PreparationPhoto
            fichier={fichier}
            onAnnuler={() => { setFichier(null); setEtape('choix'); }}
            onPret={(r) => { setPhotoPreparee(r); setEtape('consentement'); }}
          />
        )}

        {etape === 'preparation' && fichier && type === 'video' && (
          <PreparationSource
            fichier={fichier}
            onAnnuler={() => { setFichier(null); setEtape('choix'); }}
            onPret={(r) => { setPreparee({ cleOriginal: r.cleOriginal, cleTraitee: r.cleTraitee, infos: r.infos, parametres: r.parametres }); setEtape('consentement'); }}
          />
        )}

        {etape === 'consentement' && (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" data-flux-consentement checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-purple-500" />
              <span>{tUi('je_certifie_etre_la_personne_qui_appar')} {type === 'video' ? tUi('video') : 'photo'} {tUi('et_j_accepte_qu_elle_serve_a_creer_mon')}</span>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEtape(fichier ? 'preparation' : 'choix'); }} className="button-secondary !min-h-[36px] text-sm">{tUi('modifier')}</button>
              <button type="button" data-flux-continuer disabled={!consent} onClick={() => setEtape('recapitulatif')} className="button-primary !min-h-[36px] text-sm disabled:opacity-40">
                {tUi('continuer_vers_le_recapitulatif')}
              </button>
            </div>
          </div>
        )}

        {/* RÉCAPITULATIF — ce qui va être envoyé, exactement, AVANT tout entraînement. */}
        {(etape === 'recapitulatif' || etape === 'envoi') && (
          <div data-flux-recapitulatif className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
              <div data-flux-recap-apercu className="rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-80">
                {type === 'video' && preparee ? (
                  <video src={`/api/avatar/sources/apercu?cle=${encodeURIComponent(preparee.cleTraitee)}`} controls playsInline preload="metadata" className="w-full max-h-80 object-contain" />
                ) : type === 'photo' && photoPreparee ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={`/api/avatar/sources/apercu?cle=${encodeURIComponent(photoPreparee.cleTraitee)}`} alt={tUi('la_photo_qui_sera_envoyee')} className="w-full max-h-80 object-contain" />
                ) : urlPhoto ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={urlPhoto} alt={tUi('apercu_de_la_source')} onLoad={(e) => setDimsPhoto({ l: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="w-full max-h-80 object-contain" />
                ) : (
                  <span className="p-6 text-xs text-gray-400">{tUi('apercu_indisponible')}</span>
                )}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm content-start">
                <dt className="text-gray-500">Avatar</dt><dd data-flux-recap="avatar" className="text-white">{nom.trim() || (type === 'video' ? tUi('mon_avatar_video') : tUi('mon_avatar'))}</dd>
                <dt className="text-gray-500">{tUi('operation')}</dt><dd data-flux-recap="operation">{remplacer ? 'Nouvelle version de cet avatar' : tUi('nouvel_avatar_identite_separee')}</dd>
                <dt className="text-gray-500">Source</dt><dd data-flux-recap="source">{libelleSource}</dd>
                <dt className="text-gray-500">Format</dt><dd data-flux-recap="format">{format ?? 'Inconnu'}</dd>
                <dt className="text-gray-500">Lissage</dt><dd data-flux-recap="embellissement">{libelleLissage(lissage)}</dd>
                <dt className="text-gray-500">Consentement</dt><dd data-flux-recap="consentement">{consent ? tUi('certifie') : tUi('a_certifier')}</dd>
                <dt className="text-gray-500">{tUi('qualite')}</dt><dd data-flux-recap="qualite" className="text-gray-400">{tUi('choisie_a_chaque_generation_de_video')}</dd>
              </dl>
            </div>
            {(type === 'video' ? preparee : photoPreparee) && <p className="text-xs text-gray-500">Votre {type === 'video' ? tUi('video') : 'photo'} {tUi('d_origine_est_conservee_telle_quelle_a')}</p>}

            {etape === 'envoi' ? (
              type === 'photo' && envoi ? (
                <ProgressStatus
                  titre="Envoi de votre photo"
                  statut="en_cours"
                  pourcentage={envoi.pourcentage}
                  detail={detailEnvoi(envoi)}
                  note={envoi.pourcentage >= 100 ? 'Envoi terminé — Studiio crée la nouvelle version et la confie au service de génération…' : null}
                />
              ) : (
                <ProgressStatus
                  titre={remplacer ? 'Création de la nouvelle version' : 'Création de votre avatar'}
                  statut="en_cours"
                  description={tUi('enregistrement_de_la_source_et_envoi_a')}
                  detail="Progression exacte indisponible."
                  note="L’entraînement se suivra ensuite dans « Mes avatars »."
                />
              )
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={() => setEtape('consentement')} className="button-secondary !min-h-[36px] text-sm">{tUi('modifier')}</button>
                <button type="button" data-flux-envoyer disabled={!consent} onClick={() => void envoyer()} className="button-primary !min-h-[36px] text-sm disabled:opacity-40">
                  {remplacer ? tUi('creer_cette_nouvelle_version') : tUi('creer_mon_avatar')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
