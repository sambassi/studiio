import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { fontVariablesCss, googleFontsUrlMany } from '../src/lib/fonts/catalog';

/**
 * Charge les polices du montage, cote SERVEUR.
 *
 * Le navigateur les obtient par `next/font/google`, qui pose ses variables CSS
 * dans la page. Remotion n'a ni l'un ni l'autre : sans ce crochet, le texte
 * sortait en Helvetica et le filigrane en Times.
 *
 * ⚠️ DEUX MANQUES, PAS UN — et le premier est le moins visible.
 *
 * 1. Les VARIABLES. `fontStack('Anton')` produit
 *    `var(--font-anton), 'Anton', sans-serif`. Une variable indefinie rend la
 *    declaration ENTIERE invalide au calcul : Chromium n'essaie meme pas le
 *    repli `'Anton'` et retombe sur `sans-serif`. Charger la police n'aurait
 *    donc rien change — la famille n'atteignait jamais le moteur.
 * 2. Les FICHIERS. Une fois la famille resolue, encore faut-il l'avoir.
 *
 * On ne charge que les familles REELLEMENT utilisees par ce montage : le
 * catalogue en compte cinquante-deux, et les charger toutes a chaque rendu
 * serait du reseau pur perdu.
 *
 * `delayRender` retient la premiere image jusqu'a ce que les polices soient
 * pretes : sans lui, les premieres frames sortiraient en police de repli et le
 * texte changerait de forme en cours de video.
 */
export function useMontageFonts(families: Array<string | undefined | null>): boolean {
  const [pret, setPret] = useState(false);
  // La cle evite de relancer a chaque rendu de React : seules les familles
  // comptent, pas l'identite du tableau.
  const cle = families.filter(Boolean).join('|');

  useEffect(() => {
    const jeton = delayRender(`Polices du montage : ${cle || 'aucune'}`);
    let annule = false;

    const finir = () => {
      if (annule) return;
      setPret(true);
      continueRender(jeton);
    };

    // 1. Les variables, toujours — meme sans famille personnalisee, les
    //    valeurs par defaut du design passent par `fontStack`.
    const style = document.createElement('style');
    style.setAttribute('data-montage-fonts', 'true');
    style.textContent = fontVariablesCss();
    document.head.appendChild(style);

    // 2. Les fichiers.
    const href = googleFontsUrlMany(families);
    if (!href) { finir(); return () => { annule = true; }; }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => {
      // `document.fonts.ready` attend le TELECHARGEMENT, pas seulement
      // l'analyse de la feuille : c'est lui qui garantit qu'aucune image ne
      // sort en police de repli.
      document.fonts.ready.then(finir).catch(finir);
    };
    // Un echec reseau ne doit pas bloquer le rendu indefiniment : on rend en
    // police de repli plutot que de laisser le rendu pendre.
    link.onerror = () => {
      console.warn('[Remotion] Feuille de polices indisponible — repli systeme');
      finir();
    };
    document.head.appendChild(link);

    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  return pret;
}
