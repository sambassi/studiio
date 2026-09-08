'use client';

import { useEffect, useState } from 'react';
import {
  AudioLines, Music, Volume2, VolumeX, Check, Loader2, RotateCcw, Save, Trash2,
} from 'lucide-react';
import MenuActions, { type ActionMenu } from '@/components/ui/MenuActions';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import BibliothequeAudio from '@/components/creer/BibliothequeAudio';
import { useBanqueAudio } from '@/lib/hooks/useBanqueAudio';
import { cleDepuisUrlMediatheque } from '@/lib/creatif/audio';
import PanneauVoixOff, { type VoixOffEcran } from '@/components/creer/PanneauVoixOff';
import {
  BUCKET_MUSIQUE, RECETTE_AUDIO_DEFAUT, arrondirVolume, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';

/**
 * LOT 2A — LES REGLAGES AUDIO, AVANT « Creer ma video ».
 *
 * ---------------------------------------------------------------------------
 * ⚠️ AUCUN CONTROLE QUI NE SOIT REELLEMENT RENDU
 * ---------------------------------------------------------------------------
 *
 * Les quatre reglages affiches ici — musique, volume musique, son original,
 * volume du son original — sont exactement ceux que `argumentsRendu` sait
 * appliquer, et rien d'autre. Pas de fondu reglable, pas d'egaliseur, pas de
 * ducking : le moteur ne les honore pas, ils ne s'affichent pas.
 *
 * ---------------------------------------------------------------------------
 * DEUX GESTES DISTINCTS, ET C'EST VOULU
 * ---------------------------------------------------------------------------
 *
 * Modifier un curseur ne change QUE la video en cours de creation : la recette
 * part dans le corps de `POST /rendu`. Les habitudes de l'utilisateur ne
 * bougent que s'il clique « Enregistrer comme reglage par defaut », qui ecrit
 * dans `designStyle.audio`. Un reglage d'essai ne doit pas s'installer sans
 * qu'on l'ait demande.
 */

/** Le volume affiche : une part interne, un pourcentage a l'ecran. */
function pourcent(v: number): number {
  return Math.round(v * 100);
}

function Curseur({ libelle, valeur, onChange, desactive }: {
  libelle: string;
  valeur: number;
  onChange: (v: number) => void;
  desactive?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${desactive ? 'opacity-40' : ''}`}>
      <span className="w-24 shrink-0 text-[11px] text-gray-400">{libelle}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pourcent(valeur)}
        disabled={desactive}
        onChange={(e) => onChange(arrondirVolume(Number(e.target.value) / 100))}
        className="min-w-0 flex-1 accent-purple-500"
      />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-gray-300">
        {pourcent(valeur)} %
      </span>
    </label>
  );
}

export interface ReglagesAudioProps {
  /** La recette en cours d'edition. */
  valeur: RecetteAudio;
  onChange: (recette: RecetteAudio) => void;
  /** Enregistre la recette comme defaut du compte. Absent = bouton masque. */
  onEnregistrerDefaut?: (recette: RecetteAudio) => Promise<boolean>;
  /** Les favoris audio du compte — persistes par la bibliotheque creative. */
  favorisAudio?: readonly string[];
  recentsAudio?: readonly string[];
  onBasculerFavoriAudio?: (cle: string) => void;
  desactive?: boolean;
}

export default function ReglagesAudio({
  valeur, onChange, onEnregistrerDefaut, desactive,
  favorisAudio = [], recentsAudio = [], onBasculerFavoriAudio,
}: ReglagesAudioProps) {
  const [mediatheque, setMediatheque] = useState(false);
  const [nomMusique, setNomMusique] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<'inactif' | 'encours' | 'fait'>('inactif');

  const majuscule = (r: Partial<RecetteAudio>) => {
    setEnregistrement('inactif');
    onChange({ ...valeur, ...r });
  };

  /**
   * ⚠️ LA MEDIATHEQUE REND UNE URL ; LE MOTEUR VEUT UNE CLE.
   *
   * `MediaLibrary` a ete ecrite pour des `<img>` et des `<audio>`, elle rend
   * donc l'URL publique. La recette, elle, ne transporte JAMAIS d'URL — c'est
   * la garde qui empeche le moteur d'aller chercher une adresse arbitraire. On
   * retrouve la cle a partir du chemin de stockage, qui est la fin de cette
   * URL, et le serveur reverifie de toute facon qu'elle est bien dans le
   * perimetre du compte.
   */
  const choisir = (url: string, nom: string) => {
    // ⚠️ LA MEME EXTRACTION QUE L'AJOUT A LA BANQUE, ECRITE UNE SEULE FOIS.
    // Deux versions divergeraient au premier caractere encode.
    const cle = cleDepuisUrlMediatheque(url, BUCKET_MUSIQUE);
    if (cle === null) return;
    setNomMusique(nom);
    majuscule({ musique: { bucket: BUCKET_MUSIQUE, cle } });
    setMediatheque(false);
  };

  /* La banque n'est demandee qu'a l'ouverture du panneau audio : une personne
     qui ne touche jamais a la musique ne paie pas une requete pour elle. */
  const banque = useBanqueAudio(!desactive);
  const [ajoutBanque, setAjoutBanque] = useState(false);
  const [retraitActive, setRetraitActive] = useState<string | null>(null);
  /* La voix-off du compte, lue avec la bibliotheque creative — elle vit a
     cote des favoris, pas dans la recette de cette video. */
  const [voixOff, setVoixOff] = useState<VoixOffEcran | null>(null);
  useEffect(() => {
    if (desactive) return;
    let vivant = true;
    void fetch('/api/autopilot/bibliotheque-creative', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => { if (vivant && j?.ok) setVoixOff(j.bibliotheque?.voixOff ?? null); })
      .catch(() => {});
    return () => { vivant = false; };
  }, [desactive]);

  const nomAffiche = valeur.musique === null
    ? null
    : nomMusique ?? valeur.musique.cle.split('/').pop() ?? 'musique';

  /**
   * ⚠️ TOUT CE QUI N'EST PAS UN CURSEUR PART DANS LE « ⋯ ».
   *
   * Choisir, retirer, enregistrer un defaut, reinitialiser : quatre gestes
   * rares. En boutons permanents, ils pesaient plus lourd que les deux
   * reglages qu'on utilise vraiment. Les curseurs restent, eux, parce qu'ils
   * changent le resultat a chaque video.
   */
  const actions: ActionMenu[] = [
    {
      libelle: valeur.musique === null ? 'Choisir une musique' : 'Changer la musique',
      icone: <Music className="h-3.5 w-3.5" />,
      onClick: () => setMediatheque(true),
      desactive,
    },
    {
      libelle: 'Retirer la musique',
      icone: <Trash2 className="h-3.5 w-3.5" />,
      onClick: () => { setNomMusique(null); majuscule({ musique: null }); },
      desactive: desactive || valeur.musique === null,
    },
    ...(onEnregistrerDefaut ? [{
      libelle: enregistrement === 'fait'
        ? 'Réglage par défaut enregistré'
        : 'Enregistrer comme réglage par défaut',
      icone: enregistrement === 'fait'
        ? <Check className="h-3.5 w-3.5" />
        : <Save className="h-3.5 w-3.5" />,
      desactive: desactive || enregistrement === 'encours',
      onClick: async () => {
        setEnregistrement('encours');
        const ok = await onEnregistrerDefaut(valeur);
        setEnregistrement(ok ? 'fait' : 'inactif');
      },
    } as ActionMenu] : []),
    {
      libelle: 'Réinitialiser',
      icone: <RotateCcw className="h-3.5 w-3.5" />,
      onClick: () => { setNomMusique(null); onChange(RECETTE_AUDIO_DEFAUT); setEnregistrement('inactif'); },
      desactive,
    },
  ];

  return (
    <section className="space-y-2" data-reglages-audio>
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500">
          <Music className="h-3 w-3" aria-hidden="true" /> Audio
        </h4>
        <span className="flex items-center gap-1">
          {enregistrement === 'encours' && (
            <Loader2 className="h-3 w-3 animate-spin text-gray-500" aria-hidden="true" />
          )}
          {enregistrement === 'fait' && (
            <Check className="h-3 w-3 text-gray-400" aria-hidden="true" />
          )}
          <MenuActions
            compact
            marqueur="audio"
            etiquette="Options audio"
            titreGroupe="Audio"
            icone={<AudioLines className="h-3.5 w-3.5" />}
            actions={actions}
          />
        </span>
      </div>

      {/* ── LA BANQUE AUDIO ───────────────────────────────────────────
          ⚠️ ELLE PASSE DEVANT LA MEDIATHEQUE. Choisir dans une liste de
          fichiers oblige a se souvenir d'un nom de fichier ; choisir dans une
          banque montre une duree, une ambiance, une forme d'onde, et laisse
          ecouter. La mediatheque reste le moyen d'AJOUTER, pas de choisir. */}
      {/* ⚠️ AFFICHEE MEME VIDE. C'est elle qui porte le bouton d'ajout : la
          masquer quand la banque est vide laissait « Ta banque est vide »
          sans le moindre moyen de la remplir. */}
      <BibliothequeAudio
          pistes={banque.pistes}
          cleActive={valeur.musique?.cle ?? null}
          favoris={favorisAudio}
          recents={recentsAudio}
          onBasculerFavori={onBasculerFavoriAudio}
          onRenommer={banque.renommer}
          onRetirer={(cle) => {
            /* ⚠️ RETIRER LA PISTE ACTIVE SE CONFIRME. Elle disparait du
               montage en cours ; le faire sans un mot donnerait une video
               muette que personne n'a demandee. */
            if (valeur.musique?.cle === cle) { setRetraitActive(cle); return; }
            banque.retirer(cle);
          }}
          onChoisir={(cle) => {
            if (cle === null) { setNomMusique(null); majuscule({ musique: null }); return; }
            setNomMusique(banque.pistes.find((x) => x.cle === cle)?.nom ?? null);
            majuscule({ musique: { bucket: BUCKET_MUSIQUE, cle } });
          }}
          enAnalyse={banque.enAnalyse}
          onMoods={banque.moods}
          onAjouter={() => setAjoutBanque(true)}
        />
      {banque.erreur && (
        <p data-audio-banque-erreur className="text-[10px] text-amber-400">{banque.erreur}</p>
      )}

      {/* ⚠️ LE MEME SELECTEUR QUE PARTOUT, EN MODE AUDIO. Il filtre deja les
          medias, cherche, et sait televerser avec sa progression reelle :
          en ecrire un second aurait fait deux verites pour la meme chose. */}
      <MediaLibrary
        isOpen={ajoutBanque}
        onClose={() => setAjoutBanque(false)}
        mediaType="audio"
        onSelect={(url, nom) => {
          setAjoutBanque(false);
          const cle = cleDepuisUrlMediatheque(url, BUCKET_MUSIQUE);
          /* Un media hors du compartiment audio n'a rien a faire dans la
             banque ; le serveur le refuserait, autant ne pas l'envoyer. */
          if (cle !== null) void banque.ajouter(cle, nom);
        }}
      />

      {retraitActive !== null && (
        <div
          role="alertdialog"
          aria-label="Retirer la musique utilisée"
          data-audio-confirmer-retrait
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2"
        >
          <p className="text-[11px] text-amber-200">
            Cette musique est utilisée dans ton style actuel. La retirer ?
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              data-audio-confirmer-oui
              onClick={() => {
                banque.retirer(retraitActive);
                setNomMusique(null);
                majuscule({ musique: null });
                setRetraitActive(null);
              }}
              className="rounded-lg border border-gray-800 px-2 py-1 text-[10px] text-gray-200"
            >
              Retirer
            </button>
            <button
              type="button"
              data-audio-confirmer-non
              onClick={() => setRetraitActive(null)}
              className="rounded-lg border border-gray-800 px-2 py-1 text-[10px] text-gray-400"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── LA VOIX-OFF ───────────────────────────────────────────────
          ⚠️ APRES LA MUSIQUE, ET DANS LE MEME PANNEAU. Les deux vivent dans
          la meme recette et se melangent dans le meme graphe : les separer en
          deux ecrans obligerait a regler un volume ici et l'autre ailleurs. */}
      <PanneauVoixOff
        voixOff={voixOff}
        utilisee={valeur.voix != null}
        desactive={desactive}
        onEnregistree={(v) => {
          setVoixOff(v);
          // Une voix retiree ne peut plus etre employee : le montage repasse
          // sans voix plutot que de porter une reference morte.
          if (v === null && valeur.voix) majuscule({ voix: null });
        }}
        onUtiliser={(utiliser) => majuscule({
          voix: utiliser && voixOff
            ? { bucket: BUCKET_MUSIQUE, cle: voixOff.cle }
            : null,
        })}
      />

      {/* La musique en une ligne : son nom, ou l'absence dite simplement. */}
      <p
        className="flex items-center gap-1.5 truncate text-[12px] text-gray-300"
        title={nomAffiche ?? undefined}
        data-audio-musique={valeur.musique === null ? 'aucune' : 'choisie'}
      >
        <Music className="h-3 w-3 shrink-0 text-gray-500" aria-hidden="true" />
        <span className="truncate">{nomAffiche ?? 'Aucune musique'}</span>
      </p>

      {/* ⚠️ Le volume ne s'affiche QUE s'il y a une musique : un curseur sans
          source ne reglerait rien, et le moteur l'ignore d'ailleurs. */}
      {valeur.musique !== null && (
        <Curseur
          libelle="Musique"
          valeur={valeur.volumeMusique}
          desactive={desactive}
          onChange={(v) => majuscule({ volumeMusique: v })}
        />
      )}

      {/* ── Le son original ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[11px] text-gray-400">Son original</span>
        <button
          type="button"
          disabled={desactive}
          onClick={() => majuscule({ sonOriginal: !valeur.sonOriginal })}
          aria-pressed={valeur.sonOriginal}
          data-audio-son-original={valeur.sonOriginal ? 'on' : 'off'}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]
            font-medium transition-colors focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-purple-500 disabled:opacity-40 ${valeur.sonOriginal
              ? 'border-purple-500/50 bg-purple-500/10 text-purple-200'
              : 'border-white/10 text-gray-500 hover:text-gray-300'}`}
        >
          {valeur.sonOriginal
            ? <Volume2 className="h-3 w-3" aria-hidden="true" />
            : <VolumeX className="h-3 w-3" aria-hidden="true" />}
          {valeur.sonOriginal ? 'ON' : 'OFF'}
        </button>
      </div>
      {/* Même règle que la musique : pas de curseur sans source. */}
      {valeur.sonOriginal && (
        <Curseur
          libelle="Volume original"
          valeur={valeur.volumeSonOriginal}
          desactive={desactive}
          onChange={(v) => majuscule({ volumeSonOriginal: v })}
        />
      )}

      {mediatheque && (
        <MediaLibrary
          isOpen
          mediaType="audio"
          onClose={() => setMediatheque(false)}
          onSelect={choisir}
        />
      )}
    </section>
  );
}

/** Le point de depart de l'ecran quand le compte n'a rien enregistre. */
export const RECETTE_ECRAN_DEFAUT = RECETTE_AUDIO_DEFAUT;
