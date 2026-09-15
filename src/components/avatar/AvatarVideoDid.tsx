'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Check, AlertTriangle, Upload, FileText, Sparkles } from 'lucide-react';

/**
 * L'avatar vidéo (D-ID), après le dépôt de la source : le consentement
 * fournisseur — phrase à lire, vidéo à importer, vérification — puis la
 * création et l'entraînement, jusqu'à « prêt ». Tout vient du serveur : l'étape
 * est DÉRIVÉE de la ligne (`etape_did`), la phrase est celle que D-ID a
 * rendue, les statuts sont réels. Aucun identifiant fournisseur ne transite.
 *
 * Boutons désactivés pendant chaque requête ; le serveur protège aussi
 * (compare-and-set par version) : un double clic ne crée ni deux
 * consentements, ni deux vidéos, ni deux avatars.
 */

export type EtapeDid =
  | 'consentement_a_demander' | 'consentement_texte_pret' | 'consentement_en_verification'
  | 'consentement_refuse' | 'consentement_accepte' | 'creation_en_cours' | 'pret' | 'valide' | 'echec';

export interface AvatarVideoDidProps {
  etape: EtapeDid;
  /** La phrase à lire, telle que D-ID l'a rendue (présente dès `consentement_texte_pret`). */
  texteConsentement: string | null;
  erreurEntrainement?: string | null;
  /** Rappelé à chaque changement d'étape : la page relit l'avatar. */
  onChange: () => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

const ETAPES_PIPELINE: Array<{ cle: string; libelle: string; atteinte: (e: EtapeDid) => boolean }> = [
  { cle: 'telechargement', libelle: 'Téléchargement', atteinte: () => true },
  { cle: 'verification', libelle: 'Vérification', atteinte: (e) => e !== 'consentement_a_demander' && e !== 'consentement_texte_pret' },
  { cle: 'creation', libelle: 'Création', atteinte: (e) => ['creation_en_cours', 'pret', 'valide', 'echec'].includes(e) },
  { cle: 'entrainement', libelle: 'Entraînement', atteinte: (e) => ['creation_en_cours', 'pret', 'valide'].includes(e) },
  { cle: 'pret', libelle: 'Prêt', atteinte: (e) => e === 'pret' || e === 'valide' },
];

export default function AvatarVideoDid({ etape, texteConsentement, erreurEntrainement, onChange, fetchImpl }: AvatarVideoDidProps) {
  const f = fetchImpl ?? fetch;
  const [occupe, setOccupe] = useState<null | 'phrase' | 'video' | 'creer'>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurConsentement, setErreurConsentement] = useState<string | null>(null);
  const [fichier, setFichier] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Verrou SYNCHRONE : deux clics dans le même tour d'événements ne partent
  // pas deux fois — l'état `occupe` ne serait posé qu'au rendu suivant.
  const enCoursRef = useRef(false);

  // Suivi de la vérification du consentement : un poll toutes les 8 s tant que D-ID examine.
  useEffect(() => {
    if (etape !== 'consentement_en_verification') return;
    let annule = false;
    const tick = async () => {
      try {
        const res = await f('/api/avatar/did/consentement');
        const json = await res.json();
        if (!annule && json?.success) {
          if (json.data.erreur) setErreurConsentement(json.data.erreur);
          if (json.data.etape !== 'consentement_en_verification') { await onChange(); return; }
        }
      } catch { /* transitoire : on retente au prochain tour */ }
      if (!annule) pollRef.current = setTimeout(tick, 8000);
    };
    pollRef.current = setTimeout(tick, 8000);
    return () => { annule = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [etape, f, onChange]);

  const appeler = async (quoi: 'phrase' | 'video' | 'creer', url: string, init?: RequestInit) => {
    if (enCoursRef.current) return;
    enCoursRef.current = true;
    setOccupe(quoi);
    setErreur(null);
    try {
      const res = await f(url, { method: 'POST', ...init });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        setErreur(json?.error || 'La demande a échoué. Réessayez.');
        // Une autre action a peut-être avancé l'avatar : on relit.
        if (res.status === 409) await onChange();
        return;
      }
      if (quoi === 'video') { setFichier(null); if (inputRef.current) inputRef.current.value = ''; setErreurConsentement(null); }
      await onChange();
    } catch {
      setErreur('Connexion impossible. Réessayez.');
    } finally {
      enCoursRef.current = false;
      setOccupe(null);
    }
  };

  const envoyerVideoConsentement = () => {
    if (!fichier) return;
    const fd = new FormData();
    fd.append('file', fichier);
    void appeler('video', '/api/avatar/did/consentement/video', { body: fd });
  };

  return (
    <div data-avatar-did={etape} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      {/* Le pipeline : Téléchargement → Vérification → Création → Entraînement → Prêt */}
      <ol data-avatar-did-pipeline className="flex flex-wrap items-center gap-2 text-[11px]">
        {ETAPES_PIPELINE.map((p, i) => {
          const ok = p.atteinte(etape);
          return (
            <li key={p.cle} data-avatar-did-etape={p.cle} data-atteinte={ok ? '1' : '0'} className={`flex items-center gap-1 ${ok ? 'text-emerald-300' : 'text-gray-500'}`}>
              {ok ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-gray-600 inline-block" />}
              {p.libelle}{i < ETAPES_PIPELINE.length - 1 && <span className="text-gray-600 ml-1">→</span>}
            </li>
          );
        })}
      </ol>

      {etape === 'consentement_a_demander' && (
        <div className="space-y-2">
          <div className="text-sm font-medium">2. Obtenir ma phrase de consentement</div>
          <p className="text-xs text-gray-400">Notre fournisseur tire au sort une phrase que vous lirez face caméra : c&apos;est ce qui prouve que l&apos;avatar est bien le vôtre.</p>
          <button data-avatar-did-action="phrase" onClick={() => appeler('phrase', '/api/avatar/did/consentement')} disabled={!!occupe} className="button-primary flex items-center gap-2 disabled:opacity-40">
            {occupe === 'phrase' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Obtenir ma phrase de consentement
          </button>
        </div>
      )}

      {(etape === 'consentement_texte_pret' || etape === 'consentement_refuse') && (
        <div className="space-y-3">
          {etape === 'consentement_refuse' && (
            <div data-avatar-did-refus className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Votre vidéo de consentement n&apos;a pas été acceptée{erreurConsentement ? ` (${erreurConsentement})` : ''}. Relisez la phrase, bien audible, face caméra, puis réimportez.</span>
            </div>
          )}
          <div className="text-sm font-medium">3. Importer ma vidéo de consentement</div>
          <div data-avatar-did-phrase className="rounded-xl bg-gray-900/60 p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Lisez exactement cette phrase, face caméra :</div>
            <div className="text-base text-white font-medium">{texteConsentement}</div>
          </div>
          <input ref={inputRef} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => { setErreur(null); setFichier(e.target.files?.[0] ?? null); }} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => inputRef.current?.click()} disabled={!!occupe} className="rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500 transition px-4 py-3 text-sm text-gray-300 flex items-center gap-2">
              <Upload className="w-4 h-4" /> {fichier ? `${fichier.name} — ${Math.round(fichier.size / 1024 / 1024)} Mo` : 'Choisir la vidéo de consentement'}
            </button>
            <button data-avatar-did-action="video" onClick={envoyerVideoConsentement} disabled={!fichier || !!occupe} className="button-primary flex items-center gap-2 disabled:opacity-40">
              {occupe === 'video' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Envoyer ma vidéo de consentement
            </button>
          </div>
          <p className="text-xs text-gray-500">MP4 ou MOV, 50 Mo maximum. Une courte vidéo suffit.</p>
        </div>
      )}

      {etape === 'consentement_en_verification' && (
        <div data-avatar-did-verification className="flex items-center gap-2 text-sm text-amber-200">
          <Loader2 className="w-4 h-4 animate-spin" /> Vérification du consentement… Cette page se met à jour toute seule.
        </div>
      )}

      {etape === 'consentement_accepte' && (
        <div className="space-y-2">
          <div data-avatar-did-accepte className="flex items-center gap-2 text-sm text-emerald-200"><Check className="w-4 h-4" /> Consentement accepté.</div>
          <div className="text-sm font-medium">5. Créer mon avatar</div>
          <button data-avatar-did-action="creer" onClick={() => appeler('creer', '/api/avatar/did/creer')} disabled={!!occupe} className="button-primary flex items-center gap-2 disabled:opacity-40">
            {occupe === 'creer' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Créer mon avatar
          </button>
        </div>
      )}

      {etape === 'creation_en_cours' && (
        <div data-avatar-did-entrainement className="flex items-center gap-2 text-sm text-amber-200">
          <Loader2 className="w-4 h-4 animate-spin" /> Entraînement en cours chez notre fournisseur… Cela prend généralement plusieurs minutes. Cette page se met à jour toute seule.
        </div>
      )}

      {etape === 'echec' && (
        <div data-avatar-did-echec className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>L&apos;entraînement a échoué{erreurEntrainement ? ` : ${erreurEntrainement}` : ''}. Utilisez « Changer de source » pour réessayer avec une autre vidéo.</span>
        </div>
      )}

      {etape === 'pret' && (
        <div data-avatar-did-pret className="flex items-center gap-2 text-sm text-emerald-200"><Check className="w-4 h-4" /> Mon avatar vidéo est prêt.</div>
      )}

      {erreur && <div data-avatar-did-erreur className="text-xs text-red-200">{erreur}</div>}
    </div>
  );
}
