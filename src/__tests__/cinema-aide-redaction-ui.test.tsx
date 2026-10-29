/**
 * CINEMA IA — l'aide a la redaction a l'ecran : elle PROPOSE, elle ne remplace jamais.
 *
 * Le reseau est double : aucune IA reelle. Ce qui est eprouve ici est ce qu'un utilisateur
 * risque — demander une proposition, la lire, la corriger, l'accepter ou la rejeter, et
 * retrouver son texte intact dans tous les cas.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
import AideRedaction from '@/components/cinema/AideRedaction';
import { ACTIONS_REDACTION } from '@/lib/cinema/redaction';

const CONTEXTE = {
  titre: 'Signal perdu',
  styleCinema: 'scifi' as const,
  nbScenes: 4,
  format: '16:9',
  casting: [{ nom: 'Ada', role: 'protagoniste', description: 'combinaison blanche' }, { nom: '', role: '', description: '' }],
};
const HISTOIRE = 'Ada se reveille seule dans la station. Orion attend devant le sas.';
const PROPOSE = 'Ada ouvre les yeux dans le couloir bleu. Ada dit : « On y va ». La navette decolle.';

let envois: Array<Record<string, unknown>>;
let reponse: () => { status: number; corps: unknown };

beforeEach(() => {
  envois = [];
  reponse = () => ({
    status: 200,
    corps: { ok: true, action: 'rediger', texte: PROPOSE, diagnostic: { plans: 3, repliques: 1, inconnus: [], repliquesCassees: 0, assezDePhrases: true } },
  });
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    envois.push(JSON.parse(String(init?.body ?? '{}')));
    const r = reponse();
    return new Response(JSON.stringify(r.corps), { status: r.status, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function poser(histoire = HISTOIRE, avecContexte = true) {
  const surChanger = vi.fn();
  render(<AideRedaction histoire={histoire} surChanger={surChanger} personnages={['Ada']} contexte={avecContexte ? CONTEXTE : undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Aide a la redaction' }));
  return surChanger;
}
const panneau = () => screen.getByRole('dialog', { name: 'Aide a la redaction' });
const apercu = () => document.querySelector('[data-aide="apercu"]') as HTMLElement;

describe('ouverture et actions proposees', () => {
  it('les six actions de redaction sont la, en plus des actions locales', () => {
    poser();
    for (const a of ACTIONS_REDACTION) expect(within(panneau()).getByText(a.libelle)).toBeTruthy();
    expect(within(panneau()).getByText('Une phrase par ligne')).toBeTruthy();
    expect(within(panneau()).getByText('Ajouter une replique')).toBeTruthy();
    expect(panneau().textContent).toMatch(/Aucun crédit n’est débité/);
  });

  it('texte vide : seule « Rédiger depuis une idée » reste active', () => {
    poser('');
    for (const a of ACTIONS_REDACTION) {
      const b = within(panneau()).getByText(a.libelle).closest('button') as HTMLButtonElement;
      expect(b.disabled, a.id).toBe(a.exigeTexte);
    }
  });

  it('sans contexte de film : aucune action IA, donc aucun appel possible', () => {
    poser(HISTOIRE, false);
    expect(within(panneau()).queryByText('Développer le scénario')).toBeNull();
    expect(within(panneau()).getByText('Une phrase par ligne')).toBeTruthy();
  });
});

describe('le contexte part avec la demande, une seule fois', () => {
  it('action, histoire, personnages nommés, style, scènes, format et titre', async () => {
    poser();
    fireEvent.click(within(panneau()).getByText('Développer le scénario'));
    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]).toMatchObject({
      action: 'developper', histoire: HISTOIRE, styleCinema: 'scifi', nbScenes: 4, format: '16:9', titre: 'Signal perdu',
    });
    // Le personnage vide du formulaire n'est pas envoyé : il n'apparaîtrait nulle part.
    expect(envois[0].personnages).toEqual([{ nom: 'Ada', role: 'protagoniste', description: 'combinaison blanche' }]);
  });

  it('pendant l’attente, les actions sont bloquées : pas de double demande', async () => {
    let resoudre: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      envois.push(JSON.parse(String(init?.body ?? '{}')));
      await new Promise<void>((r) => { resoudre = r; });
      return new Response(JSON.stringify(reponse().corps), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    poser();
    fireEvent.click(within(panneau()).getByText('Améliorer le texte'));
    await waitFor(() => expect(envois).toHaveLength(1));
    fireEvent.click(within(panneau()).getByText('Raccourcir'));
    expect(envois).toHaveLength(1);
    resoudre!();
    await waitFor(() => expect(apercu()).toBeTruthy());
  });
});

describe('aperçu : accepter, corriger ou rejeter — jamais de remplacement automatique', () => {
  it('la proposition s’affiche en aperçu SANS toucher au texte, avec ce que le découpage en ferait', async () => {
    const surChanger = poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(apercu()).toBeTruthy());
    expect(surChanger).not.toHaveBeenCalled();
    expect((within(apercu()).getByLabelText(/Proposition/) as HTMLTextAreaElement).value).toBe(PROPOSE);
    expect(apercu().textContent).toMatch(/3 plans · 1 replique/);
    expect(apercu().textContent).toMatch(/reste intact tant que vous n’appliquez pas/);
  });

  it('« Appliquer » remplace le texte, et seulement alors', async () => {
    const surChanger = poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(apercu()).toBeTruthy());
    fireEvent.click(within(apercu()).getByText('Appliquer'));
    expect(surChanger).toHaveBeenCalledWith(PROPOSE);
    expect(apercu()).toBeNull();
  });

  it('on peut CORRIGER la proposition avant de l’appliquer', async () => {
    const surChanger = poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(apercu()).toBeTruthy());
    fireEvent.change(within(apercu()).getByLabelText(/Proposition/), { target: { value: 'Ada entre. Elle sourit.' } });
    fireEvent.click(within(apercu()).getByText('Appliquer'));
    expect(surChanger).toHaveBeenCalledWith('Ada entre. Elle sourit.');
  });

  it('« Rejeter » jette la proposition et laisse le texte intact', async () => {
    const surChanger = poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(apercu()).toBeTruthy());
    fireEvent.click(within(apercu()).getByText('Rejeter'));
    expect(apercu()).toBeNull();
    expect(surChanger).not.toHaveBeenCalled();
    // Le panneau reste ouvert : on peut demander autre chose.
    expect(within(panneau()).getByText('Raccourcir')).toBeTruthy();
  });

  it('Échap rejette la proposition AVANT de fermer le panneau (rien n’est perdu par mégarde)', async () => {
    const surChanger = poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(apercu()).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(apercu()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Aide a la redaction' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Aide a la redaction' })).toBeNull();
    expect(surChanger).not.toHaveBeenCalled();
  });

  it('une proposition qui nomme quelqu’un hors casting est signalée avant d’être acceptée', async () => {
    reponse = () => ({ status: 200, corps: { ok: true, action: 'rediger', texte: PROPOSE, diagnostic: { plans: 3, repliques: 1, inconnus: ['Marco'], repliquesCassees: 1, assezDePhrases: true } } });
    poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(apercu()).toBeTruthy());
    expect(apercu().textContent).toMatch(/Noms hors casting : Marco/);
    expect(apercu().textContent).toMatch(/point dans les guillemets/);
  });
});

describe('pannes : dites, jamais avalées, et sans perte', () => {
  it('service indisponible : message du serveur, texte intact, actions à nouveau disponibles', async () => {
    reponse = () => ({ status: 503, corps: { ok: false, indisponible: true, erreur: 'Le service IA est momentanement indisponible. Votre texte n’a pas ete modifie.' } });
    const surChanger = poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(within(panneau()).getByRole('status')).toBeTruthy());
    expect(within(panneau()).getByRole('status').textContent).toMatch(/momentanement indisponible/);
    expect(surChanger).not.toHaveBeenCalled();
    expect((within(panneau()).getByText('Raccourcir').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('réseau coupé : un message clair, aucune exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const surChanger = poser();
    fireEvent.click(within(panneau()).getByText('Rédiger depuis une idée'));
    await waitFor(() => expect(within(panneau()).getByRole('status')).toBeTruthy());
    expect(within(panneau()).getByRole('status').textContent).toMatch(/injoignable/);
    expect(surChanger).not.toHaveBeenCalled();
  });
});

describe('UX premium et responsive', () => {
  it('petite icône SVG, panneau borné à l’écran, aucun emoji', () => {
    poser();
    const icone = screen.getByRole('button', { name: 'Aide a la redaction' });
    expect(icone.querySelector('svg')).toBeTruthy();
    expect(icone.className).toMatch(/h-7 w-7/);
    expect(panneau().style.maxWidth).toBe('calc(100vw - 2rem)');
    // Aucun emoji A L'ECRAN (les « ⚠️ » du code sont des commentaires, convention du depot).
    expect(panneau().textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(within(panneau()).getAllByRole('button').every((b) => b.querySelector('svg') || b.textContent?.trim())).toBe(true);
  });
});
