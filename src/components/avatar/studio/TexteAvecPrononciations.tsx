'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Volume2, X } from 'lucide-react';
import { scriptParle, type Prononciation } from '@/lib/voice/prononciations';
import {
  ajouterPrononciationAuCompte, ecouterAvecMaVoix, lireProfilVoixClient, EVENEMENT_PRONONCIATIONS,
} from '@/lib/voice/profilClient';
import { motSelectionne } from '@/lib/avatar/studio';

/**
 * Un texte, et ses MOTS DIFFICILES — sur le dictionnaire du compte.
 *
 * Sélectionner un mot → « Ajouter une prononciation » → « Prononcer comme »,
 * « Écouter », « Enregistrer ». La règle rejoint le dictionnaire EXISTANT
 * (`PUT /api/voice/profil/prononciations`) : elle vaut ensuite dans Créer,
 * l'Autopilote, l'écoute et la génération du jumeau.
 *
 * Le texte VISIBLE n'est jamais modifié : seul le texte PARLÉ (calculé par
 * `scriptParle`, la fonction commune) change, et il est montré à part.
 */
export default function TexteAvecPrononciations(props: {
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  /** Montrer « Ce que la voix dira » (le texte parlé) sous le champ. */
  montrerParle?: boolean;
  attributs?: Record<string, string>;
}) {
  const { valeur, onChange } = props;
  const zone = useRef<HTMLTextAreaElement | null>(null);
  const [prononciations, setPrononciations] = useState<Prononciation[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<{ affiche: string; prononce: string } | null>(null);
  const [etat, setEtat] = useState<'repos' | 'ecoute' | 'enregistrement'>('repos');
  const [message, setMessage] = useState<{ niveau: 'erreur' | 'succes'; texte: string } | null>(null);
  const [audio, setAudio] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    const relire = () => { void lireProfilVoixClient().then((p) => { if (vivant && p) setPrononciations(p.prononciations); }); };
    relire();
    window.addEventListener(EVENEMENT_PRONONCIATIONS, relire);
    return () => { vivant = false; window.removeEventListener(EVENEMENT_PRONONCIATIONS, relire); };
  }, []);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);

  const parle = useMemo(() => scriptParle(valeur, prononciations), [valeur, prononciations]);
  const lireSelection = () => {
    const z = zone.current;
    setSelection(z ? motSelectionne(z.value, z.selectionStart, z.selectionEnd) : null);
  };

  const ouvrir = () => {
    setMessage(null);
    setBrouillon({ affiche: selection ?? '', prononce: '' });
  };
  const ecouter = async () => {
    if (!brouillon?.prononce.trim() || etat !== 'repos') return;
    setEtat('ecoute'); setMessage(null);
    const r = await ecouterAvecMaVoix(brouillon.prononce.trim());
    setEtat('repos');
    if (!r.ok) { setMessage({ niveau: 'erreur', texte: r.message }); return; }
    if (audio) URL.revokeObjectURL(audio);
    setAudio(r.url);
  };
  const enregistrer = async () => {
    if (!brouillon || etat !== 'repos') return;
    setEtat('enregistrement'); setMessage(null);
    const r = await ajouterPrononciationAuCompte({ affiche: brouillon.affiche, prononce: brouillon.prononce });
    setEtat('repos');
    if (!r.ok) { setMessage({ niveau: 'erreur', texte: r.message }); return; }
    setPrononciations(r.prononciations);
    setMessage({ niveau: 'succes', texte: `« ${brouillon.affiche} » sera prononcé « ${brouillon.prononce} » partout.` });
    setBrouillon(null);
    setSelection(null);
  };

  return (
    <div className="space-y-2" data-texte-prononce>
      <textarea
        ref={zone}
        value={valeur}
        onChange={(e) => onChange(props.maxLength ? e.target.value.slice(0, props.maxLength) : e.target.value)}
        onSelect={lireSelection}
        onKeyUp={lireSelection}
        onMouseUp={lireSelection}
        rows={props.rows ?? 5}
        placeholder={props.placeholder}
        className="input-base w-full resize-none"
        {...(props.attributs ?? {})}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={ouvrir}
          data-prononciation-ajouter
          className="inline-flex items-center gap-1.5 text-purple-300 hover:text-purple-200"
          title={selection ? `Ajouter une prononciation pour « ${selection} »` : 'Sélectionnez un mot difficile, puis ajoutez sa prononciation'}
        >
          <Plus className="w-3.5 h-3.5" />
          {selection ? `Ajouter une prononciation pour « ${selection} »` : 'Ajouter une prononciation'}
        </button>
        {props.maxLength && <span className="text-gray-500">{valeur.length} / {props.maxLength}</span>}
      </div>

      {brouillon && (
        <div data-prononciation-formulaire className="rounded-xl bg-black/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Prononciation</span>
            <button type="button" aria-label="Fermer" onClick={() => setBrouillon(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-400 space-y-1 block">
              <span>Mot</span>
              <input data-prononciation-mot value={brouillon.affiche} onChange={(e) => setBrouillon({ ...brouillon, affiche: e.target.value })} className="input-base w-full" maxLength={80} />
            </label>
            <label className="text-xs text-gray-400 space-y-1 block">
              <span>Prononcer comme</span>
              <input data-prononciation-prononce value={brouillon.prononce} onChange={(e) => setBrouillon({ ...brouillon, prononce: e.target.value })} placeholder="ex. Neu-cha-tel" className="input-base w-full" maxLength={80} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={ecouter} disabled={!brouillon.prononce.trim() || etat !== 'repos'} className="inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white disabled:opacity-40">
              {etat === 'ecoute' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />} Écouter
            </button>
            <button type="button" data-prononciation-enregistrer onClick={enregistrer} disabled={!brouillon.affiche.trim() || !brouillon.prononce.trim() || etat !== 'repos'} className="button-primary text-sm px-4 py-2 disabled:opacity-40">
              {etat === 'enregistrement' ? 'Enregistrement…' : 'Enregistrer la prononciation'}
            </button>
          </div>
          {audio && <audio src={audio} controls autoPlay className="w-full h-9" />}
        </div>
      )}

      {message && (
        <div data-prononciation-message={message.niveau} className={`text-xs ${message.niveau === 'erreur' ? 'text-red-300' : 'text-emerald-300'}`}>{message.texte}</div>
      )}

      {props.montrerParle && parle !== valeur && valeur.trim() && (
        <div data-texte-parle className="text-xs text-gray-500">
          <span className="text-gray-400">Ce que la voix dira : </span>{parle}
        </div>
      )}
    </div>
  );
}
