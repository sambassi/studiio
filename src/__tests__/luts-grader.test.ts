import { describe, it, expect, vi } from 'vitest';
import { toCube, lutToTextureData, domainUniforms, createLutGrader } from '@/lib/luts/grader';
import { MAX_LUT_SIZE, type Lut } from '@/lib/luts/types';

/**
 * Étalonnage du rush sur GPU, pour le compositeur.
 *
 * Le shader ne peut pas tourner ici — jsdom n'a pas de WebGL. Ce qui est
 * testable, et c'est là que vivent les vrais bugs :
 * - **la table envoyée à la carte** : une erreur d'indexation y produit des
 *   couleurs fausses et plausibles, qu'aucune relecture ne rattrape ;
 * - **chaque repli** : quoi qu'il arrive au GPU, l'étalonneur rend `null` et
 *   le compositeur peint le rush brut, sans jamais faire échouer le montage.
 */

function identityCube(n: number): Lut {
  const table = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        table[i++] = r / (n - 1);
        table[i++] = g / (n - 1);
        table[i++] = b / (n - 1);
      }
    }
  }
  return { kind: '3d', size: n, table, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

/**
 * Faux contexte WebGL : chaque méthode est un `vi.fn` qui réussit. Les
 * constantes valent leur nom, ce qui suffit à les distinguer.
 */
function fakeGl(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    MAX_TEXTURE_SIZE: 'MAX_TEXTURE_SIZE',
    COMPILE_STATUS: 'COMPILE_STATUS',
    LINK_STATUS: 'LINK_STATUS',
    getParameter: vi.fn(() => 16384),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    isContextLost: vi.fn(() => false),
    loseContext: vi.fn(),
    ...overrides,
  };
  base.getExtension = vi.fn(() => ({ loseContext: base.loseContext }));
  return new Proxy(base, {
    get(target, key: string) {
      if (!(key in target)) target[key] = /^[A-Z_0-9]+$/.test(key) ? key : vi.fn(() => ({}));
      return target[key];
    },
  }) as Record<string, ReturnType<typeof vi.fn>> & Record<string, unknown>;
}

function canvasWith(gl: unknown) {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => gl),
  } as unknown as HTMLCanvasElement;
}

const source = {} as TexImageSource;

describe('toCube', () => {
  it('laisse une LUT 3D telle quelle', () => {
    const lut = identityCube(4);
    expect(toCube(lut)).toBe(lut);
  });

  it('déplie une LUT 1D en cube, courbe par canal', () => {
    // Rouge écrasé à 0, vert et bleu inchangés.
    const lut: Lut = {
      kind: '1d',
      size: 2,
      table: Float32Array.from([0, 0, 0, 0, 1, 1]),
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    };
    const cube = toCube(lut)!;
    expect(cube.kind).toBe('3d');
    expect(cube.size).toBe(2);
    // Nœud (r=1, g=1, b=1) → dernier triplet.
    expect(Array.from(cube.table.slice(-3))).toEqual([0, 1, 1]);
  });

  it('refuse une 1D trop longue pour tenir en cube, plutôt que d’allouer des gigaoctets', () => {
    const size = 4096;
    const lut: Lut = {
      kind: '1d',
      size,
      table: new Float32Array(size * 3),
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
    };
    expect(toCube(lut)).toBeNull();
  });

  it('accepte le plafond du socle (65 pas, export DaVinci)', () => {
    expect(toCube(identityCube(MAX_LUT_SIZE))).not.toBeNull();
  });
});

describe('lutToTextureData', () => {
  const N = 4;

  it('produit une bande de tuiles : size² de large, size de haut', () => {
    const { data, width, height } = lutToTextureData(identityCube(N));
    expect(width).toBe(N * N);
    expect(height).toBe(N);
    expect(data.length).toBe(width * height * 4);
  });

  it('range chaque nœud dans la bonne tuile', () => {
    // C'est LE test d'indexation : la tuile porte le bleu, x le rouge, y le
    // vert. Une permutation ici donne des couleurs fausses mais plausibles.
    const { data, width } = lutToTextureData(identityCube(N));
    const texel = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    const level = (v: number) => Math.round((v / (N - 1)) * 255);

    for (const [r, g, b] of [
      [0, 0, 0],
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
      [2, 1, 3],
    ]) {
      expect(texel(b * N + r, g)).toEqual([level(r), level(g), level(b), 255]);
    }
  });

  it('sature les valeurs hors gamut au lieu de les faire boucler', () => {
    // `Uint8Array` ne sature pas : 1.2 * 255 = 306 y deviendrait 50.
    const lut = identityCube(2);
    lut.table[0] = 1.2;
    lut.table[1] = -0.3;
    const { data } = lutToTextureData(lut);
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(0);
  });
});

describe('domainUniforms', () => {
  it('ramène le domaine déclaré vers 0→1, par canal', () => {
    const lut = { ...identityCube(2), domainMin: [0, -1, 0] as [number, number, number], domainMax: [1, 1, 4] as [number, number, number] };
    expect(domainUniforms(lut)).toEqual({ min: [0, -1, 0], inv: [1, 0.5, 0.25] });
  });

  it('un domaine vide donne 0, comme applyLutToPixels', () => {
    const lut = { ...identityCube(2), domainMin: [0.5, 0, 0] as [number, number, number], domainMax: [0.5, 1, 1] as [number, number, number] };
    expect(domainUniforms(lut).inv[0]).toBe(0);
  });
});

describe('createLutGrader — replis : le rush reste brut, le montage n’échoue jamais', () => {
  it('rend null quand WebGL est indisponible', () => {
    const canvas = canvasWith(null);
    expect(createLutGrader(identityCube(4), 1, { createCanvas: () => canvas })).toBeNull();
  });

  it('rend null si la création du canvas lève', () => {
    expect(
      createLutGrader(identityCube(4), 1, {
        createCanvas: () => {
          throw new Error('pas de DOM');
        },
      }),
    ).toBeNull();
  });

  it('rend null à intensité nulle, sans même ouvrir de contexte', () => {
    const canvas = canvasWith(fakeGl());
    expect(createLutGrader(identityCube(4), 0, { createCanvas: () => canvas })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it('rend null si la texture dépasse la limite du GPU, et libère le contexte', () => {
    const gl = fakeGl({ getParameter: vi.fn(() => 4096) });
    // 65 pas → 4225 px de large > 4096.
    expect(createLutGrader(identityCube(65), 1, { createCanvas: () => canvasWith(gl) })).toBeNull();
    expect(gl.loseContext).toHaveBeenCalled();
  });

  it('rend null si le shader est refusé', () => {
    const gl = fakeGl({ getShaderParameter: vi.fn(() => false) });
    expect(createLutGrader(identityCube(4), 1, { createCanvas: () => canvasWith(gl) })).toBeNull();
    expect(gl.loseContext).toHaveBeenCalled();
  });

  it('rend null si l’initialisation GPU lève', () => {
    const gl = fakeGl({
      bufferData: vi.fn(() => {
        throw new Error('GPU perdu');
      }),
    });
    expect(createLutGrader(identityCube(4), 1, { createCanvas: () => canvasWith(gl) })).toBeNull();
  });

  it('rend null pour une 1D trop longue', () => {
    const lut: Lut = { kind: '1d', size: 4096, table: new Float32Array(4096 * 3), domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
    const canvas = canvasWith(fakeGl());
    expect(createLutGrader(lut, 1, { createCanvas: () => canvas })).toBeNull();
  });
});

describe('createLutGrader — rendu', () => {
  it('étalonne une frame aux dimensions de la source et rend son canvas', () => {
    const gl = fakeGl();
    const canvas = canvasWith(gl);
    const grader = createLutGrader(identityCube(4), 0.5, { createCanvas: () => canvas })!;
    expect(grader).not.toBeNull();

    expect(grader.grade(source, 1080, 1920)).toBe(canvas);
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);
    expect(gl.drawArrays).toHaveBeenCalledTimes(1);
    // Intensité transmise telle quelle au shader.
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 0.5);
  });

  it('borne une intensité hors plage', () => {
    const gl = fakeGl();
    createLutGrader(identityCube(4), 7, { createCanvas: () => canvasWith(gl) });
    expect(gl.uniform1f).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('une frame refusée (source sans CORS) rend null, puis reste hors service', () => {
    let calls = 0;
    const gl = fakeGl({
      texImage2D: vi.fn(() => {
        // Premier appel = téléversement de la LUT ; les suivants = frames.
        if (++calls > 1) throw new DOMException('tainted', 'SecurityError');
      }),
    });
    const grader = createLutGrader(identityCube(4), 1, { createCanvas: () => canvasWith(gl) })!;
    expect(grader.grade(source, 10, 10)).toBeNull();
    expect(grader.grade(source, 10, 10)).toBeNull();
    // Pas de nouvelle tentative : une frame sur deux étalonnée serait pire.
    expect(calls).toBe(2);
  });

  it('un contexte perdu en cours de montage rend null', () => {
    const gl = fakeGl({ isContextLost: vi.fn(() => true) });
    const grader = createLutGrader(identityCube(4), 1, { createCanvas: () => canvasWith(gl) })!;
    expect(grader.grade(source, 10, 10)).toBeNull();
    expect(gl.drawArrays).not.toHaveBeenCalled();
  });

  it('dispose libère le contexte, une seule fois, et coupe le rendu', () => {
    const gl = fakeGl();
    const grader = createLutGrader(identityCube(4), 1, { createCanvas: () => canvasWith(gl) })!;
    grader.dispose();
    grader.dispose();
    expect(gl.loseContext).toHaveBeenCalledTimes(1);
    // Le contexte est RENDU au navigateur (extension dédiée), pas laissé au
    // ramasse-miettes : sinon ~16 exports d'affilée épuisent les contextes.
    expect(gl.getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(grader.grade(source, 10, 10)).toBeNull();
  });

  it('dispose ne lève jamais, même si loseContext lève ou si l’extension manque', () => {
    const gl = fakeGl();
    gl.loseContext.mockImplementation(() => { throw new Error('contexte déjà perdu'); });
    const grader = createLutGrader(identityCube(4), 1, { createCanvas: () => canvasWith(gl) })!;
    expect(() => grader.dispose()).not.toThrow();
    expect(() => grader.dispose()).not.toThrow();
    expect(gl.loseContext).toHaveBeenCalledTimes(1);

    const sansExtension = fakeGl();
    const g2 = createLutGrader(identityCube(4), 1, { createCanvas: () => canvasWith(sansExtension) })!;
    sansExtension.getExtension.mockImplementation(() => null);
    expect(() => g2.dispose()).not.toThrow();
  });
});
