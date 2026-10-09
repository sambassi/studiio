'use client';

/**
 * « MES AVATARS » — les identités du compte, leur version utilisée, et la
 * nouvelle version en préparation.
 *
 * ⚠️ Remplacer un avatar ne l'interrompt JAMAIS : la nouvelle version se
 * prépare à côté, et ne devient utilisée que sur « Utiliser cette version ».
 * L'écran ne voit aucun identifiant fournisseur ni aucune clé de stockage.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Star, RefreshCw, Eye, Check, X, AlertTriangle, Settings2 } from 'lucide-react';
import FluxSourceAvatar from '@/components/avatar/FluxSourceAvatar';

export type EtatVersionPublic = 'preparation' | 'entrainement' | 'prete' | 'echec' | 'abandonnee';
export interface VersionPublique { id: string; version: number; etat: EtatVersionPublic; message: string | null; type: 'photo' | 'video'; creeLe: string; valideeLe: string | null }
export interface AvatarPublic {
  id: string; nom: string; parDefaut: boolean; type: 'photo' | 'video'; utilisable: boolean;
  versionActive: VersionPublique | null; candidate: VersionPublique | null; historique: VersionPublique[];
}
export interface DonneesAvatars {
  avatars: AvatarPublic[];
  capacite: { nouvelAvatarPhoto: boolean; nouvelAvatarVideo: boolean; emplacementsVideoLibres: number };
}

/** Ce que dit la carte, en clair — calculé à part pour être testé sans écran. */
export function statutCarte(a: AvatarPublic): { libelle: string; ton: 'ok' | 'attente' | 'erreur' } {
  if (a.candidate?.etat === 'echec') return { libelle: 'Nouvelle version à corriger', ton: 'erreur' };
  if (a.candidate?.etat === 'prete') return { libelle: 'Nouvelle version prête', ton: 'attente' };
  if (a.candidate) return { libelle: 'Nouvelle version en préparation', ton: 'attente' };
  if (a.utilisable) return { libelle: 'Utilisable', ton: 'ok' };
  return { libelle: 'En préparation', ton: 'attente' };
}

const postJson = async (url: string, corps: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j?.success, j };
};

type Flux = { mode: 'remplacer'; avatar: AvatarPublic } | { mode: 'nouveau' } | null;

export default function MesAvatars(props: {
  onChange?: () => void;
  /** Ouvre « Remplacer » sur l'avatar par défaut (geste « Changer de source » de la page). Incrémenté à chaque demande. */
  demandeRemplacement?: number;
}) {
  const [donnees, setDonnees] = useState<DonneesAvatars | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [flux, setFlux] = useState<Flux>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [apercu, setApercu] = useState<{ versionId: string; url: string; jeton: string } | null>(null);
  const [gerer, setGerer] = useState<string | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(0);

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/avatars', { cache: 'no-store' });
      const j = await r.json();
      // Forme revalidée : une réponse inattendue n'est jamais interprétée.
      if (!r.ok || !j?.success || !Array.isArray(j?.data?.avatars) || !j?.data?.capacite) { setErreur(j?.error ?? 'Vos avatars n’ont pas pu être lus.'); return null; }
      setDonnees(j.data as DonneesAvatars);
      setErreur(null);
      return j.data as DonneesAvatars;
    } catch {
      setErreur('Connexion impossible.');
      return null;
    }
  }, []);

  // Suivi des candidates en préparation : le serveur relit le fournisseur, l'écran se met à jour seul.
  useEffect(() => {
    let vivant = true;
    const tour = async () => {
      const d = await charger();
      if (!vivant || !d) return;
      const enCours = d.avatars.map((a) => a.candidate).filter((c): c is VersionPublique => !!c && c.etat === 'entrainement');
      if (enCours.length > 0) {
        await Promise.all(enCours.map((c) => postJson(`/api/avatars/versions/${c.id}`, { action: 'synchroniser' })));
        minuteur.current = setTimeout(tour, 20_000);
      }
    };
    void tour();
    return () => { vivant = false; if (minuteur.current) clearTimeout(minuteur.current); };
  }, [charger, tick]);

  // « Changer de source » ailleurs sur la page = Remplacer l'avatar par défaut, jamais l'écraser.
  useEffect(() => {
    if (!props.demandeRemplacement || !donnees) return;
    const cible = donnees.avatars.find((a) => a.parDefaut) ?? donnees.avatars[0];
    setFlux(cible ? { mode: 'remplacer', avatar: cible } : { mode: 'nouveau' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.demandeRemplacement]);

  const apres = async () => { setTick((t) => t + 1); props.onChange?.(); };

  const action = async (cle: string, url: string, corps: unknown, succes?: () => void) => {
    setOccupe(cle); setErreur(null);
    const r = await postJson(url, corps);
    setOccupe(null);
    if (!r.ok) { setErreur(r.j?.error ?? 'L’action n’a pas abouti.'); return false; }
    succes?.();
    await apres();
    return true;
  };

  /** L'aperçu de la candidate : le montrer s'il existe, sinon le créer (sans frais) et attendre. */
  const voirApercu = async (a: AvatarPublic, v: VersionPublique) => {
    setOccupe(`apercu-${v.id}`); setErreur(null);
    let r = await postJson(`/api/avatars/versions/${v.id}`, { action: 'apercu' });
    if (!r.ok && r.j?.code === 'apercu_aucun') {
      const g = await postJson('/api/avatar/generate', { intention: 'apercu', versionId: v.id, avatarId: a.id });
      if (!g.ok) { setOccupe(null); setErreur(g.j?.error ?? 'L’aperçu n’a pas pu être lancé.'); return; }
      const generationId = g.j.data.generationId as string;
      for (let i = 0; i < 120; i += 1) {
        await new Promise((res) => setTimeout(res, 5000));
        const s = await fetch(`/api/avatar/status?generationId=${generationId}`).then((x) => x.json()).catch(() => null);
        if (s?.data?.status === 'completed' || s?.data?.status === 'failed') break;
      }
      r = await postJson(`/api/avatars/versions/${v.id}`, { action: 'apercu' });
    }
    setOccupe(null);
    if (!r.ok) { setErreur(r.j?.error ?? 'L’aperçu n’est pas disponible.'); return; }
    setApercu({ versionId: v.id, url: r.j.data.url, jeton: r.j.data.jeton });
  };

  // Illisible ou en chargement : rien — la page de l'avatar reste utilisable sans ce bloc.
  if (!donnees) return null;

  return (
    <section data-mes-avatars className="card-base p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Mes avatars</h2>
        <button
          type="button"
          data-nouvel-avatar
          onClick={() => setFlux({ mode: 'nouveau' })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> Créer un nouvel avatar
        </button>
      </div>

      {erreur && <div data-mes-avatars-erreur className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 text-xs text-red-200">{erreur}</div>}

      {donnees.avatars.length === 0 && (
        <p className="text-sm text-gray-400">Aucun avatar pour l’instant. Créez le premier à partir d’une photo ou d’une vidéo.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {donnees.avatars.map((a) => {
          const s = statutCarte(a);
          const c = a.candidate;
          return (
            <article key={a.id} data-carte-avatar={a.id} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
              <header className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {a.nom}
                    {a.parDefaut && (
                      <span data-badge-defaut className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 text-purple-200 text-[10px] px-2 py-0.5">
                        <Star className="w-3 h-3" /> Par défaut
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{a.type === 'video' ? 'Avatar vidéo' : 'Avatar photo'}</div>
                </div>
                <span data-statut-carte={s.ton} className={`text-[11px] rounded-full px-2 py-0.5 ${s.ton === 'ok' ? 'bg-emerald-500/15 text-emerald-200' : s.ton === 'erreur' ? 'bg-red-500/15 text-red-200' : 'bg-amber-500/15 text-amber-200'}`}>
                  {s.libelle}
                </span>
              </header>

              {a.versionActive && (
                <p data-version-active className="text-xs text-gray-300">Version actuellement utilisée : v{a.versionActive.version}</p>
              )}

              {c && (c.etat === 'preparation' || c.etat === 'entrainement') && (
                <div data-candidate="en-preparation" className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-100 flex items-start gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5 shrink-0" />
                  <span>Nouvelle version en préparation (v{c.version}). {a.versionActive ? `Votre version v${a.versionActive.version} reste utilisée en attendant.` : 'Cette page se met à jour toute seule.'}</span>
                </div>
              )}

              {c?.etat === 'echec' && (
                <div data-candidate="echec" className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 text-xs space-y-2">
                  <div className="flex items-start gap-2 text-red-100">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-medium">La nouvelle version n’a pas pu être créée</div>
                      {c.message && <div className="text-red-200/80 mt-0.5">{c.message}</div>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" data-action="reessayer" onClick={() => setFlux({ mode: 'remplacer', avatar: a })} className="rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">Réessayer</button>
                    <button type="button" data-action="modifier-video" onClick={() => setFlux({ mode: 'remplacer', avatar: a })} className="rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">Modifier la vidéo</button>
                    <button type="button" data-action="abandonner" disabled={occupe !== null} onClick={() => void action(`garder-${c.id}`, `/api/avatars/versions/${c.id}`, { action: 'garder' })} className="rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">Abandonner</button>
                  </div>
                </div>
              )}

              {c?.etat === 'prete' && (
                <div data-candidate="prete" className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs space-y-2">
                  <div className="font-medium text-emerald-100">Votre nouvel avatar est prêt</div>
                  <div className="text-emerald-100/80">Regardez l’aperçu, puis choisissez : rien ne change tant que vous n’avez pas décidé.</div>
                  {apercu?.versionId === c.id && (
                    <video data-apercu-candidate src={apercu.url} controls playsInline className="w-full max-h-72 rounded-lg bg-black" />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" data-action="apercu" disabled={occupe !== null} onClick={() => void voirApercu(a, c)} className="inline-flex items-center gap-1 rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">
                      {occupe === `apercu-${c.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} Aperçu
                    </button>
                    <button
                      type="button"
                      data-action="utiliser-version"
                      disabled={occupe !== null || apercu?.versionId !== c.id}
                      title={apercu?.versionId !== c.id ? 'Regardez d’abord l’aperçu' : undefined}
                      onClick={() => void action(`utiliser-${c.id}`, `/api/avatars/versions/${c.id}`, { action: 'utiliser', jeton: apercu?.jeton }, () => setApercu(null))}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-2.5 py-1 text-white"
                    >
                      <Check className="w-3 h-3" /> Utiliser cette version
                    </button>
                    <button type="button" data-action="garder" disabled={occupe !== null} onClick={() => void action(`garder-${c.id}`, `/api/avatars/versions/${c.id}`, { action: 'garder' }, () => setApercu(null))} className="inline-flex items-center gap-1 rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">
                      <X className="w-3 h-3" /> Garder ma version actuelle
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 text-xs">
                {!a.parDefaut && a.utilisable && (
                  <button type="button" data-action="utiliser" disabled={occupe !== null} onClick={() => void action(`defaut-${a.id}`, '/api/avatars/defaut', { avatarId: a.id })} className="rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">Utiliser</button>
                )}
                {!c || c.etat === 'prete' || c.etat === 'echec' ? (
                  <button type="button" data-action="remplacer" onClick={() => setFlux({ mode: 'remplacer', avatar: a })} className="inline-flex items-center gap-1 rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">
                    <RefreshCw className="w-3 h-3" /> Remplacer cet avatar
                  </button>
                ) : null}
                <button type="button" data-action="gerer" onClick={() => setGerer(gerer === a.id ? null : a.id)} className="inline-flex items-center gap-1 rounded-md bg-gray-800 hover:bg-gray-700 px-2.5 py-1">
                  <Settings2 className="w-3 h-3" /> Gérer
                </button>
              </div>

              {gerer === a.id && (
                <div data-historique className="rounded-lg border border-gray-800 p-2.5 text-xs space-y-1.5">
                  <div className="text-gray-400">Versions précédentes</div>
                  {a.historique.length === 0 && <div className="text-gray-500">Aucune.</div>}
                  {a.historique.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2">
                      <span>v{h.version} · {h.etat === 'abandonnee' ? 'mise de côté' : h.etat === 'echec' ? 'non aboutie' : h.valideeLe ? 'déjà utilisée' : 'non validée'}</span>
                      {h.valideeLe && h.etat !== 'abandonnee' && (
                        <button type="button" data-action="revenir" disabled={occupe !== null} onClick={() => void action(`revenir-${h.id}`, `/api/avatars/versions/${h.id}`, { action: 'revenir' })} className="rounded-md bg-gray-800 hover:bg-gray-700 px-2 py-0.5">Revenir à cette version</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {flux && (
        <FluxSourceAvatar
          mode={flux.mode}
          avatar={flux.mode === 'remplacer' ? { id: flux.avatar.id, nom: flux.avatar.nom, type: flux.avatar.type } : null}
          capacite={donnees.capacite}
          onFermer={() => setFlux(null)}
          onTermine={() => { setFlux(null); void apres(); }}
        />
      )}
    </section>
  );
}
