'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarRange, Check, Crop, Loader2, Plus, Save, Settings2,
} from 'lucide-react';
import { uploadFile } from '@/lib/storage/uploadFile';
import AnalyseRush from '@/components/creer/AnalyseRush';
import BandeRushes, { type AnalyseCarte } from '@/components/creer/BandeRushes';
import ContenuAnalyse from '@/components/creer/ContenuAnalyse';
import AideAutopilote from '@/components/creer/AideAutopilote';
import DrawerLateral from '@/components/ui/DrawerLateral';
import MenuActions from '@/components/ui/MenuActions';
import { lireAnalyse } from '@/lib/autopilot/analyse/passerelle';
import {
  MONTAGE_DEFAUT, type AutopilotMontageStyle,
} from '@/lib/autopilot/textStyle';
import type { RecetteAudio } from '@/lib/autopilot/analyse/recette-audio';
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

/**
 * Ce que l'écran propose, et RIEN DE PLUS.
 *
 * ⚠️ AUCUN RÉGLAGE DE TEXTE, D'AUDIO, DE VOIX NI DE LOOK. Le moteur des
 * rushes concatène des morceaux recadrés : sa commande ffmpeg n'a ni
 * `drawtext`, ni `amix`, ni `lut3d`. Un contrôle de plus serait enregistré et
 * ignoré au rendu — exactement le genre de réglage qui fait croire à une
 * panne. Le format et la durée, eux, sont de vrais paramètres de M3-G.
 */
const FORMATS = [
  { valeur: '9:16', libelle: 'Vertical' },
  { valeur: '1:1', libelle: 'Carré' },
  { valeur: '16:9', libelle: 'Horizontal' },
] as const;

/** Trois durées usuelles, toutes dans les bornes du contrat (1–120 s). */
const DUREES = [15, 30, 60] as const;

interface Props {
  /** Le réglage enregistré de l'utilisateur, ou le défaut. */
  montageDefaut?: AutopilotMontageStyle;
  /** Enregistre le réglage courant comme défaut. Absent = bouton masqué. */
  onEnregistrerDefaut?: (m: AutopilotMontageStyle) => void | Promise<void>;
  /** Le réglage AUDIO enregistré du compte. Passe-plat vers `AnalyseRush`. */
  audioDefaut?: RecetteAudio;
  /** Enregistre la recette audio comme défaut. Absent = bouton masqué. */
  onEnregistrerAudioDefaut?: (recette: RecetteAudio) => Promise<boolean>;
  /**
   * Remonte la session regardée, pour que l'aperçu de la colonne de droite
   * sache quoi montrer. C'est ce qui permet d'avoir UN SEUL aperçu.
   */
  onSessionChange?: (etat: {
    sessionId: string | null;
    aucunRush: boolean;
    /**
     * Le format CHOISI a l'instant, pas celui du dernier rendu.
     *
     * ⚠️ C'EST CE QUI CORRIGE L'APERCU QUI MENTAIT. Le cadre de droite se
     * calait sur les dimensions du rendu EXISTANT : on choisissait 9:16 et
     * il restait horizontal, parce que la derniere video l'etait. Le cadre
     * suit desormais la demande tant qu'aucune video ne repond.
     */
    format: string;
  }) => void;
  /**
   * Prévient que la création d'une vidéo vient de partir.
   *
   * L'aperçu vit désormais dans la colonne de droite : c'est LUI qu'il faut
   * réveiller, et il n'est plus dans cet arbre. Le signal remonte donc.
   */
  onVideoLancee?: () => void;
  /**
   * Ce que le tiroir « Avancé » contient.
   *
   * ⚠️ C'EST UN RECEPTACLE, PAS UNE FONCTION. LUT, texte, branding, voix
   * viendront ici — et n'allongeront donc jamais la page principale. Il est
   * decide maintenant, pendant qu'il ne coute rien.
   */
  avance?: React.ReactNode;
}

export default function SessionsTournagePanel({
  montageDefaut, onEnregistrerDefaut, onSessionChange, onVideoLancee, audioDefaut,
  onEnregistrerAudioDefaut, avance,
}: Props = {}) {
  const [sessions, setSessions] = useState<ShootSession[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [rushes, setRushes] = useState<Rush[]>([]);
  const [titre, setTitre] = useState('');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envois, setEnvois] = useState<EnCours[]>([]);
  /**
   * Le réglage de CETTE vidéo.
   *
   * ⚠️ IL NE S'ENREGISTRE PAS TOUT SEUL. Changer le format pour un montage ne
   * doit pas changer tous les montages suivants : l'écriture dans la
   * configuration demande un second geste, explicite.
   */
  const [montage, setMontage] = useState<AutopilotMontageStyle>(
    montageDefaut ?? MONTAGE_DEFAUT,
  );
  const [defautEnregistre, setDefautEnregistre] = useState(false);
  /** Le rush qu'on regarde : il pilote la chaine et le bouton unique. */
  const [rushChoisi, setRushChoisi] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalyseCarte | null>>({});
  const [tiroir, setTiroir] = useState<'analyse' | 'avance' | null>(null);
  const [relances, setRelances] = useState<Record<string, number>>({});
  const [nouvelleSession, setNouvelleSession] = useState(false);

  // Le réglage enregistré arrive après le premier rendu (la config se charge
  // en réseau) : on s'y accorde tant que l'utilisateur n'a rien touché.
  const toucheRef = useRef(false);
  useEffect(() => {
    if (!toucheRef.current && montageDefaut) setMontage(montageDefaut);
  }, [montageDefaut]);

  const changerMontage = (patch: Partial<AutopilotMontageStyle>) => {
    toucheRef.current = true;
    setDefautEnregistre(false);
    setMontage((m) => ({ ...m, ...patch }));
  };

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

  /**
   * La premiere session s'ouvre d'elle-meme.
   *
   * ⚠️ LE SELECTEUR L'EXIGE. Avec une liste de boutons, ne rien choisir etait
   * un etat lisible : rien n'etait surligne. Un `<select>` sans valeur, lui,
   * AFFICHE quand meme sa premiere option — l'ecran aurait donc nomme un
   * tournage tout en n'en ayant ouvert aucun, et la bande de rushes serait
   * restee vide sans raison visible.
   */
  useEffect(() => {
    setSelection((actuelle) => {
      if (actuelle && sessions.some((x) => x.id === actuelle)) return actuelle;
      return sessions[0]?.id ?? null;
    });
  }, [sessions]);
  useEffect(() => { if (selection) chargerRushes(selection); }, [selection, chargerRushes]);

  /**
   * Le rush regarde par defaut : le premier qui soit exploitable.
   *
   * ⚠️ UN SEUL RUSH A LA FOIS, ET C'EST LE FOND DE LA REFONTE. L'ecran
   * montait auparavant la chaine COMPLETE — analyse, passages, audio, bouton
   * — pour CHAQUE rush verifie. Trois rushes faisaient trois panneaux audio
   * et trois « Creer ma video », alors que le moteur, lui, part d'UN rush.
   * L'ecran dit desormais la meme chose que le moteur.
   */
  useEffect(() => {
    setRushChoisi((actuel) => {
      if (actuel && rushes.some((r) => r.id === actuel)) return actuel;
      return rushes.find((r) => r.etat === 'verifie')?.id ?? rushes[0]?.id ?? null;
    });
  }, [rushes]);

  /**
   * L'etat d'analyse de CHAQUE rush — pour la miniature et le ✓ des cartes.
   *
   * ⚠️ `GET` UNIQUEMENT, ET MOINS DE REQUETES QU'AVANT. Chaque rush verifie
   * montait un `AnalyseRush` qui sondait pour son compte ; ici une passe de
   * lecture suffit, et elle ne se repete que tant qu'une analyse bouge.
   */
  const chargerAnalyses = useCallback(async (liste: Rush[]) => {
    const paires = await Promise.all(liste.map(async (r) => {
      const a = await lireAnalyse(r.id);
      const carte: AnalyseCarte | null = a.sorte === 'trouvee'
        ? { id: a.analyse.id, etat: a.analyse.etat, dureeSecondes: a.analyse.dureeSecondes }
        : null;
      return [r.id, carte] as const;
    }));
    setAnalyses(Object.fromEntries(paires));
  }, []);

  useEffect(() => {
    if (rushes.length === 0) { setAnalyses({}); return; }
    chargerAnalyses(rushes);
  }, [rushes, chargerAnalyses]);

  /**
   * ⚠️ ON NE SONDE QUE TANT QU'UNE ANALYSE BOUGE. `reussie`, `echouee` et
   * `annulee` ne se rouvrent pas : continuer serait une requete toutes les
   * huit secondes, pour toujours, sur un resultat fige.
   */
  const enVol = Object.values(analyses)
    .some((a) => a !== null && (a.etat === 'en_cours' || a.etat === 'en_attente'));
  useEffect(() => {
    if (!enVol || rushes.length === 0) return undefined;
    const t = setInterval(() => chargerAnalyses(rushes), 8000);
    return () => clearInterval(t);
  }, [enVol, rushes, chargerAnalyses]);

  // L'aperçu unique de la colonne de droite a besoin de savoir QUEL tournage
  // on regarde. Sans ce signal, il faudrait un second lecteur ici.
  useEffect(() => {
    onSessionChange?.({
      sessionId: selection, aucunRush: rushes.length === 0, format: montage.format,
    });
  }, [selection, rushes.length, montage.format, onSessionChange]);

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

  const rushActif = rushes.find((r) => r.id === rushChoisi) ?? null;
  const nomRushActif = rushActif
    ? (rushActif.nomOrigine || rushActif.cleObjet.split('/').pop() || 'rush')
      .replace(/^\d{10,}-/, '')
    : '';

  return (
    <div className="space-y-4" data-tournage-panel>
      {/* ══ EN-TETE ══════════════════════════════════════════════════════
          Une ligne : la session qu'on regarde, et un « ⋯ » pour ce qui la
          concerne. Creer et nommer un tournage sont des gestes rares ; ils
          n'ont pas a occuper deux champs en permanence. */}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="session-active">Session de tournage</label>
        <select
          id="session-active"
          value={selection ?? ''}
          onChange={(e) => setSelection(e.target.value || null)}
          data-tournage-selecteur
          disabled={sessions.length === 0}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2 py-1.5
            text-[13px] text-gray-100 outline-none focus:border-purple-500 disabled:opacity-40"
        >
          {sessions.length === 0 && <option value="">Aucune session</option>}
          {sessions.map((x) => (
            <option key={x.id} value={x.id}>{x.titre}</option>
          ))}
        </select>
        <AideAutopilote />
        <MenuActions
          marqueur="session"
          etiquette="Réglages de la session"
          titreGroupe="Session"
          icone={<CalendarRange className="h-4 w-4" />}
          actions={[
            {
              libelle: 'Nouvelle session',
              icone: <Plus className="h-3.5 w-3.5" />,
              onClick: () => setNouvelleSession(true),
            },
          ]}
        />
      </div>

      {nouvelleSession && (
        <div className="flex items-center gap-2" data-tournage-nouvelle>
          <input
            type="text"
            autoFocus
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); creer(); setNouvelleSession(false); }
              if (e.key === 'Escape') setNouvelleSession(false);
            }}
            placeholder="Nom du tournage — ex : cours du samedi"
            data-tournage-titre
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5
              text-[13px] outline-none focus:border-purple-500"
          />
          <button
            type="button"
            onClick={() => { creer(); setNouvelleSession(false); }}
            disabled={!titre.trim()}
            data-tournage-creer
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-gray-300
              hover:border-white/20 hover:text-white disabled:opacity-40 transition-colors"
          >
            Créer
          </button>
        </div>
      )}

      {erreur && <p className="text-[11px] text-gray-500" data-tournage-erreur>{erreur}</p>}
      {chargement && <Loader2 className="h-4 w-4 animate-spin text-gray-500" aria-hidden="true" />}

      {selection && (
        <>
          {/* ══ RUSHES ═══════════════════════════════════════════════════ */}
          <BandeRushes
            rushes={rushes}
            analyses={analyses}
            selection={rushChoisi}
            onSelectionner={setRushChoisi}
            onVoirAnalyse={(id) => { setRushChoisi(id); setTiroir('analyse'); }}
            onReanalyser={(id) => {
              setRushChoisi(id);
              setRelances((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
            }}
            onAjouterFichiers={ajouterFichiers}
            envois={envois}
          />

          {/* ══ FORMAT ET DUREE ══════════════════════════════════════════
              Une ligne, deux menus. La carte « Reglages de la video » qui les
              entourait n'apportait qu'un cadre et un titre. */}
          <div className="flex flex-wrap items-center gap-3" data-montage-reglages>
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">Format</span>
              <select
                value={montage.format}
                onChange={(e) => changerMontage({ format: e.target.value })}
                data-montage-format
                className="rounded-lg border border-white/10 bg-transparent px-2 py-1
                  text-[12px] text-gray-100 outline-none focus:border-purple-500"
              >
                {FORMATS.map((f) => (
                  <option key={f.valeur} value={f.valeur}>{f.libelle} {f.valeur}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">Durée</span>
              <select
                value={String(montage.dureeSecondes)}
                onChange={(e) => changerMontage({ dureeSecondes: Number(e.target.value) })}
                data-montage-duree
                className="rounded-lg border border-white/10 bg-transparent px-2 py-1
                  text-[12px] text-gray-100 outline-none focus:border-purple-500"
              >
                {DUREES.map((d) => (
                  <option key={d} value={d}>{d} s</option>
                ))}
              </select>
            </label>
            {onEnregistrerDefaut && (
              <MenuActions
                compact
                marqueur="montage"
                etiquette="Format et durée"
                titreGroupe="Format et durée"
                icone={<Crop className="h-3.5 w-3.5" />}
                actions={[{
                  libelle: defautEnregistre
                    ? 'Réglage par défaut enregistré'
                    : 'Enregistrer comme réglage par défaut',
                  icone: defautEnregistre
                    ? <Check className="h-3.5 w-3.5" />
                    : <Save className="h-3.5 w-3.5" />,
                  onClick: async () => {
                    await onEnregistrerDefaut(montage);
                    setDefautEnregistre(true);
                  },
                }]}
              />
            )}
          </div>

          {/* ══ AUDIO + ACTION PRINCIPALE ════════════════════════════════
              Portes par la chaine du rush regarde. UN panneau audio, UN
              bouton — quel que soit le nombre de rushes. */}
          {rushActif && rushActif.etat === 'verifie' && (
            <AnalyseRush
              key={rushActif.id}
              rushId={rushActif.id}
              montage={montage}
              audioDefaut={audioDefaut}
              onEnregistrerAudioDefaut={onEnregistrerAudioDefaut}
              onVideoLancee={onVideoLancee}
              variante="chaine"
              relance={relances[rushActif.id]}
              onVoirAnalyse={() => setTiroir('analyse')}
            />
          )}
          {rushActif && rushActif.etat !== 'verifie' && (
            <p className="text-[11px] text-gray-500" data-rush-non-verifie={rushActif.etat}>
              Ce rush est encore « {rushActif.etat} ». Studiio le vérifie avant de pouvoir le monter.
            </p>
          )}

          {/* ══ AVANCE ═══════════════════════════════════════════════════ */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setTiroir('avance')}
              data-ouvrir-avance
              className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px]
                text-gray-500 hover:text-gray-300 focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Avancé
            </button>
            {/* La validation humaine, dite une fois, en petit. */}
            <p className="text-[10px] text-gray-600" data-validation-humaine>
              Studiio prépare la vidéo. Vous la vérifiez avant publication.
            </p>
          </div>
        </>
      )}

      {/* ══ TIROIRS ══════════════════════════════════════════════════════ */}
      <DrawerLateral
        ouvert={tiroir === 'analyse'}
        onFermer={() => setTiroir(null)}
        titre={nomRushActif ? `Analyse — ${nomRushActif}` : 'Analyse'}
        marqueur="analyse"
      >
        {rushActif && <ContenuAnalyse rushId={rushActif.id} nom={nomRushActif} />}
      </DrawerLateral>

      <DrawerLateral
        ouvert={tiroir === 'avance'}
        onFermer={() => setTiroir(null)}
        titre="Réglages avancés"
        marqueur="avance"
      >
        {avance ?? (
          <p className="text-[12px] text-gray-500">
            Rien à régler pour l’instant. Les réglages créatifs viendront ici.
          </p>
        )}
      </DrawerLateral>
    </div>
  );
}
