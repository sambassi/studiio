import type { Lut } from './types';

/**
 * Étalonnage d'une frame **sur le GPU**.
 *
 * Pourquoi pas le CPU. Le Mode simple rend en TEMPS RÉEL dès qu'un rush est
 * présent (`video-composer.ts` : `useFastMode = !hasAudio`, et un rush apporte
 * sa piste audio). Il reste donc ~33 ms par frame. Une interpolation
 * trilinéaire en JavaScript sur 1080×1920, c'est 2,07 millions de pixels et
 * une cinquantaine d'opérations chacun : plusieurs centaines de millisecondes.
 * Le montage ne serait pas « un peu lent », il perdrait la grande majorité de
 * ses frames — l'audio, lui, continue en temps réel, donc le résultat est une
 * vidéo saccadée sur une bande-son intacte.
 *
 * Le GPU fait le même travail en quelques millisecondes : la LUT part une
 * fois en texture, et chaque frame est un simple rendu de quad.
 *
 * **Sans WebGL, on rend NON étalonné.** Se rabattre sur le CPU produirait
 * exactement la vidéo saccadée qu'on cherche à éviter. Une vidéo aux couleurs
 * d'origine est un défaut visible et compréhensible ; une vidéo hachée passe
 * pour un bug du produit.
 */

export interface LutGrader {
  /** Peint la source étalonnée et rend le canvas qui la porte. */
  grade(source: TexImageSource, width: number, height: number): HTMLCanvasElement;
  setIntensity(intensity: number): void;
  dispose(): void;
}

export interface GraderDeps {
  createCanvas?: () => HTMLCanvasElement;
}

/** Une LUT 1D est une courbe par canal : elle se déplie exactement en cube. */
export function toCube(lut: Lut): Lut {
  if (lut.kind === '3d') return lut;
  const n = lut.size;
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

/**
 * Met le cube à plat en une bande de tuiles : `size` tuiles de `size × size`,
 * posées côte à côte. La tuile porte le bleu, `x` le rouge, `y` le vert —
 * disposition attendue par le shader.
 */
export function lutToTextureData(lut: Lut): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const cube = toCube(lut);
  const n = cube.size;
  const width = n * n;
  const height = n;
  const data = new Uint8Array(width * height * 4);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const src = ((b * n + g) * n + r) * 3;
        const dst = (g * width + (b * n + r)) * 4;
        data[dst] = Math.round(cube.table[src] * 255);
        data[dst + 1] = Math.round(cube.table[src + 1] * 255);
        data[dst + 2] = Math.round(cube.table[src + 2] * 255);
        data[dst + 3] = 255;
      }
    }
  }
  return { data, width, height };
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
  gl_FragColor = vec4(mix(src.rgb, lookup(clamp(src.rgb, 0.0, 1.0)), uIntensity), src.a);
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

export function createLutGrader(
  lut: Lut,
  intensity: number,
  deps: GraderDeps = {},
): LutGrader | null {
  const canvas = (deps.createCanvas ?? (() => document.createElement('canvas')))();
  const gl = (canvas.getContext('webgl', { premultipliedAlpha: false }) ||
    canvas.getContext('experimental-webgl', {
      premultipliedAlpha: false,
    })) as WebGLRenderingContext | null;
  if (!gl) {
    console.warn('[LUT] WebGL indisponible — le montage sera rendu sans étalonnage.');
    return null;
  }

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[LUT] Programme refusé :', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const cube = toCube(lut);
  const { data, width, height } = lutToTextureData(cube);
  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const frameTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, frameTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.uniform1i(gl.getUniformLocation(program, 'uFrame'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uLut'), 1);
  gl.uniform1f(gl.getUniformLocation(program, 'uSize'), cube.size);
  const uIntensity = gl.getUniformLocation(program, 'uIntensity');
  gl.uniform1f(uIntensity, intensity);

  return {
    grade(source, w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frameTex);
      // `UNPACK_FLIP_Y` est laissé a false : le retournement est fait dans le
      // vertex shader, une seule fois, plutot qu'au televersement de chaque
      // frame.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return canvas;
    },
    setIntensity(next) {
      gl.useProgram(program);
      gl.uniform1f(uIntensity, next);
    },
    dispose() {
      gl.deleteTexture(lutTex);
      gl.deleteTexture(frameTex);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
