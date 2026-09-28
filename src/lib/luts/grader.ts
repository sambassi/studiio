import { MAX_LUT_SIZE, type Lut } from './types';

/**
 * Étalonnage d'une frame du rush **sur le GPU**, pour le compositeur vidéo.
 *
 * Pourquoi pas `applyLutToPixels` (CPU). Dès qu'un rush vidéo est présent,
 * le compositeur rend en TEMPS RÉEL (le rush apporte sa piste audio) : il
 * reste ~33 ms par frame. Une interpolation trilinéaire en JavaScript sur
 * 1080×1920, c'est 2 millions de pixels à chaque frame — plusieurs centaines
 * de millisecondes. Le montage perdrait l'essentiel de ses frames pendant que
 * l'audio continue : une vidéo saccadée sur une bande-son intacte.
 *
 * Le GPU fait le même travail en quelques millisecondes : la LUT part une
 * fois en texture, chaque frame est un simple rendu de triangle.
 *
 * **Tout échec rend `null`, jamais une exception.** Sans WebGL, sans place
 * pour la texture, ou si une frame ne passe pas (source « tainted », contexte
 * perdu), l'appelant peint le rush BRUT. Une vidéo aux couleurs d'origine est
 * un défaut visible et compréhensible ; un montage qui échoue ou une vidéo
 * hachée passent pour un bug du produit.
 */

export interface LutGrader {
  /**
   * Peint la source étalonnée et rend le canvas qui la porte, aux
   * dimensions demandées. `null` si le GPU a échoué : l'appelant peint alors
   * la source brute. Après un premier échec, l'étalonneur reste hors service
   * pour le reste du montage — un échec par frame noierait la console et
   * ferait alterner frames étalonnées et brutes.
   */
  grade(source: TexImageSource, width: number, height: number): HTMLCanvasElement | null;
  /** Libère textures, programme et contexte WebGL. Idempotent. */
  dispose(): void;
}

export interface GraderDeps {
  createCanvas?: () => HTMLCanvasElement;
}

/**
 * Une LUT 1D est une courbe par canal : elle se déplie EXACTEMENT en cube de
 * même nombre de pas. Au-delà de `MAX_LUT_SIZE` points, le cube ne tiendrait
 * pas en texture : `null`, et le rush reste brut.
 */
export function toCube(lut: Lut): Lut | null {
  if (lut.kind === '3d') return lut.size <= MAX_LUT_SIZE ? lut : null;
  const n = lut.size;
  if (n > MAX_LUT_SIZE) return null;
  const table = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        table[i++] = lut.table[r * 3];
        table[i++] = lut.table[g * 3 + 1];
        table[i++] = lut.table[b * 3 + 2];
      }
    }
  }
  return { ...lut, kind: '3d', table };
}

function toByte(v: number): number {
  const b = Math.round(v * 255);
  // `Uint8Array` ne sature pas : 300 y deviendrait 44. Une LUT qui sort du
  // gamut (fréquent en .cube) doit saturer, pas boucler.
  return b < 0 ? 0 : b > 255 ? 255 : b;
}

/**
 * Met le cube à plat en une bande de tuiles : `size` tuiles de `size × size`,
 * posées côte à côte. La tuile porte le bleu, `x` le rouge, `y` le vert —
 * disposition attendue par le shader.
 */
export function lutToTextureData(cube: Lut): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const n = cube.size;
  const width = n * n;
  const height = n;
  const data = new Uint8Array(width * height * 4);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const src = ((b * n + g) * n + r) * 3;
        const dst = (g * width + (b * n + r)) * 4;
        data[dst] = toByte(cube.table[src]);
        data[dst + 1] = toByte(cube.table[src + 1]);
        data[dst + 2] = toByte(cube.table[src + 2]);
        data[dst + 3] = 255;
      }
    }
  }
  return { data, width, height };
}

/**
 * Passage du domaine d'entrée déclaré par la LUT vers 0→1, par canal, sous
 * la forme `t = (c - min) * inv`. Un domaine vide donne `inv = 0`, donc
 * `t = 0` — même convention que `applyLutToPixels`.
 */
export function domainUniforms(lut: Lut): { min: [number, number, number]; inv: [number, number, number] } {
  const inv = [0, 1, 2].map((ch) => {
    const span = lut.domainMax[ch] - lut.domainMin[ch];
    return span === 0 ? 0 : 1 / span;
  }) as [number, number, number];
  return { min: [...lut.domainMin] as [number, number, number], inv };
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * Le filtrage linéaire du GPU interpole le rouge et le vert dans la tuile ;
 * seul le bleu, qui saute d'une tuile à l'autre, est mélangé à la main. Les
 * demi-pixels de marge évitent qu'un bord de tuile déborde sur sa voisine —
 * sans eux, le rouge saturé prend la teinte du bleu suivant.
 */
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uFrame;
uniform sampler2D uLut;
uniform float uSize;
uniform float uIntensity;
uniform vec3 uDomainMin;
uniform vec3 uDomainInv;

vec3 lookup(vec3 c) {
  float sliceSize = 1.0 / uSize;
  float slicePixel = sliceSize / uSize;
  float sliceInner = slicePixel * (uSize - 1.0);
  float z = c.b * (uSize - 1.0);
  float z0 = floor(z);
  float z1 = min(z0 + 1.0, uSize - 1.0);
  float xOffset = slicePixel * 0.5 + c.r * sliceInner;
  float y = 0.5 / uSize + c.g * ((uSize - 1.0) / uSize);
  vec3 c0 = texture2D(uLut, vec2(z0 * sliceSize + xOffset, y)).rgb;
  vec3 c1 = texture2D(uLut, vec2(z1 * sliceSize + xOffset, y)).rgb;
  return mix(c0, c1, fract(z));
}

void main() {
  vec4 src = texture2D(uFrame, vUv);
  vec3 t = clamp((src.rgb - uDomainMin) * uDomainInv, 0.0, 1.0);
  gl_FragColor = vec4(mix(src.rgb, lookup(t), uIntensity), src.a);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[LUT] Shader refusé :', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function loseContext(gl: WebGLRenderingContext): void {
  // Sans cela chaque montage laisse un contexte WebGL vivant jusqu'au
  // ramasse-miettes, et le navigateur en plafonne le nombre (~16).
  try {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* rien à libérer de plus */
  }
}

/**
 * Crée l'étalonneur, ou `null` quand il n'y a rien à faire (intensité nulle)
 * ou rien de possible (pas de WebGL, LUT trop grande pour le GPU, shader
 * refusé). Dans tous les cas `null`, le rush est peint brut.
 */
export function createLutGrader(
  lut: Lut,
  intensity: number,
  deps: GraderDeps = {},
): LutGrader | null {
  const k = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1;
  // Intensité nulle : le rendu doit être celui du rush brut, au pixel. Passer
  // par le GPU le re-quantifierait pour rien.
  if (k === 0) return null;

  const cube = toCube(lut);
  if (!cube || cube.size < 2) {
    console.warn(`[LUT] LUT ${lut.kind} de ${lut.size} pas non prise en charge au rendu — rush non étalonné.`);
    return null;
  }

  let canvas: HTMLCanvasElement;
  let gl: WebGLRenderingContext | null = null;
  try {
    canvas = (deps.createCanvas ?? (() => document.createElement('canvas')))();
    gl = (canvas.getContext('webgl', { premultipliedAlpha: false }) ||
      canvas.getContext('experimental-webgl', { premultipliedAlpha: false })) as WebGLRenderingContext | null;
  } catch {
    gl = null;
  }
  if (!gl) {
    console.warn('[LUT] WebGL indisponible — le montage sera rendu sans étalonnage.');
    return null;
  }
  const ctx = gl;

  try {
    const { data, width, height } = lutToTextureData(cube);
    const maxTex = ctx.getParameter(ctx.MAX_TEXTURE_SIZE) as number;
    if (!maxTex || width > maxTex) {
      console.warn(`[LUT] Texture ${width}px > limite GPU ${maxTex}px — rush non étalonné.`);
      loseContext(ctx);
      return null;
    }

    const vs = compile(ctx, ctx.VERTEX_SHADER, VERT);
    const fs = compile(ctx, ctx.FRAGMENT_SHADER, FRAG);
    const program = vs && fs ? ctx.createProgram() : null;
    if (!vs || !fs || !program) {
      loseContext(ctx);
      return null;
    }
    ctx.attachShader(program, vs);
    ctx.attachShader(program, fs);
    ctx.linkProgram(program);
    if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
      console.warn('[LUT] Programme refusé :', ctx.getProgramInfoLog(program));
      loseContext(ctx);
      return null;
    }
    ctx.useProgram(program);

    const buffer = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
    // Un seul triangle qui couvre tout le viewport.
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    const aPos = ctx.getAttribLocation(program, 'aPos');
    ctx.enableVertexAttribArray(aPos);
    ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);

    const setParams = () => {
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
      ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
    };

    const lutTex = ctx.createTexture();
    ctx.activeTexture(ctx.TEXTURE1);
    ctx.bindTexture(ctx.TEXTURE_2D, lutTex);
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, width, height, 0, ctx.RGBA, ctx.UNSIGNED_BYTE, data);
    setParams();

    const frameTex = ctx.createTexture();
    ctx.activeTexture(ctx.TEXTURE0);
    ctx.bindTexture(ctx.TEXTURE_2D, frameTex);
    setParams();

    const domain = domainUniforms(cube);
    ctx.uniform1i(ctx.getUniformLocation(program, 'uFrame'), 0);
    ctx.uniform1i(ctx.getUniformLocation(program, 'uLut'), 1);
    ctx.uniform1f(ctx.getUniformLocation(program, 'uSize'), cube.size);
    ctx.uniform1f(ctx.getUniformLocation(program, 'uIntensity'), k);
    ctx.uniform3f(ctx.getUniformLocation(program, 'uDomainMin'), ...domain.min);
    ctx.uniform3f(ctx.getUniformLocation(program, 'uDomainInv'), ...domain.inv);

    let broken = false;
    let disposed = false;

    return {
      grade(source, w, h) {
        if (broken || disposed || !w || !h) return null;
        try {
          if (ctx.isContextLost()) throw new Error('contexte WebGL perdu');
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.viewport(0, 0, w, h);
          ctx.activeTexture(ctx.TEXTURE0);
          ctx.bindTexture(ctx.TEXTURE_2D, frameTex);
          // `UNPACK_FLIP_Y` reste à false : le retournement est fait une fois
          // dans le vertex shader plutôt qu'au téléversement de chaque frame.
          // Une source d'une autre origine sans CORS lève ici (SecurityError).
          ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, source);
          ctx.drawArrays(ctx.TRIANGLES, 0, 3);
          return canvas;
        } catch (err) {
          broken = true;
          console.warn(
            '[LUT] Étalonnage GPU impossible, rush rendu brut pour la suite du montage :',
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        try {
          ctx.deleteTexture(lutTex);
          ctx.deleteTexture(frameTex);
          ctx.deleteBuffer(buffer);
          ctx.deleteProgram(program);
          ctx.deleteShader(vs);
          ctx.deleteShader(fs);
        } catch {
          /* contexte déjà perdu : rien à supprimer */
        }
        loseContext(ctx);
      },
    };
  } catch (err) {
    console.warn('[LUT] Initialisation GPU impossible — rush non étalonné :', err instanceof Error ? err.message : err);
    loseContext(ctx);
    return null;
  }
}
