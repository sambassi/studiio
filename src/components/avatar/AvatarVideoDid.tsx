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
  | 'consentement_a_demander' | 'consentement_reutilisable' | 'consentement_texte_pret' | 'consentement_en_verification'
  | 'consentement_refuse' | 'consentement_accepte' | 'creation_en_cours' | 'pret' | 'valide' | 'echec';

export interface AvatarVideoDidProps {
  etape: EtapeDid;
  /** La phrase à lire — celle de D-ID, avec le nom de la personne à la place de `[user name]`. */
  texteConsentement: string | null;
  /** Le nom de la personne tel qu'enregistré avec la phrase (celui à prononcer, celui que D-ID reçoit). */
  nomConsentement?: string | null;
  /** Pré-remplissage du nom : le profil du compte. La personne le corrige si besoin. */
  nomProfil?: string | null;
  /** Fin de validité de la phrase (ISO) : D-ID fait expirer un consentement 30 minutes après sa création. */
  expireLe?: string | null;
  erreurEntrainement?: string | null;
  /** Rappelé à chaque changement d'étape : la page relit l'avatar. */
  onChange: () => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

const ETAPES_PIPELINE: Array<{ cle: string; libelle: string; atteinte: (e: EtapeDid) => boolean }> = [
  { cle: 'telechargement', libelle: 'Téléchargement', atteinte: () => true },
  { cle: 'verification', libelle: 'Vérification', atteinte: (e) => e !== 'consentement_a_demander' && e !== 'consentement_reutilisable' && e !== 'consentement_texte_pret' },
  { cle: 'creation', libelle: 'Création', atteinte: (e) => ['creation_en_cours', 'pret', 'valide', 'echec'].includes(e) },
  { cle: 'entrainement', libelle: 'Entraînement', atteinte: (e) => ['creation_en_cours', 'pret', 'valide'].includes(e) },
  { cle: 'pret', libelle: 'Prêt', atteinte: (e) => e === 'pret' || e === 'valide' },
];

export default function AvatarVideoDid({ etape, texteConsentement, nomConsentement, nomProfil, expireLe, erreurEntrainement, onChange, fetchImpl }: AvatarVideoDidProps) {
  const f = fetchImpl ?? fetch;
  const [occupe, setOccupe] = useState<null | 'phrase' | 'video' | 'creer' | 'reutiliser'>(null);
  const [nom, setNom] = useState<string>(nomConsentement ?? nomProfil ?? '');
  /** Pour le nom saisi : un consentement VALIDÉ de la même personne existe-t-il ? (dit par le serveur) */
  const [reutilisable, setReutilisable] = useState<{ nom: string } | null>(null);
  const expiree = !!expireLe && new Date(expireLe).getTime() <= Date.now();
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

  // Le serveur dit si un consentement validé existe pour EXACTEMENT ce nom — à chaque
  // changement du nom (petite pause de frappe), tant qu'aucun défi n'est en cours.
  const nomSaisi = nom.trim();
  useEffect(() => {
    if (etape !== 'consentement_a_demander' && etape !== 'consentement_reutilisable') { setReutilisable(null); return; }
    if (nomSaisi.length < 2) { setReutilisable(null); return; }
    let annule = false;
    const t = setTimeout(async () => {
      try {
        const res = await f(`/api/avatar/did/consentement?nom=${encodeURIComponent(nomSaisi)}`);
        const json = await res.json();
        if (!annule) setReutilisable(json?.success && json.data?.reutilisable?.nom === nomSaisi ? { nom: nomSaisi } : null);
      } catch { if (!annule) setReutilisable(null); }
    }, 350);
    return () => { annule = true; clearTimeout(t); };
  }, [nomSaisi, etape, f]);

  const appeler = async (quoi: 'phrase' | 'video' | 'creer' | 'reutiliser', url: string, init?: RequestInit) => {
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
      if (quoi === 'video' || quoi === 'phrase') { setFichier(null); if (inputRef.current) inputRef.current.value = ''; setErreurConsentement(null); }
      await onChange();
    } catch {
      setErreur('Connexion impossible. Réessayez.');
    } finally {
      enCoursRef.current = false;
      setOccupe(null);
    }
  };

  const demanderPhrase = (renouveler: boolean) => appeler('phrase', '/api/avatar/did/consentement', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: nom.trim(), renouveler }),
  });
  const nomValide = nom.trim().length >= 2;
  const reutiliser = () => appeler('reutiliser', '/api/avatar/did/consentement/reutiliser', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom: nom.trim() }),
  });
  /** Le bloc « nom + réutiliser ou nouvelle phrase », partagé par les deux étapes d'entrée. */
  const blocNomEtChoix = (
    <>
      <label className="block text-xs text-gray-400">
        Votre nom, exactement comme vous le prononcerez
        <input data-avatar-did-nom type="text" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={80} autoComplete="name" placeholder="Prénom Nom" className="mt-1 w-full rounded-lg bg-gray-900/60 border border-white/10 px-3 py-2 text-sm text-white" />
      </label>
      {reutilisable && (
        <div data-avatar-did-reutilisable className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-200"><Check className="w-4 h-4" /> Consentement déjà validé pour {reutilisable.nom}</div>
          <p className="text-xs text-emerald-200/80">Aucune nouvelle phrase à lire : le consentement validé de cette personne sert à ce nouvel avatar.</p>
          <button data-avatar-did-action="reutiliser" onClick={reutiliser} disabled={!!occupe} className="button-primary flex items-center gap-2 disabled:opacity-40">
            {occupe === 'reutiliser' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Réutiliser mon consentement
          </button>
        </div>
      )}
      <button data-avatar-did-action="phrase" onClick={() => demanderPhrase(false)} disabled={!!occupe || !nomValide} className={`${reutilisable ? 'text-xs text-gray-300 hover:text-white' : 'button-primary'} flex items-center gap-2 disabled:opacity-40`}>
        {occupe === 'phrase' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} {reutilisable ? 'Obtenir plutôt une nouvelle phrase' : 'Obtenir ma phrase de consentement'}
      </button>
    </>
  );

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
        <div className="space-y-3">
          <div className="text-sm font-medium">2. Obtenir ma phrase de consentement</div>
          <p className="text-xs text-gray-400">Notre fournisseur tire au sort une phrase que vous lirez face caméra, avec votre nom : c&apos;est ce qui prouve que l&apos;avatar est bien le vôtre. Un consentement déjà validé pour la même personne est réutilisé.</p>
          {blocNomEtChoix}
        </div>
      )}

      {etape === 'consentement_reutilisable' && (
        <div className="space-y-3">
          <div className="text-sm font-medium">2. Votre consentement</div>
          <p className="text-xs text-gray-400">Votre avatar précédent a été validé avec un consentement{nomConsentement ? ` au nom de ${nomConsentement}` : ''}. Pour cette nouvelle vidéo, réutilisez-le — ou indiquez un autre nom pour une nouvelle phrase.</p>
          {blocNomEtChoix}
        </div>
      )}

      {(etape === 'consentement_texte_pret' || etape === 'consentement_refuse') && (
        <div className="space-y-3">
          {etape === 'consentement_refuse' && (
            <div data-avatar-did-refus className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Votre vidéo de consentement n&apos;a pas été acceptée{erreurConsentement ? ` — motif du fournisseur : ${erreurConsentement}` : ''}. Vérifiez votre nom ci-dessous, obtenez une nouvelle phrase si celle-ci a expiré, relisez-la exactement, bien audible, face caméra, puis réimportez.</span>
            </div>
          )}
          <div className="text-sm font-medium">3. Importer ma vidéo de consentement</div>
          <div data-avatar-did-phrase className="rounded-xl bg-gray-900/60 p-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Lisez exactement cette phrase, face caméra :</div>
            <div className="text-base text-white font-medium">{texteConsentement}</div>
            {nomConsentement && (
              <div data-avatar-did-nom-prononce className="text-xs text-gray-400">Votre nom, tel qu&apos;il doit être prononcé : <span className="text-gray-200">{nomConsentement}</span></div>
            )}
            {expireLe && (
              <div data-avatar-did-expiration={expiree ? 'expiree' : 'valide'} className={`text-xs ${expiree ? 'text-amber-200' : 'text-gray-500'}`}>
                {expiree ? 'Cette phrase a expiré (30 minutes). Obtenez une nouvelle phrase avant d’enregistrer.' : `Valable jusqu’à ${new Date(expireLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (30 minutes).`}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input data-avatar-did-nom type="text" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={80} autoComplete="name" placeholder="Prénom Nom" className="rounded-lg bg-gray-900/60 border border-white/10 px-3 py-2 text-sm text-white" aria-label="Votre nom, exactement comme vous le prononcerez" />
            <button data-avatar-did-action="renouveler" onClick={() => demanderPhrase(true)} disabled={!!occupe || !nomValide} className="text-xs text-gray-300 hover:text-white flex items-center gap-1.5 disabled:opacity-40">
              {occupe === 'phrase' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Obtenir une nouvelle phrase
            </button>
          </div>
          <input ref={inputRef} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={(e) => { setErreur(null); setFichier(e.target.files?.[0] ?? null); }} />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => inputRef.current?.click()} disabled={!!occupe} className="rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500 transition px-4 py-3 text-sm text-gray-300 flex items-center gap-2">
              <Upload className="w-4 h-4" /> {fichier ? `${fichier.name} — ${Math.round(fichier.size / 1024 / 1024)} Mo` : 'Choisir la vidéo de consentement'}
            </button>
            <button data-avatar-did-action="video" onClick={envoyerVideoConsentement} disabled={!fichier || !!occupe || expiree} className="button-primary flex items-center gap-2 disabled:opacity-40">
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
