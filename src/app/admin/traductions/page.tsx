'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Download, Loader2, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { locales, localeNames, localeStatus } from '@/i18n/config';
import { LIBELLES_STATUT, type Compteurs, type Ligne, type Statut } from '@/lib/i18n/traductions';

/**
 * Administration des traductions : corriger et VALIDER progressivement, langue par langue, sans
 * toucher au code. Le français reste le repli de tout texte manquant ; la mention « Partiel » du
 * menu de langue est définie dans `src/i18n/config.ts` et n'est PAS modifiée ici.
 */
const TAILLE_PAGE = 50;
const LANGUES = locales.filter((l) => l !== 'fr');
const MENTION: Record<string, string> = { partial: 'Partiel', draft: 'Bêta', complete: 'Complète', source: 'Source' };
const COULEUR: Record<Statut, string> = {
  validee: 'bg-green-500/15 text-green-300 border-green-500/30',
  non_validee_attestee: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  non_validee_a_verifier: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  non_validee: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
  manquante: 'bg-red-500/10 text-red-300 border-red-500/30',
};
type Filtre = 'toutes' | 'non_validees' | 'a_verifier' | 'validees' | 'manquantes';
const FILTRES: Array<[Filtre, string]> = [['toutes', 'Toutes'], ['non_validees', 'Non validées'], ['a_verifier', 'À vérifier en priorité'], ['validees', 'Validées'], ['manquantes', 'Manquantes']];

interface Rapport { importees: number; inchangees: number; vides: number; refusees: Array<{ cle: string; raison: string }>; refuseesTotal: number }

export default function TraductionsAdminPage() {
  const [locale, setLocale] = useState<string>('ln');
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [compteurs, setCompteurs] = useState<Compteurs | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('non_validees');
  const [ns, setNs] = useState('');
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(0);
  const [edition, setEdition] = useState<{ cle: string; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'erreur'; texte: string } | null>(null);
  const [validees, setValidees] = useState(false);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const fichier = useRef<HTMLInputElement>(null);

  const charger = useCallback(async (l: string) => {
    setChargement(true); setErreur(''); setEdition(null); setRapport(null); setMessage(null);
    try {
      const r = await fetch(`/api/admin/traductions?locale=${l}`);
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Chargement impossible');
      setLignes(j.lignes); setCompteurs(j.compteurs);
    } catch (e) { setErreur(e instanceof Error ? e.message : 'Chargement impossible'); setLignes([]); setCompteurs(null); }
    finally { setChargement(false); }
  }, []);
  useEffect(() => { void charger(locale); }, [locale, charger]);
  useEffect(() => { setPage(0); }, [filtre, ns, recherche, locale]);

  const namespaces = useMemo(() => [...new Set(lignes.map((l) => l.ns))].sort(), [lignes]);
  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return lignes.filter((l) => {
      if (filtre === 'non_validees' && !(l.statut.startsWith('non_validee'))) return false;
      if (filtre === 'a_verifier' && l.statut !== 'non_validee_a_verifier') return false;
      if (filtre === 'validees' && l.statut !== 'validee') return false;
      if (filtre === 'manquantes' && l.statut !== 'manquante') return false;
      if (ns && l.ns !== ns) return false;
      if (q && !`${l.cle} ${l.fr} ${l.texte}`.toLowerCase().includes(q)) return false;
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

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-white">Traductions</h1>
        <p className="text-gray-400 mt-1">Corriger et valider les traductions, langue par langue, sans toucher au code. Le français reste affiché pour tout texte manquant.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Langue à corriger">
        {LANGUES.map((l) => (
          <button key={l} role="tab" aria-selected={locale === l} data-testid={`tr-langue-${l}`} onClick={() => setLocale(l)}
            className={`px-3 py-2 rounded-lg text-sm border ${locale === l ? 'bg-orange-500/15 text-orange-300 border-orange-500/40' : 'text-gray-400 border-gray-700 hover:text-white hover:bg-gray-800'}`}>
            {localeNames[l]}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 text-sm text-gray-300 space-y-1">
          <p>Mention affichée aux visiteurs dans le menu de langue : <strong data-testid="tr-mention" className="text-white">{MENTION[localeStatus[locale as keyof typeof localeStatus]]}</strong>. Elle est définie dans le code (<code>src/i18n/config.ts</code>) : cette page ne la modifie pas.</p>
          <p>Les traductions <strong>non validées</strong> sont affichées aux visiteurs comme les autres ; la validation sert à suivre ce qu’un locuteur natif a relu.</p>
        </CardContent>
      </Card>

      {erreur && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300"><AlertCircle size={18} />{erreur}</div>}
      {chargement && <div className="flex items-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={18} />Chargement…</div>}

      {compteurs && !chargement && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3" data-testid="tr-compteurs">
            {[['Clés', compteurs.total], ['Traduites', compteurs.traduites], ['Validées', compteurs.validees], ['Non validées', compteurs.nonValidees], ['À vérifier en priorité', compteurs.aVerifier], ['Manquantes', compteurs.manquantes]].map(([t, n]) => (
              <Card key={String(t)}><CardContent className="pt-4"><div className="text-xs text-gray-400">{t}</div><div className="text-2xl font-bold text-white">{n}</div></CardContent></Card>
            ))}
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1"><span>Part du catalogue traduite</span><span>{compteurs.pourcentTraduit} %</span></div>
            <div className="h-2 rounded bg-gray-800 overflow-hidden"><div className="h-2 bg-orange-500" style={{ width: `${compteurs.pourcentTraduit}%` }} /></div>
          </div>
        </>
      )}

      <Card>
        <CardHeader><CardTitle>Import / export CSV</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-gray-400">Colonnes attendues : <code>cle</code> et <code>traduction</code> (séparateur ; ou ,). Une cellule <code>traduction</code> vide est ignorée : réimporter un export n’efface rien. Les variables <code>{'{x}'}</code> du français doivent être conservées.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fichier} type="file" accept=".csv,text/csv" aria-label="Fichier CSV à importer" data-testid="tr-fichier" className="text-gray-300" />
            <label className="flex items-center gap-2 text-gray-300"><input type="checkbox" checked={validees} onChange={(e) => setValidees(e.target.checked)} data-testid="tr-validees" />Le fichier vient d’un relecteur natif : marquer les entrées comme <strong>validées</strong></label>
            <button onClick={importer} disabled={occupe} data-testid="tr-importer" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-orange-500/40 text-orange-300 hover:bg-orange-500/10 disabled:opacity-50"><Upload size={16} />Importer</button>
            <a href={`/api/admin/traductions?locale=${locale}&format=csv`} data-testid="tr-export" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-800"><Download size={16} />Exporter la langue (CSV)</a>
          </div>
          {rapport && (
            <div data-testid="tr-rapport" className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 space-y-1">
              <div className="text-gray-200">{rapport.importees} importée(s) · {rapport.inchangees} inchangée(s) · {rapport.vides} vide(s) ignorée(s) · {rapport.refuseesTotal} refusée(s)</div>
              {rapport.refusees.slice(0, 20).map((r) => <div key={r.cle} className="text-red-300 text-xs"><code>{r.cle}</code> — {r.raison}</div>)}
              {rapport.refuseesTotal > 20 && <div className="text-xs text-gray-500">… et {rapport.refuseesTotal - 20} autres.</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {message && <div role="status" className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${message.type === 'ok' ? 'border-green-500/30 bg-green-500/10 text-green-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{message.type === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}{message.texte}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Filtrer par statut">
          {FILTRES.map(([f, t]) => (
            <button key={f} data-testid={`tr-filtre-${f}`} aria-pressed={filtre === f} onClick={() => setFiltre(f)}
              className={`px-3 py-1.5 rounded-full text-xs border ${filtre === f ? 'bg-orange-500/15 text-orange-300 border-orange-500/40' : 'text-gray-400 border-gray-700 hover:text-white'}`}>{t}</button>
          ))}
        </div>
        <select value={ns} onChange={(e) => setNs(e.target.value)} aria-label="Filtrer par écran" className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200">
          <option value="">Tous les écrans</option>
          {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher (clé, français, traduction)" aria-label="Rechercher" data-testid="tr-recherche" className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 min-w-[260px]" />
        <span className="text-xs text-gray-500" data-testid="tr-nb">{visibles.length} entrée(s)</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm" data-testid="tr-table">
          <thead className="bg-gray-900 text-gray-400 text-left"><tr><th className="p-3 w-1/5">Clé</th><th className="p-3 w-1/4">Français</th><th className="p-3 w-1/3">Traduction</th><th className="p-3">Statut</th><th className="p-3"></th></tr></thead>
          <tbody>
            {affichees.map((l) => (
              <tr key={l.cle} className="border-t border-gray-800 align-top" data-testid={`tr-ligne-${l.cle}`}>
                <td className="p-3 text-gray-500 break-all"><div className="text-[11px] text-gray-600">{l.ns}</div>{l.cle.split('.').slice(-1)[0]}</td>
                <td className="p-3 text-gray-300">{l.fr}</td>
                <td className="p-3 text-gray-100">
                  {edition?.cle === l.cle ? (
                    <div className="space-y-2">
                      <textarea value={edition.texte} onChange={(e) => setEdition({ cle: l.cle, texte: e.target.value })} rows={3} aria-label={`Traduction de ${l.cle}`} data-testid="tr-edition" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-gray-100" />
                      <div className="flex flex-wrap gap-2">
                        <button disabled={occupe} onClick={() => enregistrer(l.cle, { texte: edition.texte })} data-testid="tr-enregistrer" className="px-2 py-1 rounded border border-gray-600 text-gray-200 hover:bg-gray-800 text-xs">Enregistrer (non validée)</button>
                        <button disabled={occupe || !edition.texte.trim()} onClick={() => enregistrer(l.cle, { texte: edition.texte, valider: true })} data-testid="tr-enregistrer-valider" className="px-2 py-1 rounded border border-green-500/40 text-green-300 hover:bg-green-500/10 text-xs">Enregistrer et valider</button>
                        {l.texte && <button disabled={occupe} onClick={() => enregistrer(l.cle, { texte: '' })} className="px-2 py-1 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 text-xs">Retirer (français)</button>}
                        <button onClick={() => setEdition(null)} className="px-2 py-1 rounded text-gray-400 hover:text-white text-xs">Annuler</button>
                      </div>
                    </div>
                  ) : (l.texte || <span className="text-gray-600 italic">— français affiché —</span>)}
                </td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] ${COULEUR[l.statut]}`} data-testid={`tr-statut-${l.cle}`}>{LIBELLES_STATUT[l.statut]}</span>
                  {l.source && <div className="text-[11px] text-gray-500 mt-1 max-w-[220px] break-words">{l.source}</div>}
                  {l.par && <div className="text-[11px] text-gray-600 mt-0.5">{l.par}</div>}
                </td>
                <td className="p-3 whitespace-nowrap space-y-1">
                  <button onClick={() => setEdition({ cle: l.cle, texte: l.texte })} data-testid={`tr-modifier-${l.cle}`} className="block px-2 py-1 rounded border border-gray-600 text-gray-200 hover:bg-gray-800 text-xs">{l.texte ? 'Modifier' : 'Traduire'}</button>
                  {l.texte && l.statut !== 'validee' && <button disabled={occupe} onClick={() => enregistrer(l.cle, { valider: true })} data-testid={`tr-valider-${l.cle}`} className="block px-2 py-1 rounded border border-green-500/40 text-green-300 hover:bg-green-500/10 text-xs">Valider</button>}
                  {l.statut === 'validee' && <button disabled={occupe} onClick={() => enregistrer(l.cle, { valider: false })} className="block px-2 py-1 rounded text-gray-400 hover:text-white text-xs">Retirer la validation</button>}
                </td>
              </tr>
            ))}
            {!chargement && affichees.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-500">Aucune entrée pour ce filtre.</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded border border-gray-700 disabled:opacity-40">Précédent</button>
          <span>Page {page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded border border-gray-700 disabled:opacity-40">Suivant</button>
        </div>
      )}
    </div>
  );
}
