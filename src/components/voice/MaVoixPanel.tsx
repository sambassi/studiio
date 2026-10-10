'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Mic, Pencil, Play, Plus, Trash2, Check, X, Volume2 } from 'lucide-react';
import {
  ajouterPrononciation, modifierPrononciation, supprimerPrononciation, scriptParle,
  MESSAGES_PRONONCIATION, type Prononciation,
} from '@/lib/voice/prononciations';
import { MAX_CARACTERES_PREECOUTE, MESSAGE_TROP_D_ECOUTES } from '@/lib/voice/preecoute';
import AudioCompletSection from '@/components/voice/AudioCompletSection';
import LecteurVoixCompact from '@/components/voice/LecteurVoixCompact';

/**
 * « Ma voix & prononciations » — l'écran ne décide rien, il affiche ce que
 * le serveur sait et lui renvoie des intentions :
 *   - la voix utilisée (résolue par le serveur), et un sélecteur s'il y en a
 *     plusieurs ;
 *   - les prononciations (ajouter / modifier / supprimer), enregistrées en
 *     liste complète, validées côté serveur ;
 *   - l'aperçu TEXTE AFFICHÉ / SERA PRONONCÉ, par la même fonction commune
 *     que le serveur (`scriptParle`) ;
 *   - « Écouter ma voix » : un vrai audio, ou l'état « pas encore
 *     disponible » — jamais une voix générique, jamais un faux son. Il se
 *     joue dans `LecteurVoixCompact` (lecture/pause, onde, chrono), jamais
 *     dans le lecteur natif (menu ⋮, téléchargement) ;
 *   - l'icône haut-parleur de chaque prononciation : le serveur dit CE mot
 *     (≈ 5 s au plus), l'écran n'envoie que `{ affiche }`. Lecture sans
 *     lecteur visible, une seule à la fois, sans téléchargement.
 * Les deux écoutes sont des pré-écoutes gratuites et courtes : la borne
 * (≈ 5 s de texte dit) est appliquée par le serveur, jamais crue d'ici.
 *
 * « Audio complet » est une section À PART, payante : le prix annoncé au-dessus du
 * bouton vient de la même fonction pure que le serveur (`coutAudioComplet`),
 * mais seul le serveur le calcule et débite. Le lecteur complet et le lien
 * de téléchargement n'apparaissent qu'APRÈS un succès — dans
 * `AudioCompletSection`, jamais dans ce fichier.
 */

interface VoixPersonnelle { id: string; nom: string; fournisseur: string; langue: string | null; creeeLe: string; utilisable: boolean }
interface Profil {
  voix: VoixPersonnelle[];
  choix: string | null;
  voixResolue: VoixPersonnelle | null;
  motifVoix: string | null;
  messageVoix: string | null;
  prononciations: Prononciation[];
  ecouteDisponible: boolean;
}

const EXEMPLE = 'Bienvenue au cours Afroboost à Neuchâtel.';

export default function MaVoixPanel() {
  const [profil, setProfil] = useState<Profil | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [texte, setTexte] = useState(EXEMPLE);
  const [brouillon, setBrouillon] = useState<{ affiche: string; prononce: string; origine: string | null } | null>(null);
  const [ecouteEnCours, setEcouteEnCours] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [spokenJoue, setSpokenJoue] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ligneEnCours, setLigneEnCours] = useState<string | null>(null);
  const [erreurLigne, setErreurLigne] = useState<{ affiche: string; message: string } | null>(null);
  const lectureLigneRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);

  /** Arrête et libère la lecture d'une ligne en cours — une seule à la fois. */
  const arreterLectureLigne = useCallback(() => {
    const l = lectureLigneRef.current;
    if (!l) return;
    lectureLigneRef.current = null;
    try { l.audio.pause(); } catch { /* lecture déjà arrêtée */ }
    URL.revokeObjectURL(l.url);
  }, []);
  useEffect(() => () => arreterLectureLigne(), [arreterLectureLigne]);
  // L'URL de l'écoute précédente est libérée dès qu'elle est remplacée, et au démontage.
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const charger = useCallback(async () => {
    try {
      const res = await fetch('/api/voice/profil');
      const json = await res.json();
      if (!json.success || !json.data || !Array.isArray(json.data.voix)) { setErreur(json.error || 'Profil vocal illisible.'); return; }
      const d = json.data as Partial<Profil>;
      setProfil({
        voix: d.voix ?? [], choix: d.choix ?? null, voixResolue: d.voixResolue ?? null,
        motifVoix: d.motifVoix ?? null, messageVoix: d.messageVoix ?? null,
        prononciations: Array.isArray(d.prononciations) ? d.prononciations : [], ecouteDisponible: d.ecouteDisponible === true,
      });
    } catch {
      setErreur('Profil vocal illisible.');
    } finally {
      setChargement(false);
    }
  }, []);
  useEffect(() => { void charger(); }, [charger]);

  const prononciations = profil?.prononciations ?? [];
  const spoken = useMemo(() => scriptParle(texte, prononciations), [texte, prononciations]);
  // Indicatif seulement : le serveur refuse de lui-même au-delà de la borne.
  const spokenTropLong = spoken.length > MAX_CARACTERES_PREECOUTE;

  const enregistrerListe = async (liste: Prononciation[]) => {
    setErreur(null);
    const res = await fetch('/api/voice/profil/prononciations', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prononciations: liste }),
    });
    const json = await res.json();
    if (!json.success) { setErreur(json.error || 'Enregistrement impossible.'); return false; }
    setProfil((p) => (p ? { ...p, prononciations: json.data.prononciations } : p));
    return true;
  };

  const validerBrouillon = async () => {
    if (!brouillon) return;
    const r = brouillon.origine === null
      ? ajouterPrononciation(prononciations, brouillon)
      : modifierPrononciation(prononciations, brouillon.origine, brouillon);
    if (!r.ok) { setErreur(r.motif === 'introuvable' ? 'Cette prononciation n’existe plus.' : MESSAGES_PRONONCIATION[r.motif]); return; }
    if (await enregistrerListe(r.liste)) setBrouillon(null);
  };

  const supprimer = async (affiche: string) => {
    const r = supprimerPrononciation(prononciations, affiche);
    if (!r.ok) return;
    await enregistrerListe(r.liste);
  };

  const choisirVoix = async (userVoiceId: string) => {
    setErreur(null);
    const res = await fetch('/api/voice/profil/voix', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userVoiceId }),
    });
    const json = await res.json();
    if (!json.success) { setErreur(json.error || 'Choix impossible.'); return; }
    await charger();
  };

  const ecouterPrononciation = async (affiche: string) => {
    if (ligneEnCours) return;
    arreterLectureLigne();
    audioRef.current?.pause();
    setErreurLigne(null); setLigneEnCours(affiche);
    try {
      // Rien d'autre que l'entrée : le serveur fabrique lui-même le mini-texte.
      const res = await fetch('/api/voice/prononciations/ecoute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ affiche }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const message = res.status === 429 ? MESSAGE_TROP_D_ECOUTES : (json.error || 'L’écoute a échoué.');
        setErreurLigne({ affiche, message });
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      lectureLigneRef.current = { audio, url };
      audio.onended = () => { if (lectureLigneRef.current?.url === url) arreterLectureLigne(); };
      await audio.play().catch(() => { /* lecture refusée par le navigateur : rien à jouer */ });
    } catch {
      setErreurLigne({ affiche, message: 'L’écoute a échoué.' });
    } finally {
      setLigneEnCours(null);
    }
  };

  const ecouter = async () => {
    if (!profil?.ecouteDisponible || ecouteEnCours) return;
    arreterLectureLigne();
    setErreur(null); setNotice(null); setEcouteEnCours(true);
    try {
      const res = await fetch('/api/voice/ecoute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texte }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErreur(res.status === 429 ? MESSAGE_TROP_D_ECOUTES : (json.error || 'L’écoute a échoué.'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      const dit = res.headers.get('X-Studiio-Spoken');
      setSpokenJoue(dit ? decodeURIComponent(dit) : null);
    } catch {
      setErreur('L’écoute a échoué.');
    } finally {
      setEcouteEnCours(false);
    }
  };

  if (chargement) {
    return <div className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement de votre voix…</div>;
  }
  if (!profil) {
    return <div className="text-sm text-red-200" data-voix-panel="erreur">{erreur ?? 'Profil vocal illisible.'}</div>;
  }

  return (
    /* Sous-sections de « Ma voix » (la carte et le titre de section sont portés par la page). */
    <div className="space-y-6" data-voix-panel>
      {/* ── VOIX UTILISÉE ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Mic className="w-4 h-4" /> Voix utilisée</h3>
        {profil.voixResolue ? (
          <div data-voix-selectionnee className="text-sm">
            Voix sélectionnée : <span className="font-medium">« Ma voix — {profil.voixResolue.nom} »</span>
          </div>
        ) : (
          <div data-voix-motif={profil.motifVoix ?? 'inconnu'} className="text-sm text-gray-400">{profil.messageVoix}</div>
        )}
        {profil.voix.length > 1 && (
          <label className="block text-sm">
            <span className="text-gray-400">Choisir la voix à utiliser</span>
            <select
              data-voix-selecteur
              value={profil.choix ?? ''}
              onChange={(e) => { if (e.target.value) void choisirVoix(e.target.value); }}
              className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm"
            >
              <option value="">— Choisir —</option>
              {profil.voix.map((v) => (
                <option key={v.id} value={v.id} disabled={!v.utilisable}>
                  Ma voix — {v.nom}{v.utilisable ? '' : ' (inutilisable)'}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {/* ── PRONONCIATIONS ───────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="font-semibold">Prononciations</h3>
        <ul data-prononciations className="space-y-2">
          {prononciations.length === 0 && <li className="text-sm text-gray-500">Aucune prononciation personnalisée.</li>}
          {prononciations.map((p) => (
            <li key={p.affiche} data-prononciation={p.affiche} className="text-sm rounded-lg bg-white/5 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  data-prononciation-ecouter={p.affiche}
                  aria-label={`Écouter « ${p.affiche} »`}
                  title={`Écouter « ${p.affiche} »`}
                  onClick={() => void ecouterPrononciation(p.affiche)}
                  disabled={ligneEnCours !== null}
                  className="text-gray-400 hover:text-white disabled:opacity-40"
                >
                  {ligneEnCours === p.affiche ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <span><span className="font-medium">{p.affiche}</span> <span className="text-gray-400">→</span> {p.prononce}</span>
              </span>
              <span className="flex items-center gap-2">
                <button data-prononciation-modifier={p.affiche} onClick={() => setBrouillon({ affiche: p.affiche, prononce: p.prononce, origine: p.affiche })} className="text-gray-400 hover:text-white flex items-center gap-1 text-xs"><Pencil className="w-3.5 h-3.5" /> Modifier</button>
                <button data-prononciation-supprimer={p.affiche} onClick={() => void supprimer(p.affiche)} className="text-gray-400 hover:text-red-300 flex items-center gap-1 text-xs"><Trash2 className="w-3.5 h-3.5" /> Supprimer</button>
              </span>
              </div>
              {erreurLigne?.affiche === p.affiche && (
                <div data-prononciation-erreur={p.affiche} className="mt-1 text-xs text-red-200">{erreurLigne.message}</div>
              )}
            </li>
          ))}
        </ul>
        {brouillon ? (
          <div data-prononciation-formulaire className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
            <label className="text-xs text-gray-400">Affiché
              <input data-prononciation-affiche value={brouillon.affiche} onChange={(e) => setBrouillon({ ...brouillon, affiche: e.target.value })} placeholder="Afroboost" className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-white" />
            </label>
            <label className="text-xs text-gray-400">Prononcé
              <input data-prononciation-prononce value={brouillon.prononce} onChange={(e) => setBrouillon({ ...brouillon, prononce: e.target.value })} placeholder="Afro-boust" className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-white" />
            </label>
            <span className="flex gap-2">
              <button data-prononciation-valider onClick={() => void validerBrouillon()} className="button-primary flex items-center gap-1 text-sm"><Check className="w-4 h-4" /> Enregistrer</button>
              <button data-prononciation-annuler onClick={() => setBrouillon(null)} className="text-gray-400 hover:text-white flex items-center gap-1 text-sm"><X className="w-4 h-4" /> Annuler</button>
            </span>
          </div>
        ) : (
          <button data-prononciation-ajouter onClick={() => setBrouillon({ affiche: '', prononce: '', origine: null })} className="text-sm text-gray-300 hover:text-white flex items-center gap-1.5"><Plus className="w-4 h-4" /> Ajouter une prononciation</button>
        )}
      </section>

      {/* ── APERÇU ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="font-semibold">Aperçu du texte prononcé</h3>
        <textarea
          data-apercu-texte
          value={texte}
          onChange={(e) => setTexte(e.target.value.slice(0, MAX_CARACTERES_PREECOUTE))}
          maxLength={MAX_CARACTERES_PREECOUTE}
          rows={2}
          className="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-white"
        />
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <div className="rounded-lg bg-white/5 p-3">
            <div className="text-xs text-gray-400 mb-1">Texte affiché :</div>
            <div data-apercu-affiche>« {texte} »</div>
          </div>
          <div className="rounded-lg bg-purple-500/10 border border-purple-500/30 p-3">
            <div className="text-xs text-purple-200 mb-1">Sera prononcé :</div>
            <div data-apercu-prononce>« {spoken} »</div>
          </div>
        </div>

        {/* ── ÉCOUTER — vrai audio ou état indisponible, jamais un faux son ── */}
        {profil.ecouteDisponible ? (
          <div className="space-y-2">
            <div data-preecoute-indice className="text-xs text-gray-400">Pré-écoute gratuite : environ 5 secondes ({spoken.length}/{MAX_CARACTERES_PREECOUTE} caractères prononcés).</div>
            {spokenTropLong && (
              <div data-preecoute-trop-long className="text-xs text-amber-200">Le texte prononcé dépasse la pré-écoute gratuite : raccourcissez-le.</div>
            )}
            <button data-ecouter onClick={() => void ecouter()} disabled={ecouteEnCours || !texte.trim() || spokenTropLong} className="button-primary flex items-center gap-2 disabled:opacity-40">
              {ecouteEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Écouter ma voix
            </button>
            {audioUrl && (
              <div className="space-y-1">
                {/* Lecteur Studiio : `<audio>` caché sans `controls` — ni menu ⋮, ni téléchargement. */}
                <LecteurVoixCompact ref={audioRef} src={audioUrl} onLecture={arreterLectureLigne} />
                {spokenJoue && <div className="text-xs text-gray-400">Texte prononcé : « {spokenJoue} »</div>}
              </div>
            )}
          </div>
        ) : (
          <div data-ecoute-indisponible className="text-sm text-gray-400">
            L’écoute de votre voix personnelle n’est pas encore disponible.
          </div>
        )}
      </section>

      {/* ── AUDIO COMPLET — opération à part, payante (composant séparé : la pré-écoute ne se télécharge jamais) ── */}
      <AudioCompletSection disponible={profil.ecouteDisponible} />

      {notice && <div className="text-sm text-emerald-200">{notice}</div>}
      {erreur && <div data-voix-erreur className="text-sm text-red-200">{erreur}</div>}
    </div>
  );
}
