import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  formatTime,
  nextPlaybackRate,
  rateLabel,
  pseudoWaveform,
  seedFromString,
  barsFromSamples,
  ratioFromPointer,
  barPlayed,
  PLAYBACK_RATES,
  BAR_COUNT,
} from '@/lib/audio/waveform';

/**
 * Lecteur audio à ondes.
 *
 * Le composant ne peut pas être exercé en jsdom : il n'y a ni lecture audio,
 * ni `AudioContext`, ni boîte englobante mesurable — `getBoundingClientRect()`
 * y rend des zéros. Les règles vivent donc dans un module pur, et ce qui reste
 * dans le composant est verrouillé sur la source.
 *
 * Deux d'entre elles ne se voient pas à l'usage mais se remarquent quand elles
 * manquent : une onde tirée de `Math.random()` sauterait à chaque `timeupdate`
 * (quatre fois par seconde), et un `AudioContext` laissé ouvert retiendrait un
 * périphérique audio pour rien.
 */

const player = readFileSync(resolve(__dirname, '../components/ui/AudioPlayer.tsx'), 'utf-8');
const recorder = readFileSync(
  resolve(__dirname, '../components/voice/VoiceCloneRecorder.tsx'),
  'utf-8',
);

describe('formatTime', () => {
  it('affiche M:SS', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('ne montre jamais NaN, Infinity ni de durée négative', () => {
    // Un WebM issu de MediaRecorder annonce souvent `Infinity` en durée.
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatTime(-12)).toBe('0:00');
  });
});

describe('La vitesse tourne en boucle', () => {
  it('1 → 1.5 → 2 → 1', () => {
    expect(nextPlaybackRate(1)).toBe(1.5);
    expect(nextPlaybackRate(1.5)).toBe(2);
    expect(nextPlaybackRate(2)).toBe(1);
  });

  it('une valeur hors cycle repart du début', () => {
    // Sinon un `playbackRate` exotique bloquerait la pastille.
    expect(nextPlaybackRate(3)).toBe(1);
    expect(nextPlaybackRate(Number.NaN)).toBe(1);
  });

  it('l étiquette porte le signe multiplier', () => {
    expect(rateLabel(1)).toBe('1×');
    expect(rateLabel(1.5)).toBe('1.5×');
    expect(PLAYBACK_RATES).toEqual([1, 1.5, 2]);
  });
});

describe('L onde décorative est STABLE', () => {
  it('deux appels avec la même graine rendent la même onde', () => {
    // Un `Math.random()` redessinerait l'onde à chaque `timeupdate`.
    expect(pseudoWaveform(42)).toEqual(pseudoWaveform(42));
  });

  it('deux graines différentes rendent des ondes différentes', () => {
    expect(pseudoWaveform(1)).not.toEqual(pseudoWaveform(2));
  });

  it('elle a le nombre de barres demandé', () => {
    expect(pseudoWaveform(1)).toHaveLength(BAR_COUNT);
    expect(pseudoWaveform(1, 12)).toHaveLength(12);
  });

  it('aucune barre n est nulle — un trou se lirait comme un silence', () => {
    for (const h of pseudoWaveform(7)) {
      expect(h).toBeGreaterThanOrEqual(0.15);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('un nombre de barres absurde ne casse rien', () => {
    expect(pseudoWaveform(1, 0)).toHaveLength(1);
    expect(pseudoWaveform(1, -5)).toHaveLength(1);
    expect(pseudoWaveform(0)).toHaveLength(BAR_COUNT);
  });

  it('la graine dérive de la source — même URL, même onde', () => {
    expect(seedFromString('blob:abc')).toBe(seedFromString('blob:abc'));
    expect(seedFromString('blob:abc')).not.toBe(seedFromString('blob:abd'));
    expect(seedFromString('')).toBeGreaterThanOrEqual(0);
  });
});

describe('Les vraies amplitudes', () => {
  it('prend la CRÊTE de chaque tranche, pas la moyenne', () => {
    // La moyenne d'un signal centré sur zéro tend vers zéro : l'onde serait
    // plate alors que le son est fort.
    const alternant = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]);
    for (const h of barsFromSamples(alternant, 4)) expect(h).toBe(1);
  });

  it('normalise sur son propre maximum', () => {
    // Un enregistrement à voix basse doit remplir la hauteur disponible.
    const faible = new Float32Array([0.01, 0.02, 0.03, 0.04]);
    expect(Math.max(...barsFromSamples(faible, 4))).toBe(1);
  });

  it('un silence complet ne rend pas des barres à zéro', () => {
    for (const h of barsFromSamples(new Float32Array(100), 8)) expect(h).toBe(0.15);
  });

  it('un échantillon vide rend une onde plate, pas une exception', () => {
    expect(barsFromSamples(new Float32Array(0), 5)).toEqual([0.15, 0.15, 0.15, 0.15, 0.15]);
  });

  it('rend exactement le nombre de barres demandé, même si l échantillon est plus court', () => {
    expect(barsFromSamples([0.5, 0.2], 10)).toHaveLength(10);
  });

  it('accepte un tableau ordinaire autant qu un Float32Array', () => {
    expect(barsFromSamples([1, 0.5, 0.25, 0], 2)).toHaveLength(2);
  });
});

describe('Le déplacement dans l onde est borné', () => {
  const rect = { left: 100, width: 200 };

  it('convertit une abscisse en fraction', () => {
    expect(ratioFromPointer(100, rect)).toBe(0);
    expect(ratioFromPointer(200, rect)).toBe(0.5);
    expect(ratioFromPointer(300, rect)).toBe(1);
  });

  it('un glissement au-delà des bords reste dans [0, 1]', () => {
    // Hors bornes, `currentTime` deviendrait négatif — le navigateur lève.
    expect(ratioFromPointer(-500, rect)).toBe(0);
    expect(ratioFromPointer(9999, rect)).toBe(1);
  });

  it('une zone de largeur nulle ne divise pas par zéro', () => {
    expect(ratioFromPointer(50, { left: 0, width: 0 })).toBe(0);
  });

  it('une abscisse non finie rend 0', () => {
    expect(ratioFromPointer(Number.NaN, rect)).toBe(0);
  });
});

describe('barPlayed — le remplissage suit la progression', () => {
  it('rien de lu à 0, tout à 1', () => {
    expect(barPlayed(0, 10, 0)).toBe(false);
    expect(barPlayed(9, 10, 1)).toBe(true);
  });

  it('la moitié des barres à mi-parcours', () => {
    const lues = Array.from({ length: 10 }, (_, i) => barPlayed(i, 10, 0.5)).filter(Boolean);
    expect(lues).toHaveLength(5);
  });

  it('une progression aberrante est bornée', () => {
    expect(barPlayed(0, 10, -1)).toBe(false);
    expect(barPlayed(9, 10, 42)).toBe(true);
  });

  it('sans barre, rien n est lu', () => {
    expect(barPlayed(0, 0, 0.5)).toBe(false);
  });
});

describe('Le composant — couleurs Studiio', () => {
  it('le bouton de lecture porte le dégradé violet → magenta', () => {
    expect(player).toContain("background: 'linear-gradient(135deg, #7C3AED 0%, #D91CD2 100%)'");
  });

  it('les barres lues portent le dégradé, les autres un gris', () => {
    expect(player).toContain('linear-gradient(180deg, #7C3AED 0%, #EC4899 100%)');
    expect(player).toContain("'#374151'");
  });

  it('le fond est le sombre Studiio', () => {
    expect(player).toContain("backgroundColor: '#0A0A0F'");
  });

  it('la pilule est arrondie', () => {
    expect(player).toContain('rounded-full border border-gray-800');
  });

  it('des icônes lucide, jamais un emoji', () => {
    expect(player).toContain("from 'lucide-react'");
    expect(player).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('le chrono est en chiffres à chasse fixe — il ne tremble pas', () => {
    expect(player).toContain("fontVariantNumeric: 'tabular-nums'");
  });
});

describe('Le composant — ce qui casserait en silence', () => {
  it('l élément audio est caché, mais bien présent', () => {
    // C'est lui qui lit : on ne réimplémente que l'habillage.
    expect(player).toContain('<audio ref={audioRef} src={src} preload="metadata" className="hidden" />');
  });

  it('le contexte de décodage est refermé', () => {
    // Laissé ouvert, il retient un périphérique audio pour rien — et les
    // navigateurs en limitent le nombre.
    expect(player).toContain('ctx.close().catch(() => {});');
  });

  it('un décodage qui échoue retombe sur l onde décorative', () => {
    expect(player).toContain('const shownBars = bars ?? fallbackBars;');
    expect(player).toContain('} catch {');
  });

  it('un décodage arrivé après démontage n écrit plus dans l état', () => {
    expect(player).toContain('if (cancelled) return;');
    expect(player).toContain('return () => { cancelled = true; };');
  });

  it('la promesse de play() est attrapée', () => {
    // Une source illisible la rejette : sans `catch`, la console se remplit.
    expect(player).toContain('.catch(() => setFailed(true));');
  });

  it('la durée du décodage prime quand elle est exploitable', () => {
    // Un WebM de MediaRecorder annonce souvent `Infinity` en durée.
    expect(player).toContain('if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);');
    expect(player).toContain('durationchange');
  });

  it('le glissement suit le curseur hors de la zone', () => {
    // Sans capture, tirer au-delà du bord interromprait le geste.
    expect(player).toContain('e.currentTarget.setPointerCapture(e.pointerId);');
    expect(player).toContain('onLostPointerCapture={endSeek}');
  });

  it('les écouteurs sont retirés au démontage', () => {
    expect(player).toContain("el.removeEventListener('timeupdate', onTime);");
    expect(player).toContain("el.removeEventListener('error', onErr);");
  });

  it('la fin de lecture remet le lecteur à zéro', () => {
    expect(player).toContain('const onEnd = () => { setPlaying(false); setCurrentTime(0); };');
  });

  it('l onde de repli est mémoïsée sur la source', () => {
    // Recalculée à chaque rendu, elle coûterait 48 tirages quatre fois par
    // seconde pendant la lecture.
    expect(player).toContain('useMemo(() => pseudoWaveform(seedFromString(src), BAR_COUNT), [src])');
  });
});

describe('Accessibilité', () => {
  it('le bouton de lecture est nommé, et son nom suit l état', () => {
    expect(player).toContain("aria-label={playing ? 'Mettre en pause' : 'Lire l’enregistrement'}");
  });

  it('l onde est un curseur annoncé, avec sa position', () => {
    expect(player).toContain('role="slider"');
    expect(player).toContain('aria-valuetext={`${formatTime(currentTime)} sur ${formatTime(duration)}`}');
  });

  it('l onde est atteignable et pilotable au clavier', () => {
    expect(player).toContain('tabIndex={0}');
    expect(player).toContain("if (e.key === 'ArrowRight')");
    expect(player).toContain("else if (e.key === 'ArrowLeft')");
  });

  it('le focus est visible sur chaque bouton', () => {
    expect(player.match(/focus-visible:ring-2/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('la vitesse et la corbeille sont nommées', () => {
    expect(player).toContain('aria-label={`Vitesse de lecture : ${rateLabel(rate)}`}');
    expect(player).toContain("aria-label=\"Supprimer l’enregistrement\"");
  });
});

describe('Intégration dans « Ma voix »', () => {
  it('le lecteur natif a disparu', () => {
    expect(recorder).not.toContain('<audio src={audioUrl} controls');
    expect(recorder).not.toContain('controls');
  });

  it('il est remplacé par le lecteur maison, avec sa corbeille', () => {
    expect(recorder).toContain('<AudioPlayer src={audioUrl} onDelete={discard} />');
    expect(recorder).toContain("import AudioPlayer from '@/components/ui/AudioPlayer';");
  });

  it('la logique d enregistrement n a pas bougé', () => {
    // Le lecteur ne devait toucher qu'à l'affichage.
    expect(recorder).toContain('const startRecording = useCallback(async () => {');
    expect(recorder).toContain("form.append('files', blob,");
    expect(recorder).toContain("streamRef.current?.getTracks().forEach((t) => t.stop());");
  });
});
