/**
 * A_8h — CE QUE LE JUMEAU DIT DANS UNE VIDEO « CREER » : LES VOIX-OFF DES SEQUENCES.
 *
 * Le texte affiche d'un montage manuel est deja ecrit par la personne, sequence
 * par sequence (« Voix-off par sequence »). Le jumeau dit CE texte, dans
 * l'ordre des sequences actives — rien n'est compose a sa place. Le texte
 * parle en est derive cote serveur (`texteParle`, A_8d) ; ici on ne fait
 * qu'assembler ce qui est affiche.
 *
 * Les sequences du montage (`intro`, `cards`, `video`, `cta`) et les voix-off
 * (`titre`, `cartes`, `video`, `cta`) ne portent pas les memes cles : la
 * correspondance vit ici, a un seul endroit.
 */

const CLE_VOIX: Record<string, 'titre' | 'cartes' | 'video' | 'cta'> = {
  intro: 'titre', cards: 'cartes', video: 'video', cta: 'cta',
};

export function displayScriptJumeau(
  sequences: readonly { key: string; enabled: boolean }[],
  voix: Partial<Record<'titre' | 'cartes' | 'video' | 'cta', { text?: unknown } | undefined>>,
): string {
  const morceaux: string[] = [];
  for (const s of sequences) {
    if (!s.enabled) continue;
    const cle = CLE_VOIX[s.key];
    const texte = cle ? voix[cle]?.text : undefined;
    if (typeof texte === 'string' && texte.trim().length > 0) morceaux.push(texte.trim());
  }
  return morceaux.join(' ');
}
