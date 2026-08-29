'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Film, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { uploadFile } from '@/lib/storage/uploadFile';
import AnalyseRush from '@/components/creer/AnalyseRush';
import type { ShootSession, Rush } from '@/lib/autopilot/tournage/contrat';

/**
 * Sessions de tournage — l'écran minimal du socle M3-A.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nommer un tournage, y déposer des rushes, voir ceux qui sont indexés, et —
 * depuis M3-B3 — demander l'analyse d'un rush vérifié puis en suivre l'état.
 * Rien d'autre : ni sélection de moments, ni montage, ni « créer 10 vidéos ».
 * Ces boutons viendront avec les fonctionnalités qui les portent — les poser
 * maintenant promettrait ce qui n'existe pas.
 *
 * L'analyse elle-même vit dans `AnalyseRush`, un composant par ligne : c'est
 * lui qui interroge le serveur et qui arrête son suivi en disparaissant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEPUIS N'IMPORTE QUEL VOLUME, SANS COPIE LOCALE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `<input type="file" multiple>` ordinaire. C'est le sélecteur du système
 * qui s'ouvre : SSD externe, carte SD, clé USB, disque interne — tout volume
 * monté est atteignable, et rien à écrire pour ça.
 *
 * Le fichier n'est PAS copié sur le disque interne, et n'est pas chargé en
 * mémoire : `uploadFile` découpe au-delà de 8 Mio et envoie chaque morceau
 * par `file.slice()`, que le navigateur lit paresseusement depuis le volume
 * d'origine. Quelqu'un dont le disque est plein peut donc téléverser
 * plusieurs centaines de gigaoctets depuis une carte mémoire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÉBRANCHER LA CARTE PENDANT L'ENVOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La lecture échoue, l'envoi s'interrompt, et le morceau n'arrive pas. Aucun
 * rush n'est indexé pour autant : l'indexation est demandée APRÈS l'envoi, et
 * le serveur ne l'accepte qu'après avoir REGARDÉ l'objet dans le stockage. Un
 * fichier absent ou tronqué est refusé — l'écran le dit, et la liste ne
 * contient que ce qui existe vraiment.
 */

interface EnCours {
  nom: string;
  pourcent: number;
  erreur?: string;
}

export default function SessionsTournagePanel() {
  const [sessions, setSessions] = useState<ShootSession[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [rushes, setRushes] = useState<Rush[]>([]);
  const [titre, setTitre] = useState('');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envois, setEnvois] = useState<EnCours[]>([]);
  const fichiersRef = useRef<HTMLInputElement>(null);

  const chargerSessions = useCallback(async () => {
    setChargement(true);
    try {
      const d = await fetch('/api/autopilot/sessions').then((r) => r.json());
      if (d?.ok && Array.isArray(d.sessions)) {
        setSessions(d.sessions);
        setErreur(null);
      } else {
        setSessions([]);
        setErreur(d?.error || 'Sessions indisponibles.');
      }
    } catch {
      setErreur('Sessions indisponibles.');
    } finally {
      setChargement(false);
    }
  }, []);

  const chargerRushes = useCallback(async (id: string) => {
    try {
      const d = await fetch(`/api/autopilot/sessions/${id}/rushes`).then((r) => r.json());
      setRushes(d?.ok && Array.isArray(d.rushes) ? d.rushes : []);
    } catch {
      setRushes([]);
    }
  }, []);

  useEffect(() => { chargerSessions(); }, [chargerSessions]);
  useEffect(() => { if (selection) chargerRushes(selection); }, [selection, chargerRushes]);

  const creer = async () => {
    const t = titre.trim();
    if (!t) return;
    setErreur(null);
    try {
      const d = await fetch('/api/autopilot/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titre: t }),
      }).then((r) => r.json());
      if (!d?.ok || !d.session) { setErreur(d?.error || 'Création impossible.'); return; }
      setTitre('');
      setSessions((prev) => [d.session, ...prev]);
      setSelection(d.session.id);
    } catch {
      setErreur('Création impossible.');
    }
  };

  /**
   * Téléverse puis indexe, fichier par fichier.
   *
   * Séquentiel, et c'est voulu : dix envois simultanés depuis une carte
   * mémoire se disputent le même bus et finissent plus lentement que dix
   * envois à la suite — en plus de rendre la progression illisible.
   */
  const ajouterFichiers = async (fichiers: File[]) => {
    if (!selection || fichiers.length === 0) return;
    setEnvois(fichiers.map((f) => ({ nom: f.name, pourcent: 0 })));

    for (let i = 0; i < fichiers.length; i += 1) {
      const f = fichiers[i];
      const majEtat = (patch: Partial<EnCours>) => {
        setEnvois((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        const envoye = await uploadFile(f, {
          purpose: 'rush',
          onProgress: (p) => majEtat({ pourcent: Math.round(p) }),
        });
        // L'indexation vient APRÈS l'envoi, et le serveur vérifiera lui-même
        // que l'objet est là. Un envoi interrompu n'arrive jamais ici, et s'il
        // y arrivait, la vérification le refuserait.
        // eslint-disable-next-line no-await-in-loop
        const d = await fetch(`/api/autopilot/sessions/${selection}/rushes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bucket: envoye.bucket, path: envoye.path, nomOrigine: f.name,
          }),
        }).then((r) => r.json());
        if (!d?.ok) { majEtat({ erreur: d?.error || 'Indexation refusée.' }); continue; }
        majEtat({ pourcent: 100 });
      } catch (e) {
        // Volume débranché, fichier illisible, réseau coupé : on le dit, et
        // on ne fabrique aucun rush.
        majEtat({ erreur: e instanceof Error ? e.message : 'Envoi interrompu.' });
      }
    }
    if (selection) await chargerRushes(selection);
  };

  return (
    <div className="space-y-3" data-tournage-panel>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); creer(); } }}
          placeholder="Nom du tournage — ex : cours du samedi"
          data-tournage-titre
          className="flex-1 rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none px-2.5 py-2 text-sm"
        />
        <button
          type="button"
          onClick={creer}
          disabled={!titre.trim()}
          data-tournage-creer
          className="flex items-center gap-1 rounded-lg border border-gray-800 px-2.5 py-2 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Nouvelle session
        </button>
      </div>

      {erreur && <p className="text-xs text-gray-500" data-tournage-erreur>{erreur}</p>}
      {chargement && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}

      {sessions.length > 0 && (
        <ul className="space-y-1" data-tournage-liste>
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelection(s.id)}
                data-tournage-session={s.id}
                aria-pressed={selection === s.id}
                className={`w-full text-left rounded-lg border px-2.5 py-2 text-sm transition-colors ${
                  selection === s.id
                    ? 'border-purple-500 text-white'
                    : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                }`}
              >
                {s.titre}
                <span className="ml-2 text-[11px] text-gray-500">{s.statut}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selection && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-2">
          {/* Un input de fichiers ordinaire : c'est le sélecteur du système
              qui s'ouvre, donc TOUT volume monté — SSD, carte SD, clé USB.
              Rien de spécial à écrire pour ça, et surtout aucune copie
              préalable sur le disque interne. */}
          <input
            ref={fichiersRef}
            type="file"
            multiple
            accept="video/*"
            data-tournage-fichiers
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              e.target.value = '';
              ajouterFichiers(fs);
            }}
          />
          <button
            type="button"
            onClick={() => fichiersRef.current?.click()}
            data-tournage-ajouter
            className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-2.5 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 transition-colors"
          >
            <Film className="w-3.5 h-3.5" /> Ajouter des rushes
          </button>
          <p className="text-[11px] text-gray-500">
            Depuis n’importe quel volume — SSD externe, carte mémoire, clé USB.
            Les fichiers ne sont pas copiés sur votre ordinateur.
          </p>

          {envois.length > 0 && (
            <ul className="space-y-1" data-tournage-envois>
              {envois.map((e) => (
                <li key={e.nom} className="flex items-center gap-2 text-xs">
                  {e.erreur
                    ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    : <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${e.pourcent === 100 ? 'text-emerald-400' : 'text-gray-600'}`} />}
                  <span className="flex-1 truncate text-gray-400">{e.nom}</span>
                  <span className="text-gray-500">
                    {e.erreur ? e.erreur : `${e.pourcent}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <ul className="space-y-2" data-tournage-rushes>
            {rushes.map((r) => (
              <li key={r.id} data-tournage-rush={r.id} className="text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 shrink-0 text-center text-gray-500">{r.rang + 1}</span>
                  <span className="flex-1 truncate text-gray-400">
                    {r.nomOrigine || r.cleObjet}
                  </span>
                  <span className="shrink-0 text-gray-500" data-tournage-rush-etat={r.etat}>{r.etat}</span>
                </div>
                {/* L'analyse ne s'affiche que pour un rush VÉRIFIÉ — le seul
                    que la route accepte de mesurer. La proposer sur un rush
                    `indexe` ou `absent` reviendrait à offrir un bouton dont on
                    sait déjà qu'il rendra 409. Le décalage vers la droite
                    aligne le bloc sous le nom, pas sous le numéro. */}
                {r.etat === 'verifie' && (
                  <div className="pl-7">
                    <AnalyseRush rushId={r.id} />
                  </div>
                )}
              </li>
            ))}
            {rushes.length === 0 && (
              <li className="text-xs text-gray-500">Aucun rush indexé pour l’instant.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
