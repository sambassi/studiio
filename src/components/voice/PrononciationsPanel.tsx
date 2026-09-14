'use client';

import { useCallback, useEffect, useState } from 'react';
import { EVENEMENT_VOIX_JUMEAU } from '@/lib/avatar/jumeau-creer';
import { Loader2, Plus, Trash2, Pencil, Check, X, Ear, Volume2 } from 'lucide-react';
import { texteParle } from '@/lib/voice/pipeline';
import {
  PRONONCIATIONS_MAX, PRONONCIATION_LONGUEUR_MAX, type Prononciation,
} from '@/lib/voice/prononciations';

/**
 * A_8e — MA VOIX & PRONONCIATION.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CET ÉCRAN PERMET, ET CE QU'IL NE TOUCHE JAMAIS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * « 25 % » se dit « vingt-cinq pour cent » : c'est une règle, elle vaut pour
 * tout le monde et Studiio l'applique seul. « Afroboost » se dit comme son
 * propriétaire le décide — personne d'autre ne peut le savoir.
 *
 * ⚠️ ET LE TEXTE AFFICHÉ NE BOUGE JAMAIS. Une règle ne change que ce que la
 * VOIX dit. Ce qui est écrit reste écrit : c'est lui qui part dans les
 * sous-titres, l'historique et la publication.
 *
 * ⚠️ AUCUN MOTEUR DE SYNTHÈSE N'EST APPELÉ ICI. L'aperçu est une fonction
 * pure ; l'afficher ne coûte rien et ne consomme aucun crédit.
 *
 * ⚠️ ET « ÉCOUTER » NE SUBSTITUE JAMAIS UNE VOIX. Tant qu'aucune voix clonée
 * n'existe, le bouton reste inerte et dit ce qui manque. Faire parler une voix
 * de catalogue en l'appelant « votre voix » serait un mensonge que personne ne
 * pourrait vérifier à l'oreille.
 */

const EXEMPLE = 'Rendez-vous chez Afroboost à 18h30, 25 CHF.';

export default function PrononciationsPanel() {
  const [regles, setRegles] = useState<Prononciation[]>([]);
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const [ajout, setAjout] = useState(false);
  const [display, setDisplay] = useState('');
  const [spoken, setSpoken] = useState('');
  const [edite, setEdite] = useState<string | null>(null);
  const [spokenEdite, setSpokenEdite] = useState('');
  /** La voix clonée du compte, si elle existe. `null` = aucune. */
  const [voix, setVoix] = useState<{ name?: string } | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/autopilot/bibliotheque-creative');
      const j = await r.json();
      const liste = j?.bibliotheque?.prononciations;
      setRegles(Array.isArray(liste) ? liste : []);
    } catch {
      setErreur('Vos prononciations n’ont pas pu être chargées.');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { void charger(); }, [charger]);

  /* Lecture seule, et purement locale : la route relit `user_voices` en base
     et n'appelle aucun fournisseur. */
  /* ⚠️ LA VOIX NOMMEE EST CELLE CHOISIE DANS « MA VOIX » — A_8h. Elle
     etait la premiere du compte ; avec deux voix clonees, l'ecran annoncait
     « Bassi studio » quand le jumeau devait parler avec « Bassi coach ». Le
     choix vit a UN endroit — `jumeauNumerique.userVoiceId`, ecrit par le
     panneau Autopilote — et il est relu ici, puis suivi quand il change.
     Une seule voix au compte reste nommee d'office : c'est la sienne. */
  useEffect(() => {
    let annule = false;
    const relire = async () => {
      try {
        const j = await (await fetch('/api/voice/clone')).json();
        const liste: { userVoiceId?: string; name?: string }[] = Array.isArray(j?.voices) ? j.voices : [];
        let choisie: string | null = null;
        try {
          const c = await (await fetch('/api/autopilot/jumeau')).json();
          choisie = typeof c?.jumeau?.userVoiceId === 'string' ? c.jumeau.userVoiceId : null;
        } catch { /* sans configuration, une seule voix reste nommee d'office */ }
        const retenue = liste.find((v) => v.userVoiceId && v.userVoiceId === choisie)
          ?? (liste.length === 1 ? liste[0] : null);
        if (!annule) setVoix(retenue ?? null);
      } catch {
        if (!annule) setVoix(null);
      }
    };
    void relire();
    const suivre = () => { void relire(); };
    window.addEventListener(EVENEMENT_VOIX_JUMEAU, suivre);
    return () => { annule = true; window.removeEventListener(EVENEMENT_VOIX_JUMEAU, suivre); };
  }, []);

  /**
   * ⚠️ LA BIBLIOTHÈQUE ENTIÈRE EST RELUE AVANT D'ÉCRIRE. La route existante
   * remplace le document complet : n'envoyer que les prononciations effacerait
   * les favoris, les presets et la banque audio du même coup.
   */
  const enregistrer = async (suivantes: Prononciation[]) => {
    setEnvoi(true);
    setErreur(null);
    try {
      const actuelle = await (await fetch('/api/autopilot/bibliotheque-creative')).json();
      const r = await fetch('/api/autopilot/bibliotheque-creative', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bibliotheque: { ...(actuelle?.bibliotheque ?? {}), prononciations: suivantes },
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        setErreur(j?.error ?? 'Vos prononciations n’ont pas pu être enregistrées.');
        return false;
      }
      setRegles(j.bibliotheque?.prononciations ?? suivantes);
      return true;
    } catch {
      setErreur('Vos prononciations n’ont pas pu être enregistrées.');
      return false;
    } finally {
      setEnvoi(false);
    }
  };

  const complet = regles.length >= PRONONCIATIONS_MAX;
  const dejaLa = regles.some((r) => r.display.toLowerCase() === display.trim().toLowerCase());
  const ajoutValide = display.trim().length > 0 && spoken.trim().length > 0
    && display.trim().length <= PRONONCIATION_LONGUEUR_MAX
    && spoken.trim().length <= PRONONCIATION_LONGUEUR_MAX
    && !dejaLa && !complet;

  const ajouter = async () => {
    if (!ajoutValide) return;
    const ok = await enregistrer([
      ...regles, { display: display.trim(), spoken: spoken.trim() },
    ]);
    if (ok) { setDisplay(''); setSpoken(''); setAjout(false); }
  };

  const supprimer = (cle: string) =>
    enregistrer(regles.filter((r) => r.display !== cle));

  const confirmerEdition = async (cle: string) => {
    if (spokenEdite.trim().length === 0) return;
    const ok = await enregistrer(regles.map(
      (r) => (r.display === cle ? { ...r, spoken: spokenEdite.trim() } : r),
    ));
    if (ok) setEdite(null);
  };

  const apercu = texteParle(EXEMPLE, { prononciations: regles });

  return (
    <div className="card-base p-6 space-y-5" data-prononciations>
      <div>
        <h2 className="font-semibold">Ma voix &amp; prononciation</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Studiio adapte la façon dont certains mots sont prononcés, sans jamais
          modifier le texte affiché.
        </p>
      </div>

      {erreur && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {erreur}
        </div>
      )}

      {/* ── L'exemple, pour montrer ce que la section fait ─────────── */}
      <div className="rounded-xl bg-gray-900/60 p-4 grid sm:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-gray-500 mb-1">Texte</div>
          <p className="text-gray-300" data-prononciations-exemple-display>{EXEMPLE}</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-gray-500 mb-1">
            <Ear className="w-3 h-3" /> Prononciation
          </div>
          <p className="text-gray-200" data-prononciations-exemple-spoken>{apercu}</p>
        </div>
      </div>

      {/* ── Écouter : préparé, et honnête sur ce qu'il ne fait pas encore ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled
          data-prononciations-ecouter
          className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Volume2 className="w-3.5 h-3.5" /> Écouter ma voix
        </button>
        {voix === null ? (
          <span className="text-xs text-gray-500" data-prononciations-sans-voix>
            Configurez votre voix pour écouter cet aperçu.
          </span>
        ) : (
          <span className="text-xs text-gray-500" data-prononciations-avec-voix>
            Sera dit avec votre voix : {voix.name}. L’écoute arrivera avec votre clone.
          </span>
        )}
      </div>

      {chargement ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
        </div>
      ) : (
        <>
          {regles.length > 0 && (
            <ul className="space-y-2" data-prononciations-liste>
              {regles.map((r) => (
                <li
                  key={r.display}
                  data-prononciation={r.display}
                  className="flex items-center gap-2 rounded-lg border border-gray-800 px-3 py-2 text-sm"
                >
                  <span className="text-gray-300 truncate max-w-[10rem]">{r.display}</span>
                  <span className="text-gray-600">→</span>
                  {edite === r.display ? (
                    <>
                      <input
                        value={spokenEdite}
                        onChange={(e) => setSpokenEdite(e.target.value)}
                        maxLength={PRONONCIATION_LONGUEUR_MAX}
                        data-prononciation-edition
                        className="flex-1 min-w-0 rounded bg-gray-900 border border-gray-700 px-2 py-1 text-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => confirmerEdition(r.display)}
                        disabled={envoi}
                        aria-label="Enregistrer"
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEdite(null)}
                        aria-label="Annuler"
                        className="text-gray-500 hover:text-gray-300"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-200 flex-1 min-w-0 truncate">{r.spoken}</span>
                      <button
                        type="button"
                        onClick={() => { setEdite(r.display); setSpokenEdite(r.spoken); }}
                        aria-label={`Modifier la prononciation de ${r.display}`}
                        data-prononciation-modifier={r.display}
                        className="text-gray-500 hover:text-gray-200"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => supprimer(r.display)}
                        disabled={envoi}
                        aria-label={`Supprimer la prononciation de ${r.display}`}
                        data-prononciation-supprimer={r.display}
                        className="text-gray-500 hover:text-red-300"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {ajout ? (
            <div className="rounded-xl border border-gray-800 p-3 space-y-2" data-prononciation-formulaire>
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="text-xs text-gray-400">
                  Texte affiché
                  <input
                    value={display}
                    onChange={(e) => setDisplay(e.target.value)}
                    maxLength={PRONONCIATION_LONGUEUR_MAX}
                    data-prononciation-display
                    className="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1.5 text-sm text-gray-200"
                    placeholder="Afroboost"
                  />
                </label>
                <label className="text-xs text-gray-400">
                  Prononcer comme
                  <input
                    value={spoken}
                    onChange={(e) => setSpoken(e.target.value)}
                    maxLength={PRONONCIATION_LONGUEUR_MAX}
                    data-prononciation-spoken
                    className="mt-1 w-full rounded bg-gray-900 border border-gray-700 px-2 py-1.5 text-sm text-gray-200"
                    placeholder="Afro boost"
                  />
                </label>
              </div>
              {dejaLa && (
                <p className="text-xs text-amber-300" data-prononciation-doublon>
                  Une prononciation existe déjà pour ce texte.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={ajouter}
                  disabled={!ajoutValide || envoi}
                  data-prononciation-confirmer
                  className="rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-3 py-1.5 text-xs font-medium"
                >
                  {envoi ? 'Enregistrement…' : 'Ajouter'}
                </button>
                <button
                  type="button"
                  onClick={() => { setAjout(false); setDisplay(''); setSpoken(''); }}
                  className="text-xs text-gray-400 hover:text-gray-200"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAjout(true)}
              disabled={complet}
              data-prononciation-ajouter
              className="flex items-center gap-1.5 rounded-lg border border-gray-800 hover:border-purple-500/60 disabled:opacity-50 px-3 py-2 text-xs text-gray-300"
            >
              <Plus className="w-3.5 h-3.5" /> Ajouter une prononciation
            </button>
          )}

          {complet && (
            <p className="text-xs text-amber-300" data-prononciations-plein>
              Vous avez atteint {PRONONCIATIONS_MAX} prononciations. Supprimez-en
              une pour en ajouter une autre.
            </p>
          )}
        </>
      )}
    </div>
  );
}
