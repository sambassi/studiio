'use client';

/**
 * « MES AVATARS » — les identités du compte, leur version utilisée, et la
 * nouvelle version en préparation.
 *
 * ⚠️ Remplacer un avatar ne l'interrompt JAMAIS : la nouvelle version se
 * prépare à côté, et ne devient utilisée que sur « Utiliser cette version ».
 * L'écran ne voit aucun identifiant fournisseur ni aucune clé de stockage.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Plus, Star, RefreshCw, Eye, Check, X, AlertTriangle, Settings2, Image as ImageIcon, Clapperboard, Users } from 'lucide-react';
import FluxSourceAvatar from '@/components/avatar/FluxSourceAvatar';
import ProgressStatus from '@/components/ux/ProgressStatus';
import { progressionVersion, type EtatApercuVersion } from '@/lib/avatar/progression';

export type EtatVersionPublic = 'preparation' | 'entrainement' | 'prete' | 'echec' | 'abandonnee';
export interface VersionPublique {
  id: string; version: number; etat: EtatVersionPublic; message: string | null; type: 'photo' | 'video'; creeLe: string; valideeLe: string | null;
  /** Date de la dernière activation (version active ou déjà utilisée). */
  activeeLe?: string | null;
  /** Une source est conservée pour cette version (`/api/avatars/versions/:id/source`). */
  source?: boolean;
  /** L'original importé est conservé à côté de la version préparée. */
  originalConserve?: boolean;
  /** L'état de l'aperçu d'une version prête, relu en base — `null`/absent : inconnu. */
  apercu?: EtatApercuVersion;
  /** La génération d'aperçu en cours (identifiant Studiio), pour en reprendre le suivi après un rechargement. */
  apercuGenerationId?: string | null;
}
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
  /** Ouvre « Changer d'avatar » : choisir parmi MES avatars existants. Incrémenté à chaque demande. */
  demandeChoixAvatar?: number;
  /**
   * LA carte de l'avatar actif, fusionnée : ce que la page sait en plus (ligne
   * de version, « Utiliser dans Créer », « Changer d'avatar », source repliée)
   * s'insère DANS la carte de l'avatar par défaut — une seule carte, pas trois.
   * Si la liste ne peut pas être lue, la carte est rendue seule avec ce contenu.
   */
  carteActive?: { attributs: Record<string, string>; contenu: ReactNode; actions?: ReactNode; apres?: ReactNode; nom: string; type: 'photo' | 'video' };
}) {
  const [donnees, setDonnees] = useState<DonneesAvatars | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [flux, setFlux] = useState<Flux>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [apercu, setApercu] = useState<{ versionId: string; url: string; jeton: string } | null>(null);
  const [gerer, setGerer] = useState<string | null>(null);
  /** « Changer d'avatar » ouvert : la liste de MES avatars, pour en choisir un autre. */
  const [choixAvatar, setChoixAvatar] = useState(false);
  /** La source (ou l'original) d'une version, affichée dans « Versions de l'avatar ». */
  const [sourceVue, setSourceVue] = useState<{ versionId: string; originale: boolean } | null>(null);
  /** L'aperçu d'une version de l'historique (déjà généré : jamais relancé ici). */
  const [apercuHistorique, setApercuHistorique] = useState<{ versionId: string; url: string } | null>(null);
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
      const candidates = d.avatars.map((a) => a.candidate).filter((c): c is VersionPublique => !!c);
      const enCours = candidates.filter((c) => c.etat === 'entrainement');
      // Un aperçu en cours (lancé ici, puis page rechargée) : on reprend son SUIVI —
      // une lecture de statut, qui finalise la vidéo ; jamais un nouveau lancement.
      const apercus = candidates.filter((c) => c.etat === 'prete' && c.apercu === 'en_cours' && c.apercuGenerationId);
      const enPreparation = candidates.some((c) => c.etat === 'preparation');
      if (enCours.length > 0 || apercus.length > 0 || enPreparation) {
        await Promise.all([
          ...enCours.map((c) => postJson(`/api/avatars/versions/${c.id}`, { action: 'synchroniser' })),
          ...apercus.map((c) => fetch(`/api/avatar/status?generationId=${encodeURIComponent(c.apercuGenerationId as string)}`).catch(() => null)),
        ]);
        if (!vivant) return;
        minuteur.current = setTimeout(tour, apercus.length > 0 ? 10_000 : 20_000);
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

  // « Changer d'avatar » (geste de la carte active) : la liste de MES avatars.
  useEffect(() => {
    if (props.demandeChoixAvatar) setChoixAvatar(true);
  }, [props.demandeChoixAvatar]);

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
      // La carte affiche aussitôt « Génération de l'aperçu… » (relu en base).
      setTick((t) => t + 1);
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

  /** L'aperçu DÉJÀ généré d'une version de l'historique — lu, jamais relancé (aucun frais, aucun fournisseur). */
  const voirApercuHistorique = async (h: VersionPublique) => {
    if (apercuHistorique?.versionId === h.id) { setApercuHistorique(null); return; }
    setOccupe(`apercu-${h.id}`); setErreur(null);
    const r = await postJson(`/api/avatars/versions/${h.id}`, { action: 'apercu' });
    setOccupe(null);
    if (!r.ok) { setErreur(r.j?.error ?? 'Aucun aperçu n’est disponible pour cette version.'); return; }
    setApercuHistorique({ versionId: h.id, url: r.j.data.url });
  };

  /** Le libellé d'un bouton pendant son action : l'utilisateur voit que Studiio travaille. */
  const enCours = (cle: string, repos: ReactNode, travail: string) => (
    occupe === cle ? <><Loader2 className="w-3 h-3 animate-spin" aria-hidden /> {travail}</> : repos
  );

  const ca = props.carteActive;
  const enteteCarte = (nom: string, type: 'photo' | 'video' | null, actif: boolean, parDefaut: boolean) => (
    <div className="min-w-0 flex-1 basis-48">
      {actif && <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-300">Avatar actif</div>}
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold text-white truncate">{nom}</span>
        {actif && (
          <span data-badge-actif className="rounded-full bg-studiio-primary/20 text-purple-200 px-2 py-0.5 text-[10px] font-semibold">Actif</span>
        )}
        {parDefaut && (
          <span data-badge-defaut className="inline-flex items-center gap-1 rounded-full bg-gray-800 text-gray-200 px-2 py-0.5 text-[10px]">
            <Star className="w-3 h-3" /> Par défaut
          </span>
        )}
      </div>
      {type && <div className="text-xs text-gray-300 mt-0.5">{type === 'video' ? 'Avatar vidéo' : 'Avatar photo'}</div>}
    </div>
  );
  // Les classes du produit : `card-base` et les boutons `button-*` (globals.css).
  const TERTIAIRE = 'button-ghost gap-1.5 !min-h-[30px] !text-xs';
  const CARTE_ACTIVE = 'card-base !p-5 space-y-4 border-studiio-primary/40';
  const CARTE = 'card-base !p-5 space-y-4';

  // Illisible ou en chargement : la carte de l'avatar actif seule (si la page
  // en a une), sinon rien — la page reste utilisable sans ce bloc.
  if (!donnees) {
    if (!ca) {
      return erreur
        ? <div data-mes-avatars-erreur className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 text-xs text-red-200">{erreur}</div>
        : <p data-mes-avatars-chargement role="status" className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Chargement de vos avatars…</p>;
    }
    return (
      <section data-mes-avatars="carte-seule" className="space-y-3">
        <article {...ca.attributs} className={CARTE_ACTIVE}>
          {enteteCarte(ca.nom, null, true, false)}
          {ca.contenu}
          {ca.actions && <div className="flex flex-wrap gap-2">{ca.actions}</div>}
          {ca.apres}
        </article>
      </section>
    );
  }

  const ordre = [...donnees.avatars].sort((x, y) => Number(y.parDefaut) - Number(x.parDefaut));

  return (
    <section data-mes-avatars className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Mes avatars</h2>
        </div>
        <button
          type="button"
          data-nouvel-avatar
          onClick={() => setFlux({ mode: 'nouveau' })}
          className="button-secondary shrink-0 gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Créer un nouvel avatar
        </button>
      </div>

      {erreur && <div data-mes-avatars-erreur className="rounded-lg bg-red-500/10 border border-red-500/30 p-2.5 text-xs text-red-200">{erreur}</div>}

      {donnees.avatars.length === 0 && (
        <p className="text-sm text-gray-300">Aucun avatar pour l’instant. Créez le premier à partir d’une photo ou d’une vidéo.</p>
      )}

      <div className="grid grid-cols-1 gap-3">
        {ordre.map((a, i) => {
          const s = statutCarte(a);
          const c = a.candidate;
          const actif = a.parDefaut && a.utilisable;
          const fusion = a.parDefaut && ca ? ca : null;
          return (
            <div key={a.id} className="space-y-3">
              {i === 1 && !ordre[1].parDefaut && ordre[0].parDefaut && (
                <div className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Autres avatars</div>
              )}
            <article
              data-carte-avatar={a.id}
              {...(fusion ? fusion.attributs : {})}
              className={a.parDefaut ? CARTE_ACTIVE : CARTE}
            >
              <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                {enteteCarte(a.nom, fusion ? null : a.type, actif, a.parDefaut)}
                <span data-statut-carte={s.ton} className={`shrink-0 text-[11px] font-medium rounded-full px-2.5 py-1 ${s.ton === 'ok' ? 'bg-emerald-500/15 text-emerald-200' : s.ton === 'erreur' ? 'bg-red-500/15 text-red-200' : 'bg-amber-500/15 text-amber-200'}`}>
                  {s.libelle}
                </span>
              </header>

              {a.versionActive && !fusion && (
                <p data-version-active className="text-xs text-gray-300">Version actuellement utilisée : v{a.versionActive.version}</p>
              )}

              {c && (c.etat === 'preparation' || c.etat === 'entrainement') && (() => {
                const p = progressionVersion(c);
                return (
                  <div data-candidate="en-preparation" data-candidate-etape={c.etat}>
                    <ProgressStatus
                      titre={p.titre}
                      statut={p.statut}
                      etapes={p.etapes}
                      description={p.message}
                      detail={p.description}
                      debutLe={c.creeLe}
                      note={a.versionActive ? `Votre version v${a.versionActive.version} reste utilisée en attendant.` : 'Cette page se met à jour toute seule.'}
                    />
                  </div>
                );
              })()}

              {c?.etat === 'echec' && (
                <div data-candidate="echec" className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-xs space-y-2">
                  <div className="flex items-start gap-2 text-red-100">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-medium">La nouvelle version n’a pas pu être créée</div>
                      {c.message && <div className="text-red-200/90 mt-0.5">{c.message}</div>}
                    </div>
                  </div>
                  {/* La progression s'arrête là où elle a échoué — rien ne continue d'« avancer ». */}
                  <ProgressStatus titre={`Nouvelle version de l’avatar (v${c.version})`} statut="erreur" etapes={progressionVersion(c).etapes} compact note={null} />
                  {a.versionActive && <div className="text-red-100/80">Votre version v{a.versionActive.version} reste utilisée.</div>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" data-action="reessayer" onClick={() => setFlux({ mode: 'remplacer', avatar: a })} className={TERTIAIRE}>Réessayer</button>
                    <button type="button" data-action="modifier-video" onClick={() => setFlux({ mode: 'remplacer', avatar: a })} className={TERTIAIRE}>Modifier la vidéo</button>
                    <button type="button" data-action="abandonner" disabled={occupe !== null} onClick={() => void action(`garder-${c.id}`, `/api/avatars/versions/${c.id}`, { action: 'garder' })} className={TERTIAIRE}>{enCours(`garder-${c.id}`, 'Abandonner', 'Enregistrement…')}</button>
                  </div>
                </div>
              )}

              {c?.etat === 'prete' && (
                <div data-candidate="prete" className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs space-y-2">
                  <div className="font-medium text-emerald-100">Votre nouvel avatar est prêt</div>
                  <div className="text-emerald-100/90">Regardez l’aperçu, puis choisissez : rien ne change tant que vous n’avez pas décidé.</div>
                  {(() => {
                    const p = progressionVersion(c);
                    return <div data-candidate-apercu={c.apercu ?? 'inconnu'}><ProgressStatus titre={p.titre} statut={occupe === `apercu-${c.id}` && p.statut === 'attente' ? 'en_cours' : p.statut} etapes={p.etapes} description={occupe === `apercu-${c.id}` && p.statut === 'attente' ? 'Ouverture de l’aperçu…' : p.message} detail={p.description} note={null} /></div>;
                  })()}
                  {apercu?.versionId === c.id && (
                    <video data-apercu-candidate src={apercu.url} controls playsInline className="block mx-auto max-h-72 w-auto max-w-full rounded-lg bg-black" />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" data-action="apercu" disabled={occupe !== null} onClick={() => void voirApercu(a, c)} className={TERTIAIRE}>
                      {occupe === `apercu-${c.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} Aperçu
                    </button>
                    <button
                      type="button"
                      data-action="utiliser-version"
                      disabled={occupe !== null || apercu?.versionId !== c.id}
                      title={apercu?.versionId !== c.id ? 'Regardez d’abord l’aperçu' : undefined}
                      onClick={() => void action(`utiliser-${c.id}`, `/api/avatars/versions/${c.id}`, { action: 'utiliser', jeton: apercu?.jeton }, () => setApercu(null))}
                      className="button-primary gap-1 !min-h-[30px] !text-xs disabled:opacity-40"
                    >
                      {enCours(`utiliser-${c.id}`, <><Check className="w-3 h-3" /> Utiliser cette version</>, 'Activation de la version…')}
                    </button>
                    <button type="button" data-action="garder" disabled={occupe !== null} onClick={() => void action(`garder-${c.id}`, `/api/avatars/versions/${c.id}`, { action: 'garder' }, () => setApercu(null))} className={TERTIAIRE}>
                      {enCours(`garder-${c.id}`, <><X className="w-3 h-3" /> Garder ma version actuelle</>, 'Enregistrement…')}
                    </button>
                  </div>
                </div>
              )}

              {fusion?.contenu}

              <div className="flex flex-wrap gap-2 pt-1">
                {fusion?.actions}
                {!a.parDefaut && a.utilisable && (
                  <button type="button" data-action="utiliser" disabled={occupe !== null} onClick={() => void action(`defaut-${a.id}`, '/api/avatars/defaut', { avatarId: a.id })} className={TERTIAIRE}>{enCours(`defaut-${a.id}`, 'Utiliser', 'Activation…')}</button>
                )}
                {!c || c.etat === 'prete' || c.etat === 'echec' ? (
                  <button type="button" data-action="remplacer" onClick={() => setFlux({ mode: 'remplacer', avatar: a })} className={TERTIAIRE}>
                    <RefreshCw className="w-3 h-3" /> Remplacer cet avatar
                  </button>
                ) : null}
                <button type="button" data-action="gerer" aria-expanded={gerer === a.id} onClick={() => setGerer(gerer === a.id ? null : a.id)} className={TERTIAIRE}>
                  <Settings2 className="w-3 h-3" /> Gérer
                </button>
              </div>

              {a.parDefaut && choixAvatar && (
                <div data-choix-avatar className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-gray-200 font-medium"><Users className="w-3.5 h-3.5" aria-hidden /> Choisir parmi mes avatars</div>
                    <button type="button" aria-label="Fermer" onClick={() => setChoixAvatar(false)} className="p-1 text-gray-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <p className="text-gray-400">L’avatar choisi devient celui de Créer et de l’Autopilote. Aucun entraînement n’est relancé.</p>
                  {ordre.filter((o) => o.id !== a.id).length === 0 && (
                    <p data-choix-avatar-vide className="text-gray-300">Vous n’avez pas d’autre avatar pour l’instant.</p>
                  )}
                  {ordre.filter((o) => o.id !== a.id).map((o) => (
                    <div key={o.id} data-choix-avatar-ligne={o.id} className="flex items-center justify-between gap-2 text-gray-200">
                      <span className="min-w-0 truncate">{o.nom} · {o.type === 'video' ? 'Avatar vidéo' : 'Avatar photo'}{o.versionActive ? ` · Version v${o.versionActive.version}` : ''}</span>
                      {o.utilisable ? (
                        <button type="button" data-choix-avatar-utiliser={o.id} disabled={occupe !== null} onClick={() => void action(`defaut-${o.id}`, '/api/avatars/defaut', { avatarId: o.id }, () => setChoixAvatar(false))} className={TERTIAIRE}>
                          {enCours(`defaut-${o.id}`, 'Utiliser cet avatar', 'Activation…')}
                        </button>
                      ) : (
                        <span className="text-gray-400">{statutCarte(o).libelle}</span>
                      )}
                    </div>
                  ))}
                  <button type="button" data-choix-avatar-nouveau onClick={() => { setChoixAvatar(false); setFlux({ mode: 'nouveau' }); }} className={TERTIAIRE}>
                    <Plus className="w-3 h-3" /> Créer un nouvel avatar
                  </button>
                </div>
              )}

              {gerer === a.id && (() => {
                // L'historique COMPLET : la version active d'abord, puis les précédentes —
                // jamais supprimées automatiquement.
                const versions = [...(a.versionActive ? [a.versionActive] : []), ...a.historique];
                const statutVersion = (h: VersionPublique) => (h.id === a.versionActive?.id ? 'Active'
                  : h.etat === 'abandonnee' ? 'Mise de côté' : h.etat === 'echec' ? 'Non aboutie'
                    : h.etat === 'prete' && h.valideeLe ? 'Version précédente' : h.etat === 'prete' ? 'Prête, jamais utilisée' : 'En préparation');
                const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null);
                return (
                  <div data-historique className="rounded-lg border border-gray-800 bg-gray-950/50 p-3 text-xs space-y-3">
                    <div>
                      <div className="text-gray-200 font-medium">Versions de l’avatar</div>
                      {/* VERSION ≠ QUALITÉ : v3, v4… numérotent les entraînements successifs de cet
                          avatar ; la qualité de rendu se choisit à chaque génération. */}
                      <p data-historique-version-qualite className="text-gray-400 mt-0.5">v1, v2, v3… sont les versions successives de cet avatar, pas des niveaux de qualité. La qualité (Standard, Qualité, Premium) se choisit à chaque génération de vidéo.</p>
                    </div>
                    {versions.length === 0 && <div className="text-gray-400">Aucune version pour l’instant.</div>}
                    {versions.map((h) => {
                      const active = h.id === a.versionActive?.id;
                      const revenir = !active && h.etat === 'prete' && !!h.valideeLe;
                      const vue = sourceVue?.versionId === h.id ? sourceVue : null;
                      const srcSource = (originale: boolean) => `/api/avatars/versions/${encodeURIComponent(h.id)}/source${originale ? '?quelle=originale' : ''}`;
                      return (
                        <div key={h.id} data-version-ligne={h.version} data-version-statut={statutVersion(h)} className="rounded-lg bg-gray-900/50 p-2.5 space-y-2">
                          <div className="flex items-start gap-3">
                            {/* Miniature : la source de CETTE version (privée, lue par la session). */}
                            <div data-version-miniature className="w-12 h-12 shrink-0 rounded-md overflow-hidden bg-black flex items-center justify-center">
                              {h.source ? (h.type === 'video'
                                ? <video src={`${srcSource(false)}#t=0.5`} preload="metadata" muted playsInline className="w-full h-full object-cover" onError={(e) => { e.currentTarget.hidden = true; }} />
                                /* eslint-disable-next-line @next/next/no-img-element */
                                : <img src={srcSource(false)} alt={`Source de la version v${h.version}`} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.hidden = true; }} />)
                                : (h.type === 'video' ? <Clapperboard className="w-4 h-4 text-gray-500" aria-hidden /> : <ImageIcon className="w-4 h-4 text-gray-500" aria-hidden />)}
                            </div>
                            <dl className="min-w-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-gray-300">
                              <dt className="text-gray-500">Version</dt>
                              <dd data-version-numero className="text-white font-medium">v{h.version} — {statutVersion(h)}</dd>
                              <dt className="text-gray-500">Source</dt>
                              <dd data-version-source>{h.type === 'video' ? 'Vidéo' : 'Photo'}{h.originalConserve ? ' (original conservé)' : ''}</dd>
                              <dt className="text-gray-500">Créée le</dt>
                              <dd>{date(h.creeLe) ?? '—'}</dd>
                              {h.activeeLe && <><dt className="text-gray-500">{active ? 'Active depuis' : 'Utilisée le'}</dt><dd>{date(h.activeeLe)}</dd></>}
                            </dl>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {!active && h.apercu === 'pret' && (
                              <button type="button" data-action="apercu-version" disabled={occupe !== null} onClick={() => void voirApercuHistorique(h)} className={TERTIAIRE}>
                                {enCours(`apercu-${h.id}`, <><Eye className="w-3 h-3" /> {apercuHistorique?.versionId === h.id ? 'Masquer l’aperçu' : 'Aperçu'}</>, 'Ouverture…')}
                              </button>
                            )}
                            {revenir && (
                              <button type="button" data-action="revenir" disabled={occupe !== null} onClick={() => void action(`revenir-${h.id}`, `/api/avatars/versions/${h.id}`, { action: 'revenir' })} className={TERTIAIRE}>
                                {enCours(`revenir-${h.id}`, 'Revenir à cette version', 'Réactivation…')}
                              </button>
                            )}
                            {h.source && (
                              <button type="button" data-action="voir-source" aria-expanded={!!vue} onClick={() => setSourceVue(vue ? null : { versionId: h.id, originale: false })} className={TERTIAIRE}>
                                {vue ? 'Masquer la source' : 'Voir la source'}
                              </button>
                            )}
                          </div>
                          {revenir && <p className="text-gray-500">Réactive cette version déjà prête : aucun nouvel entraînement, aucun frais.</p>}
                          {apercuHistorique?.versionId === h.id && (
                            <video data-apercu-version={h.id} src={apercuHistorique.url} controls playsInline className="block mx-auto max-h-72 w-auto max-w-full rounded-lg bg-black" />
                          )}
                          {vue && (
                            <div data-version-source-vue={vue.originale ? 'originale' : 'utilisee'} className="space-y-1.5">
                              {h.type === 'video'
                                ? <video src={srcSource(vue.originale)} controls playsInline preload="metadata" className="block mx-auto max-h-72 w-auto max-w-full rounded-lg bg-black" />
                                /* eslint-disable-next-line @next/next/no-img-element */
                                : <img src={srcSource(vue.originale)} alt={`Source de la version v${h.version}`} className="block mx-auto max-h-72 w-auto max-w-full rounded-lg bg-black" />}
                              {h.originalConserve && (
                                <button type="button" data-action="voir-original" onClick={() => setSourceVue({ versionId: h.id, originale: !vue.originale })} className={TERTIAIRE}>
                                  {vue.originale ? 'Voir la version envoyée' : 'Voir l’original importé'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {fusion?.apres}
            </article>
            </div>
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
