'use client';

/**
 * LE PARCOURS D'UNE NOUVELLE SOURCE — « Remplacer cet avatar » ou « Créer un
 * nouvel avatar ».
 *
 *   vidéo : Enregistrer maintenant | Importer une vidéo
 *           → préparation (recadrage, rotation, coupe, amélioration légère,
 *             contrôle) → consentement → envoi d'une VERSION CANDIDATE
 *   photo : Importer une photo → consentement → envoi
 *
 * Aucune étape ne touche à l'avatar utilisé : c'est le serveur qui crée une
 * version candidate, et la bascule n'a lieu que sur « Utiliser cette version ».
 */
import { useRef, useState } from 'react';
import { Camera, Upload, Image as ImageIcon, Clapperboard, Loader2, X } from 'lucide-react';
import EnregistreurSource from '@/components/avatar/studio/EnregistreurSource';
import PreparationSource from '@/components/avatar/studio/PreparationSource';

type Etape = 'choix' | 'camera' | 'preparation' | 'consentement' | 'envoi';

export const MESSAGE_EMPLACEMENT_VIDEO_PLEIN =
  'Votre emplacement d’avatar vidéo est déjà utilisé. Pour changer de vidéo, utilisez « Remplacer cet avatar » sur votre avatar vidéo : il restera actif pendant la préparation.';

export default function FluxSourceAvatar(props: {
  mode: 'remplacer' | 'nouveau';
  avatar: { id: string; nom: string; type: 'photo' | 'video' } | null;
  capacite: { nouvelAvatarPhoto: boolean; nouvelAvatarVideo: boolean };
  onFermer: () => void;
  onTermine: () => void;
}) {
  const remplacer = props.mode === 'remplacer' && props.avatar;
  const [type, setType] = useState<'photo' | 'video'>(remplacer ? props.avatar!.type : 'photo');
  const [nom, setNom] = useState(remplacer ? props.avatar!.nom : '');
  const [etape, setEtape] = useState<Etape>('choix');
  const [fichier, setFichier] = useState<File | null>(null);
  const [preparee, setPreparee] = useState<{ cleOriginal: string; cleTraitee: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const entree = useRef<HTMLInputElement>(null);

  // « Nouvel avatar » vidéo : l'emplacement plein est dit AVANT tout envoi.
  const videoBloquee = props.mode === 'nouveau' && !props.capacite.nouvelAvatarVideo;

  const choisirFichier = (f: File | null) => {
    if (!f) return;
    setErreur(null);
    setFichier(f);
    if (type === 'video') setEtape('preparation');
    else setEtape('consentement');
  };

  const envoyer = async () => {
    if (!consent) return;
    setEtape('envoi'); setErreur(null);
    const fd = new FormData();
    fd.append('consent', 'true');
    fd.append('mode', props.mode);
    fd.append('name', (nom.trim() || (type === 'video' ? 'Mon avatar vidéo' : 'Mon avatar')).slice(0, 80));
    if (remplacer) fd.append('avatarId', props.avatar!.id);
    if (type === 'video' && preparee) {
      fd.append('cleSource', preparee.cleTraitee);
      fd.append('cleOriginal', preparee.cleOriginal);
    } else if (fichier) {
      fd.append('file', fichier);
    }
    try {
      const r = await fetch('/api/avatar/create', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) { setErreur(j?.error ?? 'L’envoi n’a pas abouti.'); setEtape('consentement'); return; }
      props.onTermine();
    } catch {
      setErreur('Connexion impossible. Réessayez.');
      setEtape('consentement');
    }
  };

  return (
    <div data-flux-source={props.mode} role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-2xl card-base p-5 space-y-4 bg-[#0A0A0F]">
        <header className="flex items-center justify-between">
          <h3 className="font-semibold">{remplacer ? `Remplacer « ${props.avatar!.nom} »` : 'Créer un nouvel avatar'}</h3>
          <button type="button" aria-label="Fermer" onClick={props.onFermer} className="p-1 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </header>

        {remplacer && (
          <p data-flux-rassurance className="text-xs text-gray-300 rounded-lg bg-gray-900/60 p-2.5">
            Votre avatar actuel reste utilisé dans Créer et l’Autopilote pendant la préparation. Vous choisirez ensuite d’utiliser la nouvelle version ou de garder l’actuelle.
          </p>
        )}

        {erreur && <div data-flux-erreur className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 text-xs text-red-200">{erreur}</div>}

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
                    className={`rounded-xl p-3 text-left text-sm ${bloque ? 'opacity-40 cursor-not-allowed bg-gray-900' : type === id ? 'bg-purple-600/20 ring-1 ring-purple-500/50' : 'bg-gray-900/60 hover:bg-gray-800/70'}`}>
                    <Icon className="w-4 h-4 mb-1.5" />{titre}
                  </button>
                ))}
              </div>
            )}
            {!remplacer && videoBloquee && (
              <p data-emplacement-plein className="text-xs text-amber-200">{MESSAGE_EMPLACEMENT_VIDEO_PLEIN}</p>
            )}

            {type === 'video' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" data-flux-enregistrer onClick={() => setEtape('camera')} className="rounded-xl p-4 text-left bg-gray-900/60 hover:bg-gray-800/70">
                  <Camera className="w-5 h-5 mb-2 text-purple-300" /><div className="text-sm font-medium">Enregistrer maintenant</div>
                  <div className="text-xs text-gray-500 mt-0.5">Avec votre caméra, guidé pas à pas</div>
                </button>
                <button type="button" data-flux-importer onClick={() => entree.current?.click()} className="rounded-xl p-4 text-left bg-gray-900/60 hover:bg-gray-800/70">
                  <Upload className="w-5 h-5 mb-2 text-purple-300" /><div className="text-sm font-medium">Importer une vidéo</div>
                  <div className="text-xs text-gray-500 mt-0.5">MP4, WebM ou MOV, 15 s à 10 min</div>
                </button>
              </div>
            ) : (
              <button type="button" data-flux-importer onClick={() => entree.current?.click()} className="w-full rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500 p-6 text-sm text-gray-300">
                Choisir une photo (portrait net, de face, bien éclairé)
              </button>
            )}
            <input ref={entree} type="file" className="hidden"
              accept={type === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp'}
              onChange={(e) => { choisirFichier(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </div>
        )}

        {etape === 'camera' && (
          <EnregistreurSource
            mp4Requis={false}
            onUtiliser={(f) => choisirFichier(f)}
            onImporterAlaPlace={() => { setEtape('choix'); setTimeout(() => entree.current?.click(), 0); }}
          />
        )}

        {etape === 'preparation' && fichier && (
          <PreparationSource
            fichier={fichier}
            onAnnuler={() => { setFichier(null); setEtape('choix'); }}
            onPret={(r) => { setPreparee({ cleOriginal: r.cleOriginal, cleTraitee: r.cleTraitee }); setEtape('consentement'); }}
          />
        )}

        {(etape === 'consentement' || etape === 'envoi') && (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" data-flux-consentement checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-purple-500" />
              <span>Je certifie être la personne qui apparaît dans cette {type === 'video' ? 'vidéo' : 'photo'} et j’accepte qu’elle serve à créer mon avatar.</span>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setEtape(type === 'video' && fichier ? 'preparation' : 'choix'); }} className="rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-2 text-sm">Modifier</button>
              <button type="button" data-flux-envoyer disabled={!consent || etape === 'envoi'} onClick={() => void envoyer()} className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 px-3 py-2 text-sm font-medium">
                {etape === 'envoi' && <Loader2 className="w-4 h-4 animate-spin" />}
                {remplacer ? 'Préparer la nouvelle version' : 'Créer mon avatar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
