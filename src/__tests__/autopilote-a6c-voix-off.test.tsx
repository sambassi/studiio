/**
 * A_6c — LA VOIX-OFF : SCRIPT, SYNTHÈSE, MINUTAGES, SOUS-TITRES.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ STUDIIO N'ÉCRIT PAS LE SCRIPT, ET IL N'Y A RIEN À DÉSACTIVER
 * ---------------------------------------------------------------------------
 *
 * Faire composer une phrase par une machine, puis la faire dire par la voix
 * clonée de quelqu'un, c'est fabriquer une déclaration qu'il n'a jamais faite
 * — et c'est vrai même quand l'objectif de la vidéo s'appelle « témoignage ».
 * Le chemin ne contient aucune génération de texte : l'absence de ce bouton
 * n'est pas un manque, c'est le réglage.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ ET SANS MINUTAGE, PAS DE SOUS-TITRES
 * ---------------------------------------------------------------------------
 *
 * A_4 pose la règle : répartir un texte uniformément donnerait un minutage
 * inventé, et un mot actif qui ment. La synthèse demande donc l'audio ET
 * l'alignement dans le même appel — c'est ce qui rend les sous-titres de
 * voix-off possibles sans rien deviner.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  motsDepuisAlignement, scriptValide, dureeVoixSecondes, motsVoixValides,
  SCRIPT_MAX, MOTS_VOIX_MAX, type MotVoix,
} from '@/lib/voice/synthese';
import {
  voixOffValide, bibliothequeValide, BIBLIOTHEQUE_VIDE, bibliothequeVide,
} from '@/lib/creatif/bibliotheque';
import { sanitizeDesignStyle } from '@/lib/autopilot/textStyle';

const Panneau = (await import('@/components/creer/PanneauVoixOff')).default;
const { adresseVoix } = await import('@/components/creer/PanneauVoixOff');

const lire = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const SYNTHESE = lire('src/lib/voice/synthese.ts');
const ROUTE = lire('src/app/api/autopilot/voix-off/route.ts');
const PANNEAU = lire('src/components/creer/PanneauVoixOff.tsx');
const MOTEUR = lire('src/lib/autopilot/analyse/rendu.ts');
const CHAINE = lire('src/lib/autopilot/automatique/chaine-serveur.ts');
const ROUTE_MANUEL = lire('src/app/api/autopilot/montages/[montagePlanId]/rendu/route.ts');
const REGLAGES = lire('src/components/creer/ReglagesAudio.tsx');

const U = 'user-42';

/** « Bouge avec nous » aligné caractère par caractère. */
const alignement = (mot: string, depart: number) => {
  const cars = [...mot];
  return {
    characters: cars,
    debuts: cars.map((_, i) => depart + i * 0.05),
    fins: cars.map((_, i) => depart + (i + 1) * 0.05),
  };
};

function alignementDe(phrase: string) {
  const characters: string[] = [];
  const character_start_times_seconds: number[] = [];
  const character_end_times_seconds: number[] = [];
  let t = 0;
  for (const c of phrase) {
    characters.push(c);
    character_start_times_seconds.push(Math.round(t * 1000) / 1000);
    t += 0.05;
    character_end_times_seconds.push(Math.round(t * 1000) / 1000);
  }
  return { characters, character_start_times_seconds, character_end_times_seconds };
}

const VOIX_OFF = {
  cle: `${U}/voix/1700000000-voix-off.mp3`,
  empreinte: '120000-abc',
  dureeMs: 4200,
  script: 'Bouge avec nous dès aujourd’hui.',
  voiceId: 'ABCdef1234567890',
  creeeLe: '2026-09-08T15:00:00.000Z',
  mots: [
    { debutSecondes: 0, finSecondes: 0.4, texte: 'Bouge' },
    { debutSecondes: 0.5, finSecondes: 0.9, texte: 'avec' },
  ],
};

afterEach(() => { cleanup(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les mots, reconstitués depuis l’alignement', () => {
  it('1.1 les caractères redeviennent des mots', () => {
    const m = motsDepuisAlignement(alignementDe('Bouge avec nous'));
    expect(m.map((x) => x.texte)).toEqual(['Bouge', 'avec', 'nous']);
    expect(m[0].debutSecondes).toBe(0);
    expect(m[0].finSecondes).toBeCloseTo(0.25, 3);
    expect(m[1].debutSecondes).toBeCloseTo(0.3, 3);
  });

  it('1.2 ⚠️ LA PONCTUATION RESTE COLLÉE À SON MOT', () => {
    // La détacher en ferait un mot actif à lui seul, qui s'allumerait au
    // milieu d'une phrase.
    const m = motsDepuisAlignement(alignementDe('Viens aujourd’hui !'));
    expect(m.map((x) => x.texte)).toEqual(['Viens', 'aujourd’hui', '!']);
  });

  it('1.3 les espaces multiples ne fabriquent pas de mots vides', () => {
    const m = motsDepuisAlignement(alignementDe('un   deux'));
    expect(m.map((x) => x.texte)).toEqual(['un', 'deux']);
  });

  it('1.4 ⚠️ UN MOT DE DURÉE NULLE EST ÉCARTÉ', () => {
    // Le fournisseur rend parfois des bornes identiques sur un caractère
    // muet ; un mot de durée nulle disparaîtrait du découpage sans raison.
    const m = motsDepuisAlignement({
      characters: ['a', ' ', 'b'],
      character_start_times_seconds: [0, 0.1, 0.2],
      character_end_times_seconds: [0.1, 0.1, 0.2],
    });
    expect(m.map((x) => x.texte)).toEqual(['a']);
  });

  it('1.5 un alignement incohérent ne produit rien plutôt que n’importe quoi', () => {
    expect(motsDepuisAlignement(null)).toEqual([]);
    expect(motsDepuisAlignement({ characters: ['a'] })).toEqual([]);
    expect(motsDepuisAlignement({
      characters: ['a', 'b'],
      character_start_times_seconds: [0],
      character_end_times_seconds: [0.1],
    })).toEqual([]);
  });

  it('1.6 la liste est bornée', () => {
    const long = Array.from({ length: 600 }, (_, i) => `m${i}`).join(' ');
    expect(motsDepuisAlignement(alignementDe(long)).length).toBeLessThanOrEqual(MOTS_VOIX_MAX);
  });

  it('1.7 la durée totale est celle du dernier mot', () => {
    const m = motsDepuisAlignement(alignementDe('un deux'));
    expect(dureeVoixSecondes(m)).toBe(m[m.length - 1].finSecondes);
    expect(dureeVoixSecondes([])).toBe(0);
    expect(alignement).toBeDefined();
  });

  it('1.8 le module est PUR', () => {
    expect(sansProse(SYNTHESE)).not.toMatch(/fetch\(|node:fs|supabase/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le script', () => {
  it('2.1 ⚠️ ON NE CENSURE RIEN', () => {
    // Le script est ce que la personne a choisi de faire dire à SA voix.
    const brut = 'C’est l’énergie ! 50 % aujourd’hui, promis.';
    expect(scriptValide(brut)).toBe(brut);
  });

  it('2.2 seuls les caractères de contrôle partent', () => {
    expect(scriptValide('Bouge\navec\tnous')).toBe('Bouge avec nous');
    expect(scriptValide('   ')).toBeNull();
    expect(scriptValide(42)).toBeNull();
    expect(scriptValide('a'.repeat(5000))!.length).toBe(SCRIPT_MAX);
  });

  it('2.3 ⚠️ LA CLASSE DE CONTRÔLE EST ÉCRITE EN ÉCHAPPEMENT', () => {
    // Un octet de contrôle posé tel quel dans un source devient invisible à
    // la relecture — et une classe qu'on ne peut pas lire est une classe
    // qu'on ne peut pas vérifier.
    expect(SYNTHESE).toContain('/[\\u0000-\\u001f\\u007f]/g');
  });

  it('2.4 ⚠️ AUCUNE GÉNÉRATION DE SCRIPT, NULLE PART', () => {
    for (const src of [ROUTE, PANNEAU, SYNTHESE]) {
      expect(sansProse(src)).not.toMatch(
        /anthropic|openai|generer(Script|Texte)|redigerScript|claude/i,
      );
    }
    // Et l'écran le DIT, plutôt que de laisser chercher le bouton.
    expect(PANNEAU).toContain('Studiio ne l’écrit jamais à ta place');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La route', () => {
  it('3.1 ⚠️ LE PÉRIMÈTRE AVANT LE FOURNISSEUR', () => {
    // Appeler ElevenLabs pour une voix qu'on va refuser dépenserait des
    // crédits sur la voix de quelqu'un d'autre.
    const code = sansProse(ROUTE);
    const iGarde = code.indexOf('resoudreVoixElevenLabs(');
    const iAppel = code.indexOf('text-to-speech');
    expect(iGarde).toBeGreaterThan(-1);
    expect(iGarde).toBeLessThan(iAppel);
  });

  it('3.2 ⚠️ ELLE DEMANDE LES MINUTAGES DÈS LA SYNTHÈSE', () => {
    expect(sansProse(ROUTE)).toContain('/with-timestamps');
    expect(sansProse(ROUTE)).toContain('motsDepuisAlignement(');
  });

  it('3.3 la clé de stockage est FABRIQUÉE par le serveur', () => {
    const code = sansProse(ROUTE);
    expect(code).toContain('`${userId}/voix/${Date.now()}-voix-off.mp3`');
    expect(code).not.toMatch(/corps\.cle|body\.cle/);
  });

  it('3.4 aucun détail du fournisseur ne remonte à l’écran', () => {
    const code = sansProse(ROUTE);
    expect(code).not.toMatch(/error:\s*text|await reponse\.text\(\)/);
    expect(code).toContain('La synthèse a échoué');
  });

  it('3.5 la session est exigée, et la clé ne quitte pas le serveur', () => {
    const code = sansProse(ROUTE);
    expect(code).toContain('await auth()');
    expect(code).toContain('process.env.ELEVENLABS_API_KEY');
    expect(code).not.toContain('NEXT_PUBLIC_');
  });

  it('3.6 retirer la voix ne détruit pas le fichier', () => {
    const code = sansProse(ROUTE);
    expect(code).toContain('export async function DELETE');
    expect(code).not.toMatch(/removeObject|deleteObject/i);
  });

  it('3.7 la sortie ne porte pas les octets', () => {
    const code = sansProse(ROUTE);
    expect(code).toContain('voixOff: r.bibliotheque.voixOff');
    expect(code).not.toMatch(/audio_base64.*NextResponse|json\(\{[^}]*octets/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La persistance', () => {
  it('4.1 elle survit à l’aller-retour, avec le compte', () => {
    const style = sanitizeDesignStyle(
      { bibliothequeCreative: { voixOff: VOIX_OFF } }, U,
    );
    expect(style.bibliothequeCreative?.voixOff?.script).toBe(VOIX_OFF.script);
    expect(style.bibliothequeCreative?.voixOff?.mots.length).toBe(2);
  });

  it('4.2 ⚠️ SANS `userId`, ELLE EST NULLE — jamais devinée', () => {
    expect(bibliothequeValide({ voixOff: VOIX_OFF }).voixOff).toBeNull();
    expect(bibliothequeValide({ voixOff: VOIX_OFF }, U).voixOff).not.toBeNull();
  });

  it('4.3 ⚠️ UNE CLÉ HORS PRÉFIXE EST REFUSÉE', () => {
    expect(voixOffValide({ ...VOIX_OFF, cle: 'autre/voix/1.mp3' }, U)).toBeNull();
    expect(voixOffValide({ ...VOIX_OFF, cle: `${U}/../evasion.mp3` }, U)).toBeNull();
  });

  it('4.4 une fiche incomplète est refusée en bloc', () => {
    expect(voixOffValide({ ...VOIX_OFF, script: '' }, U)).toBeNull();
    expect(voixOffValide({ ...VOIX_OFF, dureeMs: 0 }, U)).toBeNull();
    expect(voixOffValide({ ...VOIX_OFF, voiceId: 'a b' }, U)).toBeNull();
    expect(voixOffValide({ ...VOIX_OFF, creeeLe: 'hier' }, U)).toBeNull();
  });

  it('4.5 sans mots, la voix reste utilisable — mais non sous-titrable', () => {
    const v = voixOffValide({ ...VOIX_OFF, mots: [] }, U);
    expect(v).not.toBeNull();
    expect(v!.mots).toEqual([]);
    // Et l'écran le DIT plutôt que de laisser croire au contraire.
    expect(PANNEAU).toContain('sans minutage — non sous-titrable');
  });

  it('4.6 les mots relus sont triés et bornés', () => {
    const desordre: MotVoix[] = [
      { debutSecondes: 2, finSecondes: 2.4, texte: 'deux' },
      { debutSecondes: 0, finSecondes: 0.4, texte: 'un' },
    ];
    expect(motsVoixValides(desordre).map((m) => m.texte)).toEqual(['un', 'deux']);
    expect(motsVoixValides([{ debutSecondes: 1, finSecondes: 0.5, texte: 'x' }])).toEqual([]);
  });

  it('4.7 un compte sans voix reste « vide »', () => {
    expect(BIBLIOTHEQUE_VIDE.voixOff).toBeNull();
    expect(bibliothequeVide(BIBLIOTHEQUE_VIDE)).toBe(true);
    expect(sanitizeDesignStyle({ bibliothequeCreative: { voixOff: null } }, U)
      .bibliothequeCreative).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le rendu et les sous-titres', () => {
  it('5.1 ⚠️ LA VOIX-OFF PASSE DEVANT LA PAROLE DU RUSH', () => {
    /* Sous-titrer le son d'ambiance pendant qu'une voix parle par-dessus
       donnerait deux textes qui ne correspondent à rien de ce qu'on écoute. */
    const m = sansProse(MOTEUR);
    expect(m).toContain('const voixOff = demande.captionsVoixOff ?? []');
    expect(m).toContain('voixOff.length > 0');
  });

  it('5.2 ⚠️ SES MINUTAGES NE SONT PAS PROJETÉS', () => {
    // Elle commence au début du montage et ne suit aucun plan : ses timings
    // sont déjà ceux du fichier final.
    const m = sansProse(MOTEUR);
    /* La BRANCHE de la voix-off ne projette rien : elle recopie les mots en
       leur donnant un plan. La branche du rush, elle, projette — et c'est
       exactement la difference que ce test tient. */
    expect(m).toContain("voixOff.map((m) => ({ ...m, ordrePlan: 1 }))");
    expect(m).toContain('demande.captions ? projeterMots(');
  });

  it('5.3 les deux chemins passent la voix ET ses mots', () => {
    expect(sansProse(CHAINE)).toContain('captionsVoixOff: biblio.voixOff?.mots ?? null');
    expect(sansProse(CHAINE)).toContain('cle: biblio.voixOff.cle');
    expect(sansProse(ROUTE_MANUEL)).toContain('motsVoixOffDuCompte(userId, recette.voix.cle)');
  });

  it('5.4 ⚠️ LES MOTS VIENNENT DU SERVEUR, PAS DU CORPS', () => {
    // Le navigateur choisit SI la voix parle ; ce qu'elle dit et quand elle le
    // dit sont ce que la synthèse a mesuré.
    const r = sansProse(ROUTE_MANUEL);
    expect(r).toContain('b.voixOff.cle === cle ? b.voixOff.mots : null');
  });

  it('5.5 la clé de voix est vérifiée comme celle d’une musique', () => {
    expect(sansProse(ROUTE_MANUEL)).toContain('verifierMusique(recette.voix, userId)');
  });

  it('5.6 ⚠️ UN PROFIL D’HIER N’A PAS DE VOIX', () => {
    // `voixOff` vaut `null` tant que personne n'a rien enregistré : la vidéo
    // rendue est exactement celle d'avant.
    expect(sansProse(CHAINE)).toContain('if (biblio.voixOff && recetteEffective)');
    expect(BIBLIOTHEQUE_VIDE.voixOff).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. L’écran', () => {
  const monter = (extra = {}) => render(
    <Panneau
      voixOff={null}
      utilisee={false}
      onUtiliser={() => {}}
      onEnregistree={() => {}}
      {...extra}
    />,
  );

  it('6.1 le script est écrit à la main, et borné', () => {
    const { container } = monter();
    const champ = container.querySelector('[data-voix-script]') as HTMLTextAreaElement;
    expect(champ).not.toBeNull();
    fireEvent.change(champ, { target: { value: 'a'.repeat(5000) } });
    expect((container.querySelector('[data-voix-script]') as HTMLTextAreaElement).value.length)
      .toBe(SCRIPT_MAX);
  });

  it('6.2 sans texte, on ne génère rien', () => {
    const { container } = monter();
    expect((container.querySelector('[data-voix-generer]') as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('6.3 ⚠️ ENREGISTRER ET UTILISER SONT DEUX GESTES', () => {
    // Générer ne change pas le montage en cours ; ce bouton, si.
    const bascules: boolean[] = [];
    const { container } = monter({
      voixOff: VOIX_OFF, onUtiliser: (u: boolean) => bascules.push(u),
    });
    const bouton = container.querySelector('[data-voix-utiliser]') as HTMLButtonElement;
    expect(bouton.getAttribute('aria-pressed')).toBe('false');
    expect(bouton.textContent).toContain('Utiliser dans cette vidéo');
    fireEvent.click(bouton);
    expect(bascules).toEqual([true]);
  });

  it('6.4 la voix enregistrée s’écoute, et dit si elle est sous-titrable', () => {
    const { container } = monter({ voixOff: VOIX_OFF });
    expect(container.querySelector('[data-voix-ecouter]')).not.toBeNull();
    expect(container.querySelector('[data-voix-enregistree]')!.textContent)
      .toContain('2 mots datés');
    // Un seul lecteur, et rien n'est téléchargé d'avance.
    expect(container.querySelectorAll('audio').length).toBe(1);
    expect((container.querySelector('audio') as HTMLAudioElement).getAttribute('preload'))
      .toBe('none');
  });

  it('6.5 l’écoute passe par le proxy existant', () => {
    expect(adresseVoix(`${U}/voix/a b.mp3`))
      .toBe(`/storage/v1/object/public/audio/${U}/voix/a%20b.mp3`);
    expect(sansProse(PANNEAU)).not.toMatch(/https?:\/\//);
  });

  it('6.6 sans voix disponible, on le dit au lieu d’un menu vide', () => {
    const { container } = monter();
    expect(container.querySelector('[data-voix-aucune]')).not.toBeNull();
  });

  it('6.7 retirer la voix retire aussi son usage dans la vidéo', () => {
    expect(REGLAGES).toContain('if (v === null && valeur.voix) majuscule({ voix: null })');
  });

  it('6.8 le panneau est monté dans les réglages audio', () => {
    expect(REGLAGES).toContain('<PanneauVoixOff');
    expect(REGLAGES).toContain('utilisee={valeur.voix != null}');
  });
});
