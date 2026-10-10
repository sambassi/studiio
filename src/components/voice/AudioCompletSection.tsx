'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Download, AudioLines } from 'lucide-react';
import {
  MAX_CARACTERES_AUDIO_COMPLET, coutAudioComplet, libelleBoutonAudioComplet, messageCreditsInsuffisants,
  MESSAGE_AUDIO_COMPLET_ECHEC,
} from '@/lib/voice/audio-complet';

/**
 * « Audio complet » — section de « Ma voix », séparée de la pré-écoute
 * gratuite. Payante : le prix annoncé sur le bouton vient de la même
 * fonction pure que le serveur (`coutAudioComplet`), mais seul le serveur le
 * calcule et débite ; l'écran n'envoie que `{ texte }`. Le bouton est
 * désactivé pendant la génération (pas de double clic). Le lecteur complet
 * et le lien « Télécharger l'audio » n'apparaissent qu'APRÈS un succès.
 */
export default function AudioCompletSection({ disponible }: { disponible: boolean }) {
  const [texteComplet, setTexteComplet] = useState('');
  const [generationEnCours, setGenerationEnCours] = useState(false);
  const generationRef = useRef(false);
  const [audioComplet, setAudioComplet] = useState<{ url: string; creditsDebites: number; dejaGenere: boolean } | null>(null);
  const [erreurComplet, setErreurComplet] = useState<string | null>(null);
  const [administrateur, setAdministrateur] = useState(false);

  // Libellé du prix seulement : le serveur relit lui-même l'exemption.
  useEffect(() => {
    let actif = true;
    fetch('/api/credits/balance')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (actif && j && j.politique === 'partner_cost_only') setAdministrateur(true); })
      .catch(() => { /* libellé standard */ });
    return () => { actif = false; };
  }, []);

  const genererAudioComplet = async () => {
    if (generationRef.current || !texteComplet.trim()) return;
    generationRef.current = true;
    setGenerationEnCours(true); setErreurComplet(null); setAudioComplet(null);
    try {
      // Rien d'autre que le texte : le prix est calculé par le serveur.
      const res = await fetch('/api/voice/audio-complet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texte: texteComplet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || typeof json.url !== 'string') {
        if (res.status === 402) setErreurComplet(json.error || messageCreditsInsuffisants(Number(json.cout) || coutAudioComplet(texteComplet.trim().length)));
        else setErreurComplet(json.error || MESSAGE_AUDIO_COMPLET_ECHEC);
        return;
      }
      setAudioComplet({ url: json.url, creditsDebites: Number(json.creditsDebites) || 0, dejaGenere: json.dejaGenere === true });
    } catch {
      setErreurComplet(MESSAGE_AUDIO_COMPLET_ECHEC);
    } finally {
      generationRef.current = false;
      setGenerationEnCours(false);
    }
  };

  return (
          <section data-audio-complet className="space-y-3 border-t border-white/10 pt-6">
      <h3 className="font-semibold flex items-center gap-2"><AudioLines className="w-4 h-4" /> Audio complet</h3>
      <p className="text-xs text-gray-400">
        Génère tout votre texte avec votre voix, à écouter et télécharger. 1 crédit par tranche de 1000 caractères entamée.
      </p>
      <textarea
        data-audio-complet-texte
        value={texteComplet}
        onChange={(e) => setTexteComplet(e.target.value.slice(0, MAX_CARACTERES_AUDIO_COMPLET))}
        maxLength={MAX_CARACTERES_AUDIO_COMPLET}
        rows={5}
        placeholder="Collez ici le texte complet à faire dire par votre voix."
        className="w-full rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-white"
      />
      <div data-audio-complet-compteur className="text-xs text-gray-400">{texteComplet.trim().length}/{MAX_CARACTERES_AUDIO_COMPLET} caractères</div>
      {disponible ? (
        <button
          data-audio-complet-generer
          onClick={() => void genererAudioComplet()}
          disabled={generationEnCours || !texteComplet.trim()}
          className="button-primary flex items-center gap-2 disabled:opacity-40"
        >
          {generationEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <AudioLines className="w-4 h-4" />}
          {libelleBoutonAudioComplet(texteComplet.trim().length, administrateur)}
        </button>
      ) : (
        <div data-audio-complet-indisponible className="text-sm text-gray-400">La génération de l’audio complet n’est pas encore disponible.</div>
      )}
      {erreurComplet && <div data-audio-complet-erreur className="text-sm text-red-200">{erreurComplet}</div>}
      {audioComplet && (
        <div data-audio-complet-resultat className="space-y-2">
          <audio data-audio-complet-lecteur src={audioComplet.url} controls className="w-full" />
          <div className="flex items-center gap-3 text-sm">
            <a data-audio-complet-telecharger href={audioComplet.url} download className="flex items-center gap-1.5 text-gray-200 hover:text-white">
              <Download className="w-4 h-4" /> Télécharger l’audio
            </a>
            <span className="text-xs text-gray-400">
              {audioComplet.dejaGenere ? 'Déjà généré : aucun crédit débité.' : `${audioComplet.creditsDebites} crédit${audioComplet.creditsDebites > 1 ? 's' : ''} débité${audioComplet.creditsDebites > 1 ? 's' : ''}.`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
