'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, Download, Languages, Loader2, Upload } from 'lucide-react';
import InfoBulle from '@/components/ui/InfoBulle';
import { locales, localeNames, localeStatus } from '@/i18n/config';
import { useLocale } from '@/i18n/client';
import { LIBELLES_STATUT, type Compteurs, type Ligne, type Statut } from '@/lib/i18n/traductions';

/**
 * Administration des traductions : corriger et VALIDER progressivement, langue par langue, sans
 * toucher au code. Le français reste le repli de tout texte manquant ; la mention « Partiel » du
 * menu de langue est définie dans `src/i18n/config.ts` et n'est PAS modifiée ici.
 *
 * ⚠️ La langue CHOISIE ICI est la langue *travaillée*. Elle ne touche jamais la langue de
 * l'administrateur : celle-ci vit dans le cookie `locale` et ne change que par le menu de
 * langue de Studiio (`I18nProvider`). Aucun mécanisme parallèle n'est introduit ici.
 */
const TAILLE_PAGE = 50;
const LANGUES = locales.filter((l) => l !== 'fr');
const MENTION: Record<string, string> = { partial: 'Partiel', draft: 'Bêta', complete: 'Complète', source: 'Source' };
/** Au-delà, le texte est replié sur deux lignes avec un bouton « Déplier » (le tableau garde sa forme). */
const LONG = 90;

/**
 * Badge COURT, une seule ligne. Trois notions bien distinctes, qu'il ne faut jamais confondre :
 *  - validation administrateur  → un administrateur a enregistré et validé le texte ici ;
 *  - attestation documentaire   → le texte vient d'une source écrite citée (dictionnaire, corpus) ;
 *  - validation linguistique    → relecture par un locuteur natif ; elle n'est PAS suivie par cet écran.
 * Le badge ne porte que l'état ; le reste va en ligne de description ou dans l'infobulle.
 */
const BADGES: Record<Statut, { court: string; classe: string }> = {
  validee: { court: 'Validée', classe: 'border-green-500/25 bg-green-500/10 text-green-300' },
  non_validee_attestee: { court: 'Non validée', classe: 'border-gray-600/60 bg-gray-700/30 text-gray-300' },
  non_validee_a_verifier: { court: 'À vérifier', classe: 'border-amber-500/25 bg-amber-500/10 text-amber-300' },
  non_validee: { court: 'Non validée', classe: 'border-gray-600/60 bg-gray-700/30 text-gray-300' },
  proposee_ia: { court: 'Proposition IA', classe: 'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-300' },
  manquante: { court: 'Manquante', classe: 'border-red-500/25 bg-red-500/10 text-red-300' },
};

/** Information secondaire d'une ligne : UNE ligne discrète sous le badge, jamais dans le badge. */
function detailStatut(l: Ligne): string {
  if (l.statut === 'proposee_ia') return 'Non vérifiée par un locuteur';
  if (l.statut === 'validee') return `Validation administrateur${l.par ? ` · ${l.par}` : ''}`;
  if (l.statut === 'non_validee_attestee') return `Source attestée${l.source ? ` · ${l.source}` : ''}`;
  if (l.statut === 'non_validee_a_verifier') return `Source à vérifier${l.source ? ` · ${l.source}` : ''}`;
  if (l.statut === 'non_validee' && l.confiance === 'admin') return `Corrigée par l’administration${l.par ? ` · ${l.par}` : ''}`;
  return '';
}

type Filtre = 'propositions' | 'toutes' | 'non_validees' | 'a_verifier' | 'validees' | 'manquantes';
const FILTRES: Array<[Filtre, string]> = [['propositions', 'Propositions IA à examiner'], ['toutes', 'Toutes'], ['non_validees', 'Non validées'], ['a_verifier', 'À vérifier en priorité'], ['validees', 'Validées'], ['manquantes', 'Manquantes']];

const BTN = 'inline-flex items-center justify-center h-7 px-2 rounded-md border text-[11px] leading-none whitespace-nowrap transition-colors disabled:opacity-50';
const BTN_NEUTRE = `${BTN} border-gray-700 text-gray-200 hover:bg-gray-800`;
const BTN_VERT = `${BTN} border-green-500/40 text-green-300 hover:bg-green-500/10`;
const BTN_FANTOME = `${BTN} border-transparent text-gray-500 hover:text-white`;

interface Rapport { importees: number; inchangees: number; vides: number; refusees: Array<{ cle: string; raison: string }>; refuseesTotal: number }

export default function TraductionsAdminPage() {
  /** Langue de l'administrateur lui-même (cookie `locale`, posé par le menu de Studiio) : jamais modifiée ici. */
  const langueAdmin = useLocale();
  const [locale, setLocale] = useState<string>('ln');
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [compteurs, setCompteurs] = useState<Compteurs | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('non_validees');
  /** L'utilisateur a-t-il choisi le filtre lui-même ? Alors AUCUNE réponse réseau ne l'écrase. */
  const filtreChoisi = useRef(false);
  /** Numero de la derniere demande de chargement : une reponse plus ancienne est ignoree. */
  const demandeCourante = useRef(0);
  const [ns, setNs] = useState('');
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(0);
  const [edition, setEdition] = useState<{ cle: string; texte: string } | null>(null);
  const [deplies, setDeplies] = useState<Set<string>>(new Set());
  const [copiee, setCopiee] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'erreur'; texte: string } | null>(null);
  const [validees, setValidees] = useState(false);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const [apercu, setApercu] = useState(false);
  useEffect(() => { setApercu(/(?:^|;\s*)i18n_apercu_ia=1/.test(document.cookie)); }, []);
  function basculerApercu() {
    // Cookie d'aperçu : concerne CE navigateur et ne fait effet que pour un administrateur connecté (contrôlé côté serveur).
    document.cookie = apercu ? 'i18n_apercu_ia=; path=/; max-age=0; samesite=lax' : 'i18n_apercu_ia=1; path=/; max-age=86400; samesite=lax';
    setApercu(!apercu);
  }

  const charger = useCallback(async (l: string) => {
    // RESEAU HORS ORDRE : en changeant vite de langue, la reponse d'une langue
    // precedente peut arriver APRES celle qu'on attend et reafficher ses compteurs.
    // Chaque demande porte donc un numero ; seule la derniere a le droit d'ecrire.
    const jeton = demandeCourante.current + 1;
    demandeCourante.current = jeton;
    setChargement(true); setErreur(''); setEdition(null); setRapport(null); setMessage(null);
    try {
      const r = await fetch(`/api/admin/traductions?locale=${l}`);
      const j = await r.json();
      if (jeton !== demandeCourante.current) return;
      if (!r.ok || !j.success) throw new Error(j.error || 'Chargement impossible');
      setLignes(j.lignes); setCompteurs(j.compteurs);
      // Des propositions IA attendent un examen : on les montre d'abord. MAIS une fois que
      // l'utilisateur a cliqué un filtre, plus rien ne le remplace — ni une seconde réponse
      // réseau, ni le double rendu de React en mode strict.
      if (!filtreChoisi.current) setFiltre(j.compteurs?.propositionsIA > 0 ? 'propositions' : 'non_validees');
    } catch (e) {
      if (jeton !== demandeCourante.current) return;
      setErreur(e instanceof Error ? e.message : 'Chargement impossible'); setLignes([]); setCompteurs(null);
    }
    finally { if (jeton === demandeCourante.current) setChargement(false); }
  }, []);
  useEffect(() => { void charger(locale); }, [locale, charger]);
  useEffect(() => { setPage(0); setDeplies(new Set()); }, [filtre, ns, recherche, locale]);

  /** Changer de langue travaillée : la langue de l'administrateur n'est PAS touchée. */
  function choisirLangue(l: string) { filtreChoisi.current = false; setLocale(l); }
  function choisirFiltre(f: Filtre) { filtreChoisi.current = true; setFiltre(f); }
  function basculerDepli(cle: string) { setDeplies((s) => { const n = new Set(s); if (n.has(cle)) n.delete(cle); else n.add(cle); return n; }); }
  async function copierCle(cle: string) {
    try { await navigator.clipboard?.writeText(cle); } catch { /* presse-papiers refusé : le titre de l'élément reste lisible */ }
    setCopiee(cle); setTimeout(() => setCopiee((c) => (c === cle ? '' : c)), 1500);
  }

  const namespaces = useMemo(() => [...new Set(lignes.map((l) => l.ns))].sort(), [lignes]);
  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return lignes.filter((l) => {
      if (filtre === 'propositions' && l.statut !== 'proposee_ia') return false;
      if (filtre === 'non_validees' && !(l.statut.startsWith('non_validee'))) return false;
      if (filtre === 'a_verifier' && l.statut !== 'non_validee_a_verifier') return false;
      if (filtre === 'validees' && l.statut !== 'validee') return false;
      if (filtre === 'manquantes' && l.statut !== 'manquante') return false;
      if (ns && l.ns !== ns) return false;
      if (q && !`${l.cle} ${l.fr} ${l.texte} ${l.proposition || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lignes, filtre, ns, recherche]);
  const pages = Math.max(1, Math.ceil(visibles.length / TAILLE_PAGE));
  const affichees = visibles.slice(page * TAILLE_PAGE, (page + 1) * TAILLE_PAGE);

  async function enregistrer(cle: string, corps: { texte?: string; valider?: boolean }) {
    setOccupe(true); setMessage(null);
    try {
      const r = await fetch('/api/admin/traductions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale, cle, ...corps }) });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Enregistrement impossible');
      setLignes((ls) => ls.map((l) => (l.cle === cle ? j.ligne : l))); setCompteurs(j.compteurs); setEdition(null);
      setMessage({ type: 'ok', texte: 'Enregistré.' });
    } catch (e) { setMessage({ type: 'erreur', texte: e instanceof Error ? e.message : 'Enregistrement impossible' }); }
    finally { setOccupe(false); }
  }

  async function approuverLot(cles: string[]) {
    setOccupe(true); setMessage(null);
    try {
      for (let i = 0; i < cles.length; i += 600) {
        const r = await fetch('/api/admin/traductions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale, approuver: cles.slice(i, i + 600) }) });
        const j = await r.json();
        if (!r.ok || !j.success) throw new Error(j.error || 'Approbation impossible');
        setLignes(j.lignes); setCompteurs(j.compteurs);
        setMessage({ type: 'ok', texte: `${j.approuvees} proposition(s) approuvée(s) : elles s’affichent maintenant aux utilisateurs.` });
      }
    } catch (e) { setMessage({ type: 'erreur', texte: e instanceof Error ? e.message : 'Approbation impossible' }); }
    finally { setOccupe(false); }
  }

  async function importer() {
    const f = fichier.current?.files?.[0];
    if (!f) { setMessage({ type: 'erreur', texte: 'Choisissez d’abord un fichier CSV.' }); return; }
    setOccupe(true); setMessage(null); setRapport(null);
    try {
      const csv = await f.text();
      const r = await fetch('/api/admin/traductions/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale, csv, validees }) });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Import impossible');
      setRapport(j.rapport); setMessage({ type: 'ok', texte: `Import terminé : ${j.rapport.importees} entrée(s) importée(s).` });
      if (fichier.current) fichier.current.value = '';
      await charger(locale);
      setRapport(j.rapport);
    } catch (e) { setMessage({ type: 'erreur', texte: e instanceof Error ? e.message : 'Import impossible' }); }
    finally { setOccupe(false); }
  }

  /** Ouvrir l'éditeur. Une traduction DÉJÀ VALIDÉE demande confirmation : la modifier retire la validation. */
  function ouvrirEdition(l: Ligne) {
    if (l.statut === 'validee' && !window.confirm('Cette traduction est validée. La modifier retire la validation tant que vous ne validez pas de nouveau. Continuer ?')) return;
    setEdition({ cle: l.cle, texte: l.texte || l.proposition || '' });
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Traductions</h1>
        <p className="text-gray-400 text-sm mt-1">Corriger et valider les traductions, langue par langue, sans toucher au code. Le français reste affiché pour tout texte manquant.</p>
      </div>

      {/* Langue TRAVAILLÉE — distincte de la langue de l'administrateur. */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Langue à corriger">
          {LANGUES.map((l) => (
            <button key={l} role="tab" aria-selected={locale === l} data-testid={`tr-langue-${l}`} onClick={() => choisirLangue(l)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${locale === l ? 'bg-orange-500/15 text-orange-300 border-orange-500/40' : 'text-gray-400 border-gray-700 hover:text-white hover:bg-gray-800'}`}>
              {localeNames[l]}
            </button>
          ))}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500" data-testid="tr-langue-admin">
          <Languages size={14} className="text-gray-600" aria-hidden="true" />
          <span>Votre interface reste en <strong className="text-gray-300">{localeNames[langueAdmin]}</strong> : choisir une langue ci-dessus ne traduit que ce qui est corrigé.</span>
          <span className="text-gray-600">Mention publique de cette langue : <strong data-testid="tr-mention" className="text-gray-300">{MENTION[localeStatus[locale as keyof typeof localeStatus]]}</strong>.</span>
          <InfoBulle label="En savoir plus sur la langue de l’interface et la langue corrigée" titre="Deux langues différentes" marqueur="tr-info-langues">
            <span className="block space-y-2">
              <span className="block">La langue choisie ci-dessus est celle que vous <strong>corrigez</strong>. Elle ne change ni vos menus, ni ceux des autres administrateurs.</span>
              <span className="block">Pour changer la langue de <strong>votre</strong> espace, utilisez le menu de langue de Studiio : il pose le cookie <code>locale</code>, qui vaut pour vous seul.</span>
              <span className="block">La mention publique (Source, Complète, Bêta, Partiel) est définie dans le code (<code>src/i18n/config.ts</code>) : cette page ne la modifie pas.</span>
            </span>
          </InfoBulle>
        </p>
      </div>

      {/* Aperçu des propositions IA — une seule ligne, le détail derrière l'infobulle. */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <button onClick={basculerApercu} data-testid="tr-apercu" aria-pressed={apercu} className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${apercu ? 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200' : 'border-gray-600 text-gray-200 hover:bg-gray-800'}`}>{apercu ? 'Aperçu activé — désactiver' : 'Activer l’aperçu pour moi'}</button>
          <span className="text-gray-400 text-xs">Les propositions IA ne s’affichent pas aux utilisateurs tant qu’elles ne sont pas approuvées.</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <a href="/dashboard" target="_blank" rel="noreferrer" className="text-orange-300 underline" data-testid="tr-voir-dashboard">Tableau de bord</a>
            <a href="/dashboard/creer" target="_blank" rel="noreferrer" className="text-orange-300 underline">CRÉER</a>
            <a href="/dashboard/cinema" target="_blank" rel="noreferrer" className="text-orange-300 underline">Cinéma IA</a>
          </span>
          <InfoBulle label="En savoir plus sur l’aperçu des propositions IA" titre="Aperçu des propositions" marqueur="tr-info-apercu">
            <span className="block space-y-2">
              <span className="block">L’aperçu vous montre, <strong>à vous seul</strong>, les propositions non publiées dans Studiio.</span>
              <span className="block">Il repose sur un cookie valable 24 h dans ce navigateur. Choisissez ensuite la langue dans le menu de Studiio.</span>
              <span className="block">Les traductions <strong>non validées</strong>, elles, sont bien affichées aux visiteurs : la validation sert à suivre ce qu’un relecteur a vu.</span>
            </span>
          </InfoBulle>
        </div>
      </div>

      {erreur &&<div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300"><AlertCircle size={18} />{erreur}</div>}
      {chargement && <div className="flex items-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={18} />Chargement…</div>}

      {compteurs && !chargement && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" data-testid="tr-compteurs">
            {[['Clés', compteurs.total], ['Traduites', compteurs.traduites], ['Validées', compteurs.validees], ['Non validées', compteurs.nonValidees], ['À vérifier en priorité', compteurs.aVerifier], ['Propositions IA', compteurs.propositionsIA], ['Manquantes', compteurs.manquantes]].map(([t, n]) => (
              <div key={String(t)} className="rounded-xl border border-gray-800 bg-gray-900 p-3"><div className="text-[11px] text-gray-400 leading-tight">{t}</div><div className="text-xl font-bold text-white">{n}</div></div>
            ))}
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1"><span>Part du catalogue traduite</span><span>{compteurs.pourcentTraduit} %</span></div>
            <div className="h-1.5 rounded bg-gray-800 overflow-hidden"><div className="h-1.5 bg-orange-500" style={{ width: `${compteurs.pourcentTraduit}%` }} /></div>
          </div>
        </>
      )}

      {/* Import / export — replié dans un <details> : utile, mais pas tous les jours. */}
      <details className="rounded-xl border border-gray-800 bg-gray-900/40">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm text-gray-200">Import / export CSV</summary>
        <div className="px-4 pb-4 space-y-3 text-sm">
          <p className="text-gray-400 text-xs">Colonnes attendues : <code>cle</code> et <code>traduction</code> (séparateur ; ou ,). Une cellule <code>traduction</code> vide est ignorée : réimporter un export n’efface rien. Les variables <code>{'{x}'}</code> du français doivent être conservées.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fichier} type="file" accept=".csv,text/csv" aria-label="Fichier CSV à importer" data-testid="tr-fichier" className="text-gray-300 text-xs max-w-full" />
            <label className="flex items-center gap-2 text-gray-300 text-xs"><input type="checkbox" checked={validees} onChange={(e) => setValidees(e.target.checked)} data-testid="tr-validees" />Le fichier vient d’un relecteur natif : marquer les entrées comme <strong>validées</strong></label>
            <button onClick={importer} disabled={occupe} data-testid="tr-importer" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-orange-500/40 text-orange-300 hover:bg-orange-500/10 disabled:opacity-50 text-xs"><Upload size={14} />Importer</button>
            <a href={`/api/admin/traductions?locale=${locale}&format=csv`} data-testid="tr-export" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-800 text-xs"><Download size={14} />Exporter la langue (CSV)</a>
          </div>
          {rapport && (
            <div data-testid="tr-rapport" className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 space-y-1">
              <div className="text-gray-200 text-xs">{rapport.importees} importée(s) · {rapport.inchangees} inchangée(s) · {rapport.vides} vide(s) ignorée(s) · {rapport.refuseesTotal} refusée(s)</div>
              {rapport.refusees.slice(0, 20).map((r) => <div key={r.cle} className="text-red-300 text-xs"><code>{r.cle}</code> — {r.raison}</div>)}
              {rapport.refuseesTotal > 20 && <div className="text-xs text-gray-500">… et {rapport.refuseesTotal - 20} autres.</div>}
            </div>
          )}
        </div>
      </details>

      {message && <div role="status" className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${message.type === 'ok' ? 'border-green-500/30 bg-green-500/10 text-green-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{message.type === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}{message.texte}</div>}

      {/* Filtres, écran et recherche : une seule barre compacte. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" aria-label="Filtrer par statut">
          {FILTRES.map(([f, t]) => (
            <button key={f} data-testid={`tr-filtre-${f}`} aria-pressed={filtre === f} onClick={() => choisirFiltre(f)}
              className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${filtre === f ? 'bg-orange-500/15 text-orange-300 border-orange-500/40' : 'text-gray-400 border-gray-700 hover:text-white'}`}>{t}</button>
          ))}
        </div>
        <select value={ns} onChange={(e) => setNs(e.target.value)} aria-label="Filtrer par écran" className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 max-w-[160px]">
          <option value="">Tous les écrans</option>
          {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher (clé, français, traduction)" aria-label="Rechercher" data-testid="tr-recherche" className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1 text-xs text-gray-200 min-w-[180px]" />
        <span className="text-[11px] text-gray-500 whitespace-nowrap" data-testid="tr-nb">{visibles.length} entrée(s)</span>
        {filtre === 'propositions' && visibles.length > 0 && (
          <button disabled={occupe} data-testid="tr-approuver-lot" onClick={() => { if (window.confirm(`Approuver ${visibles.length} proposition(s) IA et les publier aux utilisateurs ?`)) void approuverLot(visibles.map((l) => l.cle)); }} className={BTN_VERT}>Approuver les {visibles.length} affichées</button>
        )}
      </div>

      {/* Bureau : tableau dense. Mobile (390 px) : chaque ligne s'empile, sans débordement horizontal. */}
      <div className="rounded-xl border border-gray-800 md:overflow-x-auto">
        <table className="block md:table w-full md:table-fixed text-sm" data-testid="tr-table">
          <thead className="hidden md:table-header-group bg-gray-900/80 text-gray-400 text-left text-xs">
            <tr>
              <th className="px-3 py-2 w-[19%] font-medium">Clé</th>
              <th className="px-3 py-2 w-[22%] font-medium">Français</th>
              <th className="px-3 py-2 w-[27%] font-medium">Traduction</th>
              <th className="px-3 py-2 w-[16%] font-medium">
                Statut
                <InfoBulle label="En savoir plus sur les statuts" titre="Ce que chaque statut veut dire" marqueur="tr-info-statuts" className="ml-1 align-middle">
                  <span className="block space-y-2">
                    <span className="block"><strong>Proposition IA</strong> — texte proposé par l’IA, <em>non publié</em> : le français s’affiche tant qu’il n’est pas approuvé.</span>
                    <span className="block"><strong>À vérifier</strong> — traduction publiée dont la source est incertaine : à relire en priorité.</span>
                    <span className="block"><strong>Non validée</strong> — traduction publiée que personne n’a encore validée ici. La ligne de description précise si elle vient d’une <em>source attestée</em> (dictionnaire, corpus cité) ou d’une correction de l’administration.</span>
                    <span className="block"><strong>Validée</strong> — un administrateur l’a validée dans cet écran. C’est une <em>validation administrateur</em> : elle ne garantit pas, à elle seule, la relecture par un locuteur natif.</span>
                    <span className="block"><strong>Manquante</strong> — aucune traduction : le français est affiché.</span>
                    <span className="block text-gray-400">Validation administrateur, attestation documentaire et validation linguistique sont trois choses différentes : cet écran suit les deux premières.</span>
                  </span>
                </InfoBulle>
              </th>
              <th className="px-3 py-2 w-[16%] font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {affichees.map((l) => {
              const badge = BADGES[l.statut];
              const detail = detailStatut(l);
              const deplie = deplies.has(l.cle);
              const longue = l.fr.length > LONG || (l.texte || l.proposition || '').length > LONG;
              const clampe = longue && !deplie ? 'line-clamp-2' : '';
              return (
                <tr key={l.cle} className="block md:table-row border-t border-gray-800 px-3 py-2.5 md:p-0 align-top hover:bg-gray-900/40" data-testid={`tr-ligne-${l.cle}`}>
                  {/* Clé — une seule ligne, copiable au clic. */}
                  <td className="block md:table-cell md:px-3 md:py-2 align-top">
                    <button type="button" onClick={() => void copierCle(l.cle)} title={`${l.cle} — copier`} aria-label={`Copier la clé ${l.cle}`} data-testid={`tr-cle-${l.cle}`}
                      className="group flex max-w-full items-center gap-1 text-left text-gray-500 hover:text-gray-200 transition-colors">
                      <span className="truncate font-mono text-[11px]">{l.cle}</span>
                      {copiee === l.cle
                        ? <Check size={12} className="shrink-0 text-green-400" aria-hidden="true" />
                        : <Copy size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />}
                    </button>
                  </td>
                  {/* Français */}
                  <td className="block md:table-cell md:px-3 md:py-2 align-top text-gray-300">
                    <span className="md:hidden text-[10px] uppercase tracking-wide text-gray-600 mr-1.5">FR</span>
                    <span className={`${clampe} break-words`}>{l.fr}</span>
                  </td>
                  {/* Traduction (ou mention « Français affiché ») */}
                  <td className="block md:table-cell md:px-3 md:py-2 align-top text-gray-100">
                    {edition?.cle === l.cle ? (
                      <div className="space-y-2">
                        <textarea value={edition.texte} onChange={(e) => setEdition({ cle: l.cle, texte: e.target.value })} rows={3} aria-label={`Traduction de ${l.cle}`} data-testid="tr-edition" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-gray-100 text-sm" />
                        <div className="flex flex-wrap gap-1.5">
                          {l.proposition && <button disabled={occupe} onClick={() => enregistrer(l.cle, { texte: l.proposition, valider: true })} data-testid={`tr-approuver-${l.cle}`} className={BTN_VERT}>Approuver la proposition</button>}
                          <button disabled={occupe} onClick={() => enregistrer(l.cle, { texte: edition.texte })} data-testid="tr-enregistrer" className={BTN_NEUTRE}>Enregistrer (non validée)</button>
                          <button disabled={occupe || !edition.texte.trim()} onClick={() => enregistrer(l.cle, { texte: edition.texte, valider: true })} data-testid="tr-enregistrer-valider" className={BTN_VERT}>Enregistrer et valider</button>
                          {l.texte && <button disabled={occupe} onClick={() => enregistrer(l.cle, { texte: '' })} className={`${BTN} border-red-500/40 text-red-300 hover:bg-red-500/10`}>Retirer (français)</button>}
                          <button onClick={() => setEdition(null)} className={BTN_FANTOME}>Annuler</button>
                        </div>
                      </div>
                    ) : l.proposition ? (
                      <>
                        <span className="md:hidden text-[10px] uppercase tracking-wide text-gray-600 mr-1.5">IA</span>
                        {/* `line-clamp-2` pose son propre display : ne JAMAIS lui ajouter `block`, qui l'annule. */}
                        <span className={`text-fuchsia-100 break-words ${clampe || 'block'}`} data-testid={`tr-proposition-${l.cle}`}>{l.proposition}</span>
                        {/* Une seule ligne : le texte complet reste dans le DOM et dans l'infobulle du titre. */}
                        <span className="block text-[11px] text-gray-500 mt-0.5 md:truncate" title="Non publiée — le français s’affiche tant qu’elle n’est pas approuvée.">Non publiée — le français s’affiche tant qu’elle n’est pas approuvée.</span>
                      </>
                    ) : l.texte ? (
                      <span className={`break-words ${clampe || 'block'}`}>{l.texte}</span>
                    ) : (
                      <span className="text-gray-600 italic text-xs">Français affiché</span>
                    )}
                    {longue && edition?.cle !== l.cle && (
                      <button type="button" onClick={() => basculerDepli(l.cle)} data-testid={`tr-deplier-${l.cle}`} className="mt-0.5 text-[11px] text-gray-500 hover:text-gray-200 underline underline-offset-2">{deplie ? 'Replier' : 'Déplier'}</button>
                    )}
                  </td>
                  {/* Statut : badge court + une ligne de description discrète. */}
                  <td className="block md:table-cell md:px-3 md:py-2 align-top">
                    <span className={`inline-flex h-5 items-center rounded border px-1.5 text-[11px] leading-none whitespace-nowrap ${badge.classe}`} data-testid={`tr-statut-${l.cle}`} title={LIBELLES_STATUT[l.statut]}>{badge.court}</span>
                    {detail && <span className="block text-[11px] text-gray-500 mt-0.5 md:truncate" title={detail}>{detail}</span>}
                  </td>
                  {/* Actions : zone réservée, alignée, même hauteur de bouton partout. */}
                  <td className="block md:table-cell md:px-3 md:py-2 align-top">
                    <div className="flex flex-wrap gap-1.5 md:justify-end mt-1.5 md:mt-0">
                      {edition?.cle === l.cle ? (
                        <span className="text-[11px] text-gray-600 leading-7">En cours d’édition…</span>
                      ) : l.statut === 'proposee_ia' ? (
                        <button onClick={() => ouvrirEdition(l)} data-testid={`tr-examiner-${l.cle}`} className={`${BTN} border-fuchsia-500/40 text-fuchsia-200 hover:bg-fuchsia-500/10`}>Examiner</button>
                      ) : (
                        <>
                          <button onClick={() => ouvrirEdition(l)} data-testid={`tr-modifier-${l.cle}`} className={BTN_NEUTRE}>{l.texte ? 'Modifier' : 'Traduire'}</button>
                          {l.texte && l.statut !== 'validee' && <button disabled={occupe} onClick={() => enregistrer(l.cle, { valider: true })} data-testid={`tr-valider-${l.cle}`} className={BTN_VERT}>Valider</button>}
                          {l.statut === 'validee' && <button disabled={occupe} onClick={() => enregistrer(l.cle, { valider: false })} className={BTN_FANTOME}>Retirer la validation</button>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!chargement && affichees.length === 0 && <tr className="block md:table-row"><td colSpan={5} className="block md:table-cell p-6 text-center text-gray-500 text-sm">Aucune entrée pour ce filtre.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className={BTN_NEUTRE}>Précédent</button>
          <span>Page {page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className={BTN_NEUTRE}>Suivant</button>
        </div>
      )}
    </div>
  );
}
