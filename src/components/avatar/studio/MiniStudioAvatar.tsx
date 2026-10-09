'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Crop, Download, Loader2, Sparkles, Volume2, AlertTriangle } from 'lucide-react';
import CropRushModal from '@/components/creer/CropRushModal';
import TexteAvecPrononciations from '@/components/avatar/studio/TexteAvecPrononciations';
import {
  lireEtatJumeau, genererEtAttendreVideoJumeau, attendreStatutJumeau, ErreurAttenteJumeau, type EtatJumeau,
} from '@/lib/creer/jumeau';
import { ecouterAvecMaVoix } from '@/lib/voice/profilClient';
import { libelleAvatarActif, libelleCreeAvecVersion } from '@/lib/avatar/identite';
import {
  FORMATS_STUDIO, RATIO_CSS, RECADRAGE_NEUTRE, CLE_GENERATION_STUDIO, besoinPostTraitement, estFormatStudio, etatCout,
  lireGenerationMemorisee, nomFichierAvatar, optionsPostTraitement, recadrageNeutre, type FormatStudio, type Recadrage,
} from '@/lib/avatar/studio';
import { AVATAR_VIDEO_COST } from '@/lib/stripe/constants';
import { listerLutsApi } from '@/lib/luts/import';
import { refDeLutAsset } from '@/lib/luts/bibliotheque';
import { supportDeLut } from '@/lib/luts/support';
import { chargerLutPourRendu, type LutPourRendu } from '@/lib/luts/charger';
import { applyLutToPixels } from '@/lib/luts/apply';
import type { LutAsset } from '@/lib/luts/types';

/**
 * GÉNÉRER UNE VIDÉO AVEC MON AVATAR — le mini-studio de /dashboard/avatar.
 *
 * Tout passe par les chaînes EXISTANTES :
 *   - génération : `POST /api/creer/jumeau/generer` (avatar actif relu par le
 *     serveur, voix clonée, prononciations du compte, débit idempotent,
 *     remboursement unique) — la même que Créer ;
 *   - recadrage : `CropRushModal` → `rushTransform` du compositeur ;
 *   - style visuel : la bibliothèque de LUT du compte → `rushLut` ;
 *   - MP4 : `composeVideo` puis `downloadBlob` (inclus dans le coût de la
 *     génération : aucune réservation de rendu, aucun second débit).
 *
 * Le téléchargement ne régénère RIEN : il lit le fichier final déjà produit.
 */

type Phase = 'repos' | 'lancement' | 'generation' | 'pret' | 'echec';
interface Rendu { id: string; status: string; video_url: string | null; created_at: string; avatar_version: number | null; aspect_ratio: string | null; intention: string | null; user_avatar_id: string | null }

export default function MiniStudioAvatar(props: {
  /** Une vidéo déjà rendue de l'avatar actif, pour régler le cadrage avant de générer. */
  videoReference?: string | null;
  /** Une génération vient d'aboutir : la page relit son « rendu récent ». */
  onGenere?: () => void;
}) {
  const [jumeau, setJumeau] = useState<EtatJumeau | null | 'chargement'>('chargement');
  const [solde, setSolde] = useState<number | null>(null);
  const [texte, setTexte] = useState('');
  const [format, setFormat] = useState<FormatStudio>('9:16');
  const [recadrage, setRecadrage] = useState<Recadrage>(RECADRAGE_NEUTRE);
  const [cropOuvert, setCropOuvert] = useState(false);
  const [luts, setLuts] = useState<readonly LutAsset[] | null>(null);
  const [lutChoisie, setLutChoisie] = useState<LutAsset | null>(null);
  const [lutChargee, setLutChargee] = useState<LutPourRendu | null>(null);
  const [apercuLut, setApercuLut] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('repos');
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ url: string; version: number | null; format: FormatStudio } | null>(null);
  const [export_, setExport] = useState<{ pourcentage: number; etape: string } | null>(null);
  const [ecoute, setEcoute] = useState<{ etat: 'repos' | 'charge' } & { url?: string }>({ etat: 'repos' });
  const [rendus, setRendus] = useState<Rendu[]>([]);
  const verrou = useRef(false);
  const exportVerrou = useRef(false);

  const chargerSolde = useCallback(async () => {
    try {
      const d = await fetch('/api/credits/balance').then((r) => r.json());
      setSolde(typeof d?.balance === 'number' ? d.balance : null);
    } catch { setSolde(null); }
  }, []);
  const chargerRendus = useCallback(async () => {
    try {
      const d = await fetch('/api/avatar/status').then((r) => r.json());
      const liste = Array.isArray(d?.data?.generations) ? (d.data.generations as Rendu[]) : [];
      setRendus(liste.filter((g) => g.status === 'completed' && g.video_url && g.intention !== 'apercu').slice(0, 4));
    } catch { setRendus([]); }
  }, []);

  const suivre = useCallback(async (generationId: string, f: FormatStudio) => {
    setPhase('generation');
    try {
      const { url, avatarVersion } = await attendreStatutJumeau({ generationId });
      setResultat({ url, version: avatarVersion, format: f });
      setPhase('pret');
      props.onGenere?.();
      void chargerRendus();
    } catch (e) {
      setErreur(e instanceof Error && e.message ? e.message : 'La génération n’a pas abouti.');
      setPhase('echec');
      void chargerSolde();
    } finally {
      // Terminée ou en échec : plus rien à reprendre. Un suivi coupé
      // (réseau, session, délai) garde l'identifiant pour la reprise.
      try { window.localStorage.removeItem(CLE_GENERATION_STUDIO); } catch { /* indisponible */ }
    }
  }, [chargerRendus, chargerSolde, props]);

  useEffect(() => {
    void lireEtatJumeau().then(setJumeau);
    void chargerSolde();
    void chargerRendus();
    void listerLutsApi().then((l) => setLuts(l ? l.filter((a) => supportDeLut(a.kind) === 'ready') : []));
    // Une génération lancée avant un rafraîchissement : on la REPREND (lecture
    // de statut, gratuite) — jamais une seconde génération payante.
    let memo = null;
    try { memo = lireGenerationMemorisee(window.localStorage.getItem(CLE_GENERATION_STUDIO)); } catch { memo = null; }
    if (memo) { setFormat(memo.format); void suivre(memo.generationId, memo.format); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style visuel : la LUT RÉELLE, chargée par la route du compte ; l'aperçu
  // est une image de la vidéo, étalonnée par `applyLutToPixels`.
  useEffect(() => {
    let vivant = true;
    setApercuLut(null);
    if (!lutChoisie) { setLutChargee(null); return; }
    void chargerLutPourRendu(refDeLutAsset(lutChoisie)).then((l) => {
      if (!vivant) return;
      setLutChargee(l);
      if (!l) setErreur(`Le style « ${lutChoisie.nom} » n’a pas pu être chargé.`);
    });
    return () => { vivant = false; };
  }, [lutChoisie]);

  const sourceApercu = resultat?.url ?? props.videoReference ?? null;
  useEffect(() => {
    if (!lutChargee || !sourceApercu) return;
    let vivant = true;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.src = sourceApercu;
    const dessiner = () => {
      try {
        const w = 240; const h = Math.round((w * (v.videoHeight || 16)) / (v.videoWidth || 9));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); if (!ctx) return;
        ctx.drawImage(v, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        applyLutToPixels(img.data, lutChargee.lut, lutChargee.intensity);
        ctx.putImageData(img, 0, 0);
        if (vivant) setApercuLut(c.toDataURL('image/jpeg', 0.85));
      } catch { if (vivant) setApercuLut(null); }
    };
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); }, { once: true });
    v.addEventListener('seeked', dessiner, { once: true });
    return () => { vivant = false; v.removeAttribute('src'); v.load(); };
  }, [lutChargee, sourceApercu]);

  const etatJumeau = jumeau !== 'chargement' && jumeau ? jumeau : null;
  const pret = !!etatJumeau?.pret && !!etatJumeau.jumeau;
  const enCours = phase === 'lancement' || phase === 'generation';
  const cout = etatCout({ cout: AVATAR_VIDEO_COST, solde, texte, enCours });
  const moteurDispo = !!etatJumeau?.moteurDisponible;

  const ecouter = async () => {
    if (!texte.trim() || ecoute.etat === 'charge') return;
    setEcoute({ etat: 'charge' });
    const r = await ecouterAvecMaVoix(texte.trim().slice(0, 600));
    if (!r.ok) { setErreur(r.message); setEcoute({ etat: 'repos' }); return; }
    setEcoute({ etat: 'repos', url: r.url });
  };

  const generer = async () => {
    if (verrou.current || !cout.peutGenerer || !pret || !moteurDispo) return;
    verrou.current = true;
    setErreur(null);
    setResultat(null);
    setPhase('lancement');
    const f = format;
    try {
      const video = await genererEtAttendreVideoJumeau({
        textes: [texte.trim()],
        aspectRatio: f,
        onLancee: (generationId) => {
          setPhase('generation');
          try { window.localStorage.setItem(CLE_GENERATION_STUDIO, JSON.stringify({ generationId, format: f, lanceeLe: Date.now() })); } catch { /* indisponible */ }
          void chargerSolde();
        },
      });
      setResultat({ url: video.url, version: video.avatarVersion, format: f });
      setPhase('pret');
      try { window.localStorage.removeItem(CLE_GENERATION_STUDIO); } catch { /* indisponible */ }
      props.onGenere?.();
      void chargerRendus();
    } catch (e) {
      const coupe = e instanceof ErreurAttenteJumeau && (e.code === 'connexion' || e.code === 'session' || e.code === 'delai');
      setErreur(e instanceof Error && e.message ? e.message : 'La génération n’a pas abouti.');
      setPhase('echec');
      if (!coupe) { try { window.localStorage.removeItem(CLE_GENERATION_STUDIO); } catch { /* indisponible */ } }
    } finally {
      verrou.current = false;
      void chargerSolde();
    }
  };

  /**
   * Le MP4 final. Sans recadrage ni style : le fichier d'origine, tel quel.
   * Sinon : le compositeur applique recadrage + LUT, `downloadBlob` livre un
   * MP4. Aucun appel au fournisseur, aucun débit.
   */
  const telecharger = async (url: string, f: FormatStudio, avecReglages: boolean) => {
    if (exportVerrou.current) return;
    exportVerrou.current = true;
    setErreur(null);
    setExport({ pourcentage: 0, etape: 'Préparation…' });
    try {
      const { downloadBlob, composeVideo } = await import('@/lib/video-composer');
      const nom = nomFichierAvatar();
      const progression = (p: number, etape: string) => setExport({ pourcentage: Math.round(p), etape });
      if (!avecReglages || !besoinPostTraitement({ recadrage, lutChoisie: !!lutChoisie })) {
        const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error('fichier'); return r.blob(); });
        await downloadBlob(blob.type ? blob : new Blob([blob], { type: 'video/mp4' }), nom, progression);
        return;
      }
      if (lutChoisie && !lutChargee) throw new Error(`Le style « ${lutChoisie.nom} » n’a pas pu être chargé : rien n’a été exporté.`);
      const duree = await new Promise<number>((ok, ko) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => ok(Number.isFinite(v.duration) ? v.duration : 0);
        v.onerror = () => ko(new Error('La vidéo n’a pas pu être lue.'));
        v.src = url;
      });
      if (!(duree > 0)) throw new Error('La durée de la vidéo est illisible.');
      const { video } = await composeVideo({
        ...optionsPostTraitement({ videoUrl: url, format: f, dureeSecondes: duree, recadrage, lut: lutChargee }),
        onProgress: progression,
      });
      await downloadBlob(video, nom.replace(/\.mp4$/, '.webm'), progression);
    } catch (e) {
      setErreur(e instanceof Error && e.message && e.message !== 'fichier' ? e.message : 'Le téléchargement a échoué. Réessayez.');
    } finally {
      setExport(null);
      exportVerrou.current = false;
    }
  };

  const versionActive = etatJumeau?.jumeau?.avatar.version ?? null;

  return (
    <div data-mini-studio className="card-base p-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold">Faire parler mon avatar</h2>
        <p className="text-xs text-gray-500 mt-0.5">Une vidéo de votre avatar actif, avec votre voix. Rien n’est généré sans votre clic.</p>
      </div>

      {jumeau === 'chargement' && <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Vérification de votre avatar…</div>}
      {etatJumeau && !pret && (
        <div data-mini-studio-indisponible className="rounded-xl bg-amber-500/10 p-4 text-sm text-amber-200">{etatJumeau.message ?? 'Votre avatar et votre voix doivent être prêts.'}</div>
      )}

      {pret && etatJumeau?.jumeau && (
        <>
          {/* AVATAR ACTIF */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span data-mini-studio-avatar className="font-medium">{libelleAvatarActif(etatJumeau.jumeau.avatar.version)}</span>
            <span className="text-gray-400">Voix : Ma voix — {etatJumeau.jumeau.voix.nom}</span>
          </div>
          {!moteurDispo && (
            <div className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200">{etatJumeau.messageMoteur ?? 'La génération vidéo avec votre avatar n’est pas disponible pour le moment.'}</div>
          )}

          {/* CE QUE DIT VOTRE AVATAR */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Ce que dit votre avatar</h3>
            <TexteAvecPrononciations
              valeur={texte}
              onChange={setTexte}
              maxLength={1200}
              rows={5}
              montrerParle
              placeholder="Écrivez ce que votre avatar doit dire…"
              attributs={{ 'data-mini-studio-texte': '' }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" data-mini-studio-ecouter onClick={ecouter} disabled={!texte.trim() || ecoute.etat === 'charge'} className="inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white disabled:opacity-40">
                {ecoute.etat === 'charge' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />} Prévisualiser la voix
              </button>
              <span className="text-xs text-gray-500">Gratuit — aucun crédit.</span>
            </div>
            {ecoute.url && <audio src={ecoute.url} controls autoPlay className="w-full h-9" />}
          </section>

          {/* CADRAGE */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Cadrage</h3>
            <div className="inline-flex rounded-xl bg-black/30 p-1" role="radiogroup" aria-label="Format">
              {FORMATS_STUDIO.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={format === f} data-mini-studio-format={f} disabled={enCours}
                  onClick={() => { setFormat(f); setRecadrage(RECADRAGE_NEUTRE); }}
                  className={`px-4 py-1.5 rounded-lg text-sm transition ${format === f ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-4">
              <div className="w-20 rounded-lg overflow-hidden bg-black relative" style={{ aspectRatio: RATIO_CSS[format] }}>
                {sourceApercu && (
                  <div className="absolute inset-0" style={{ transform: `translate(${recadrage.offsetX * 100}%, ${recadrage.offsetY * 100}%) scale(${recadrage.scale})` }}>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video src={sourceApercu} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <button type="button" data-mini-studio-recadrer onClick={() => setCropOuvert(true)} disabled={!sourceApercu}
                  className="inline-flex items-center gap-1.5 text-sm text-purple-300 hover:text-purple-200 disabled:opacity-40">
                  <Crop className="w-4 h-4" /> Recadrer
                </button>
                <div className="text-xs text-gray-500">
                  {!sourceApercu ? 'Disponible dès qu’une vidéo de votre avatar existe.' : recadrageNeutre(recadrage) ? 'Cadrage centré.' : `Zoom ${recadrage.scale.toFixed(2)}×, position ajustée.`}
                </div>
              </div>
            </div>
          </section>

          {/* STYLE VISUEL */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Style visuel</h3>
            <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Style visuel">
              <button type="button" role="radio" aria-checked={!lutChoisie} data-mini-studio-lut="original" onClick={() => setLutChoisie(null)}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm ${!lutChoisie ? 'bg-purple-600 text-white' : 'bg-black/30 text-gray-300 hover:text-white'}`}>
                Original
              </button>
              {(luts ?? []).map((l) => (
                <button key={l.empreinte} type="button" role="radio" aria-checked={lutChoisie?.empreinte === l.empreinte} data-mini-studio-lut={l.nom} onClick={() => setLutChoisie(l)}
                  className={`shrink-0 rounded-xl px-4 py-2 text-sm ${lutChoisie?.empreinte === l.empreinte ? 'bg-purple-600 text-white' : 'bg-black/30 text-gray-300 hover:text-white'}`}>
                  {l.nom}
                </button>
              ))}
            </div>
            {luts && luts.length === 0 && <p className="text-xs text-gray-500">Aucun style dans votre bibliothèque. Importez un fichier LUT dans Créer pour l’utiliser ici.</p>}
            {lutChoisie && (
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {apercuLut
                  ? <img data-mini-studio-lut-apercu src={apercuLut} alt={`Aperçu du style ${lutChoisie.nom}`} className="w-24 rounded-lg" />
                  : <span>{sourceApercu ? 'Aperçu en préparation…' : 'L’aperçu apparaîtra sur votre vidéo.'}</span>}
                <span>Appliqué au fichier MP4 téléchargé.</span>
              </div>
            )}
          </section>

          {/* COÛT */}
          <section data-mini-studio-cout className="rounded-xl bg-black/30 p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <div>Cette génération coûtera : <span data-mini-studio-cout-valeur className="font-semibold">{cout.libelleCout}</span></div>
              <div className="text-gray-400 text-xs">Votre solde : {cout.libelleSolde} · Cadrage, style et téléchargement inclus.</div>
            </div>
            {cout.insuffisant && <span data-mini-studio-insuffisant className="text-amber-300 text-xs">Crédits insuffisants</span>}
          </section>

          <button type="button" data-mini-studio-generer onClick={generer} disabled={!cout.peutGenerer || !moteurDispo}
            className="button-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50">
            {enCours ? <><Loader2 className="w-4 h-4 animate-spin" /> {phase === 'lancement' ? 'Lancement…' : 'Génération en cours…'}</> : <><Sparkles className="w-4 h-4" /> Générer ma vidéo · {cout.libelleCout}</>}
          </button>
          {phase === 'generation' && <p className="text-xs text-gray-500 text-center">Cela prend généralement 2 à 10 minutes. Vous pouvez quitter la page : la génération continue et sera reprise.</p>}
        </>
      )}

      {erreur && (
        <div data-mini-studio-erreur className="flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{erreur}</span>
        </div>
      )}

      {/* RÉSULTAT */}
      {resultat && (
        <section data-mini-studio-resultat className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium"><Check className="w-4 h-4" /> Votre vidéo est prête</div>
          <div className="mx-auto w-full max-w-[360px] rounded-xl overflow-hidden bg-black" style={{ aspectRatio: RATIO_CSS[resultat.format] }}>
            <video src={resultat.url} controls playsInline className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" data-mini-studio-telecharger onClick={() => void telecharger(resultat.url, resultat.format, true)} disabled={!!export_}
              className="button-primary px-5 py-2.5 text-sm inline-flex items-center gap-2 disabled:opacity-50">
              {export_ ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Télécharger MP4
            </button>
            <Link href="/dashboard/creer" className="text-sm text-purple-300 hover:text-purple-200">Créer un montage</Link>
          </div>
          {export_ && <div data-mini-studio-export className="text-xs text-gray-400">{export_.etape} {export_.pourcentage > 0 ? `${export_.pourcentage} %` : ''}</div>}
          {besoinPostTraitement({ recadrage, lutChoisie: !!lutChoisie }) && <p className="text-xs text-gray-500">Le cadrage et le style choisis sont appliqués au fichier téléchargé.</p>}
        </section>
      )}

      {/* MES DERNIERS RENDUS */}
      {rendus.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Mes derniers rendus</h3>
          <ul className="space-y-2">
            {rendus.map((r) => {
              const ancienne = versionActive !== null && typeof r.avatar_version === 'number' && r.avatar_version !== versionActive;
              const f: FormatStudio = estFormatStudio(r.aspect_ratio) ? r.aspect_ratio : '9:16';
              return (
                <li key={r.id} data-mini-studio-rendu={r.avatar_version ?? ''} className="flex items-center gap-3 rounded-xl bg-black/20 p-2">
                  <div className="w-10 rounded-md overflow-hidden bg-black shrink-0" style={{ aspectRatio: RATIO_CSS[f] }}>
                    <video src={r.video_url ?? undefined} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="text-gray-200">{new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {f}</div>
                    <div className={ancienne ? 'text-amber-300' : 'text-gray-500'}>
                      {typeof r.avatar_version === 'number' ? (ancienne ? `${libelleCreeAvecVersion(r.avatar_version)} — ancienne version` : libelleAvatarActif(r.avatar_version)) : 'Version inconnue'}
                    </div>
                  </div>
                  <button type="button" aria-label="Télécharger ce rendu" onClick={() => r.video_url && void telecharger(r.video_url, f, false)} disabled={!!export_} className="p-2 text-gray-400 hover:text-white disabled:opacity-40">
                    <Download className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <CropRushModal
        isOpen={cropOuvert}
        onClose={() => setCropOuvert(false)}
        rush={sourceApercu ? { url: sourceApercu, name: 'Votre avatar', kind: 'video', transform: recadrage } : null}
        format={format}
        onApply={(t) => { setRecadrage(t); setCropOuvert(false); }}
      />
    </div>
  );
}
