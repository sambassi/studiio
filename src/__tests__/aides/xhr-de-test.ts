/**
 * Un `XMLHttpRequest` de test qui ROUTE vers `globalThis.fetch` : les pages
 * envoient désormais leurs formulaires par XHR (pour voir les octets partir),
 * et les tests de page, eux, décrivent le serveur avec un `fetch` factice.
 *
 * Il rejoue des événements `upload.progress` RÉELS au sens du contrat XHR
 * (`lengthComputable`, `loaded`, `total`) — configurables par test — puis
 * `load` avec le statut et le JSON du `fetch`. Aucun pourcentage n'est
 * fabriqué ici : `loaded/total`, c'est tout.
 */

export interface EtapeEnvoi { loaded: number; total: number; lengthComputable?: boolean }

export interface XhrDeTest {
  /** Les étapes de progression rejouées pour chaque envoi (défaut : total en une fois). */
  etapes: EtapeEnvoi[] | ((corps: FormData) => EtapeEnvoi[]);
  /** Les requêtes XHR vues : URL, corps. */
  envois: Array<{ url: string; corps: FormData }>;
  /** Simuler une panne réseau (`error`) au lieu d'un `load`. */
  panne: boolean;
  /** Retenir la réponse jusqu'à ce que le test la libère (pour observer l'état pendant l'envoi). */
  retenir: boolean;
  liberer: () => void;
  restaurer: () => void;
}

type Ecouteur = ((e: ProgressEvent) => void) | null;

export function installerXhrDeTest(): XhrDeTest {
  const original = globalThis.XMLHttpRequest;
  const etat: XhrDeTest = {
    etapes: [],
    envois: [],
    panne: false,
    retenir: false,
    liberer: () => {},
    restaurer: () => { globalThis.XMLHttpRequest = original; },
  };

  class FauxXhr {
    upload: { onprogress: Ecouteur } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    withCredentials = false;
    responseType = '';
    status = 0;
    responseText = '';
    private methode = 'GET';
    private url = '';
    open(methode: string, url: string) { this.methode = methode; this.url = url; }
    abort() { this.onabort?.(); }
    send(corps: FormData) {
      etat.envois.push({ url: this.url, corps });
      void (async () => {
        await Promise.resolve();
        const total = corpsTaille(corps);
        const etapes = typeof etat.etapes === 'function' ? etat.etapes(corps) : etat.etapes;
        for (const e of etapes.length ? etapes : [{ loaded: total, total }]) {
          this.upload.onprogress?.({ lengthComputable: e.lengthComputable ?? true, loaded: e.loaded, total: e.total } as ProgressEvent);
          await Promise.resolve();
        }
        if (etat.panne) { this.onerror?.(); return; }
        if (etat.retenir) await new Promise<void>((r) => { etat.liberer = r; });
        const res = await globalThis.fetch(this.url, { method: this.methode, body: corps });
        this.status = res.status;
        try { this.responseText = JSON.stringify(await res.json()); } catch { this.responseText = ''; }
        this.onload?.();
      })();
    }
  }

  globalThis.XMLHttpRequest = FauxXhr as unknown as typeof XMLHttpRequest;
  return etat;
}

function corpsTaille(corps: FormData): number {
  let total = 0;
  corps.forEach((v) => { total += typeof v === 'string' ? v.length : v.size; });
  return total;
}
