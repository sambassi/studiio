'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Loader2, UserSquare2 } from 'lucide-react';
import { lireEtatJumeau, libelleFournisseurAvatar, type EtatJumeau, type JumeauMode } from '@/lib/creer/jumeau';
import type { SequenceKey } from '@/lib/types/voice';

/**
 * JUMEAU NUMÉRIQUE — le bloc de l'étape Sujet.
 *
 * DEUX intentions explicites, jamais confondues, et l'état tel que le SERVEUR
 * le voit (`GET /api/creer/jumeau`) :
 *
 *   « Utiliser ma voix clonée » — narration seulement. La voix du jumeau
 *   devient la voix TTS des séquences (Titre, Cartes, CTA) : le bloc pose
 *   l'identifiant Studiio `elevenlabs-…` de cette voix via `onVoixJumeau`. La
 *   correspondance voix du contrat (`voix.id` = identifiant DE COMPTE) ↔ voix
 *   du compte (`GET /api/voice/clone`, `accountVoiceId`) est EXACTE — jamais
 *   par le nom. Sans correspondance : on dit pourquoi, on ne pose rien.
 *
 *   « Faire apparaître mon avatar parlant » — présence vidéo réelle. À l'envoi,
 *   la vidéo du jumeau (produite par le serveur sur MA voix) devient la
 *   séquence « Vidéo ». Activable SEULEMENT si le moteur vidéo est disponible
 *   POUR cet avatar (`moteurDisponible`) ; sinon le message du serveur nomme
 *   la dépendance manquante, et la case reste inerte — jamais une case sans
 *   effet.
 *
 * Le bloc montre l'avatar (nom, version, fournisseur en clair), la voix, CE
 * QU'IL DIRA (les textes de narration des séquences, tenus par le wizard et
 * modifiables dans le panneau des voix, pas ici), où il apparaît, ce qui sera
 * réellement dans la vidéo exportée, et le coût avant envoi.
 */

const LIBELLES: Record<SequenceKey, string> = { titre: 'Titre', cartes: 'Cartes', video: 'Vidéo', cta: 'CTA' };
const ORDRE: SequenceKey[] = ['titre', 'cartes', 'video', 'cta'];

interface VoixCompte { id: string; accountVoiceId?: string; name?: string }

export default function JumeauPanel(props: {
  mode: JumeauMode;
  onModeChange: (mode: JumeauMode) => void;
  /** Ce que le jumeau dira : les textes de narration par séquence, tels que le wizard les tient. */
  textes: Partial<Record<SequenceKey, string>>;
  /** La voix TTS courante du wizard (`elevenlabs-…`, `fr-FR-…`) — pour dire honnêtement avec quelle voix les séquences seront dites. */
  voixCourante?: string;
  /** Pose la voix du jumeau comme voix TTS des séquences (identifiant Studiio `elevenlabs-…`). */
  onVoixJumeau: (voixId: string) => void;
  /** AVATAR_VIDEO_COST — annoncé avant l'envoi, en mode avatar. */
  coutAvatar: number;
}) {
  const { mode, onModeChange, onVoixJumeau } = props;
  const [etat, setEtat] = useState<EtatJumeau | null | 'chargement'>('chargement');
  const [voixCompte, setVoixCompte] = useState<VoixCompte[] | null>(null);

  useEffect(() => {
    let vivant = true;
    void lireEtatJumeau().then((e) => { if (vivant) setEtat(e); });
    void fetch('/api/voice/clone')
      .then((r) => r.json())
      .then((j) => { if (vivant) setVoixCompte(Array.isArray(j?.voices) ? (j.voices as VoixCompte[]) : []); })
      .catch(() => { if (vivant) setVoixCompte([]); });
    return () => { vivant = false; };
  }, []);

  const etatLu = etat !== 'chargement' && etat ? etat : null;
  const jumeau = etatLu && etatLu.pret ? etatLu.jumeau : null;
  const pret = !!jumeau;
  // La voix du jumeau, retrouvée parmi celles du compte par son identifiant de
  // compte (correspondance exacte). Sans elle, « ma voix clonée » reste inerte.
  const voixReliee = jumeau && voixCompte ? voixCompte.find((v) => v.accountVoiceId === jumeau.voix.id) ?? null : null;
  const voixEnAttente = pret && voixCompte === null;
  const voixPossible = pret && !!voixReliee;
  const avatarPossible = pret && !!etatLu?.moteurDisponible;
  const chargement = etat === 'chargement' || voixEnAttente;

  // Si le serveur ne permet plus l'intention posée, elle tombe : on ne garde
  // pas une case cochée au-dessus de quelque chose qui ne se produira pas.
  useEffect(() => {
    if (chargement) return;
    if (mode === 'avatar' && !avatarPossible) onModeChange('aucun');
    if (mode === 'voix' && !voixPossible) onModeChange('aucun');
  }, [chargement, mode, avatarPossible, voixPossible, onModeChange]);

  const choisir = (m: JumeauMode) => {
    if (m === 'voix') {
      if (!voixReliee) return;
      onVoixJumeau(voixReliee.id);
    }
    if (m === 'avatar' && !avatarPossible) return;
    onModeChange(m);
  };

  const action = (motif: string | null): { libelle: string; href: string } => (
    motif === 'voix_absente' || motif === 'choix_voix_requis' || motif === 'voix_inutilisable'
      ? { libelle: 'Configurer ma voix', href: '/dashboard/avatar' }
      : { libelle: 'Gérer mon avatar', href: '/dashboard/avatar' }
  );

  const dira = ORDRE.map((k) => ({ key: k, libelle: LIBELLES[k], texte: (props.textes[k] ?? '').trim() })).filter((s) => s.key !== 'video' || s.texte.length > 0);
  const aucunTexte = dira.every((s) => s.texte.length === 0);
  const voixSequences = jumeau && props.voixCourante && voixReliee && props.voixCourante === voixReliee.id
    ? `votre voix (${jumeau.voix.nom})`
    : props.voixCourante ? 'la voix choisie dans Audio' : 'la voix par défaut';

  const recap = !jumeau ? null
    : mode === 'avatar'
      ? `Dans la vidéo exportée : la séquence « Vidéo » montre votre avatar (v${jumeau.avatar.version}) disant ces textes avec votre voix (${jumeau.voix.nom}). Les séquences Titre, Cartes et CTA gardent leur narration, dite avec ${voixSequences}. Coût : ${props.coutAvatar} crédits en plus du rendu, débités à l’envoi.`
      : mode === 'voix'
        ? `Dans la vidéo exportée : les séquences Titre, Cartes et CTA sont dites avec votre voix (${jumeau.voix.nom}). Votre avatar n’apparaît pas à l’image. Aucun coût avatar.`
        : `Dans la vidéo exportée : ni votre voix ni votre avatar — la narration est dite avec ${voixSequences}.`;

  return (
    <div data-jumeau-panel data-jumeau-mode={mode} className="rounded-xl border border-white/10 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-sm"><UserSquare2 className="w-4 h-4" /> Jumeau numérique</div>

      {chargement && (
        <div className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Vérification de votre jumeau…</div>
      )}
      {etat === null && (
        <div data-jumeau-etat="indisponible" className="text-xs text-gray-400">Votre jumeau n’a pas pu être vérifié pour le moment.</div>
      )}
      {etatLu && !etatLu.pret && (
        <div data-jumeau-etat={etatLu.motif ?? 'inconnu'} className="text-xs space-y-1">
          <div className="text-gray-300">{etatLu.message}</div>
          <Link data-jumeau-action href={action(etatLu.motif).href} className="text-purple-300 hover:text-purple-200 underline">{action(etatLu.motif).libelle}</Link>
        </div>
      )}

      {jumeau && !voixEnAttente && (
        <div data-jumeau-etat="pret" className="text-xs space-y-3">
          <div className="space-y-0.5">
            <div className="text-emerald-300 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Votre jumeau est prêt</div>
            <div className="text-gray-300" data-jumeau-avatar>
              Avatar : {jumeau.avatar.nom || 'Mon avatar'} (v{jumeau.avatar.version}), validé — {libelleFournisseurAvatar(jumeau.avatar.fournisseur)}
            </div>
            <div className="text-gray-300" data-jumeau-voix>Voix : Ma voix — {jumeau.voix.nom}</div>
            {jumeau.prononciations > 0 && (
              <div className="text-gray-500">{jumeau.prononciations} prononciation{jumeau.prononciations > 1 ? 's' : ''} personnalisée{jumeau.prononciations > 1 ? 's' : ''} seront appliquées au texte prononcé.</div>
            )}
          </div>

          <fieldset className="space-y-2" aria-label="Utilisation du jumeau">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="jumeau-mode" value="aucun" data-jumeau-choix="aucun" checked={mode === 'aucun'} onChange={() => choisir('aucun')} className="mt-0.5 accent-purple-500" />
              <span className="text-gray-300">Ne pas utiliser mon jumeau</span>
            </label>

            <label className={`flex items-start gap-2 ${voixPossible ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
              <input type="radio" name="jumeau-mode" value="voix" data-jumeau-choix="voix" checked={mode === 'voix'} disabled={!voixPossible} onChange={() => choisir('voix')} className="mt-0.5 accent-purple-500" />
              <span>
                <span className="text-gray-100 font-medium">Utiliser ma voix clonée</span>
                <span className="block text-gray-400">Narration seulement : les séquences Titre, Cartes et CTA sont dites avec votre voix. Votre avatar n’apparaît pas à l’image.</span>
                {!voixReliee && (
                  <span data-jumeau-voix-non-reliee className="block text-amber-200 mt-0.5">
                    La voix de votre jumeau (« {jumeau.voix.nom} ») n’est pas dans la liste des voix clonées de votre compte : elle ne peut pas être posée. Rechargez la page ou vérifiez votre voix dans Mon avatar.
                  </span>
                )}
              </span>
            </label>

            <label className={`flex items-start gap-2 ${avatarPossible ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
              <input type="radio" name="jumeau-mode" value="avatar" data-jumeau-choix="avatar" checked={mode === 'avatar'} disabled={!avatarPossible} onChange={() => choisir('avatar')} className="mt-0.5 accent-purple-500" />
              <span>
                <span className="text-gray-100 font-medium">Faire apparaître mon avatar parlant</span>
                <span className="block text-gray-400">Présence vidéo réelle : à l’envoi, votre avatar dit ces textes avec votre voix et devient la séquence « Vidéo ». {props.coutAvatar} crédits en plus du rendu.</span>
                {!etatLu?.moteurDisponible && (
                  <span data-jumeau-moteur="indisponible" className="block text-amber-200 mt-0.5 flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{etatLu?.messageMoteur || 'La génération vidéo avec votre jumeau n’est pas disponible pour cet avatar.'}</span>
                  </span>
                )}
              </span>
            </label>
          </fieldset>

          <div data-jumeau-dira className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-1">
            <div className="text-gray-200 font-medium">Ce qu’il dira</div>
            {aucunTexte ? (
              <div className="text-gray-500">Les textes de narration seront ceux générés à l’étape Contenu.</div>
            ) : dira.map((s) => (
              <div key={s.key} data-jumeau-dira-sequence={s.key} className="text-gray-300">
                <span className="text-gray-500">{s.libelle} : </span>
                {s.texte || <span className="text-gray-600">(rien)</span>}
              </div>
            ))}
            <div className="text-gray-500">Modifiable dans le panneau des voix par séquence (étape Audio).</div>
          </div>

          <div data-jumeau-sequences className="text-gray-400">
            {mode === 'avatar' && 'Où il apparaît : séquence « Vidéo » (à l’image, avec votre voix).'}
            {mode === 'voix' && 'Où il apparaît : séquences Titre, Cartes, CTA (voix seulement).'}
            {mode === 'aucun' && 'Où il apparaît : nulle part.'}
          </div>
          {recap && <div data-jumeau-recap className="text-gray-300">{recap}</div>}
        </div>
      )}
    </div>
  );
}
