/**
 * Edge TTS Client-Side WebSocket Implementation
 * Connects to Microsoft Edge TTS service via WebSocket for speech synthesis.
 * Works entirely in the browser — no server needed.
 */

export interface TtsVoice {
  id: string;
  name: string;
  lang: string;
  gender: 'Female' | 'Male';
  flag: string;
}

export const TTS_VOICES: TtsVoice[] = [
  // Francais
  { id: 'fr-FR-DeniseNeural', name: 'Denise', lang: 'FR', gender: 'Female', flag: '🇫🇷' },
  { id: 'fr-FR-HenriNeural', name: 'Henri', lang: 'FR', gender: 'Male', flag: '🇫🇷' },
  { id: 'fr-FR-CoralieMultilingualNeural', name: 'Coralie', lang: 'FR', gender: 'Female', flag: '🇫🇷' },
  { id: 'fr-FR-VivienneMultilingualNeural', name: 'Vivienne', lang: 'FR', gender: 'Female', flag: '🇫🇷' },
  // English
  { id: 'en-US-AriaNeural', name: 'Aria', lang: 'EN', gender: 'Female', flag: '🇺🇸' },
  { id: 'en-US-GuyNeural', name: 'Guy', lang: 'EN', gender: 'Male', flag: '🇺🇸' },
  { id: 'en-US-JennyNeural', name: 'Jenny', lang: 'EN', gender: 'Female', flag: '🇺🇸' },
  { id: 'en-US-DavisNeural', name: 'Davis', lang: 'EN', gender: 'Male', flag: '🇺🇸' },
  // Espanol
  { id: 'es-ES-ElviraNeural', name: 'Elvira', lang: 'ES', gender: 'Female', flag: '🇪🇸' },
  { id: 'es-ES-AlvaroNeural', name: 'Alvaro', lang: 'ES', gender: 'Male', flag: '🇪🇸' },
  // Portugais
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca', lang: 'PT', gender: 'Female', flag: '🇧🇷' },
  { id: 'pt-BR-AntonioNeural', name: 'Antonio', lang: 'PT', gender: 'Male', flag: '🇧🇷' },
  // Allemand
  { id: 'de-DE-KatjaNeural', name: 'Katja', lang: 'DE', gender: 'Female', flag: '🇩🇪' },
  { id: 'de-DE-ConradNeural', name: 'Conrad', lang: 'DE', gender: 'Male', flag: '🇩🇪' },
];

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=`;

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function buildSsml(text: string, voice: string, rate: string = '+0%', pitch: string = '+0Hz'): string {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
    <voice name='${voice}'>
      <prosody pitch='${pitch}' rate='${rate}' volume='+0%'>
        ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </prosody>
    </voice>
  </speak>`;
}

function buildHeaders(requestId: string): string {
  return `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:ssml`;
}

/**
 * Synthesize text to speech using Edge TTS WebSocket.
 * Returns an audio Blob (MP3).
 */
export async function synthesize(
  text: string,
  voiceId: string,
  options?: { rate?: string; pitch?: string },
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const connectionId = generateId();
    const requestId = generateId();
    const ws = new WebSocket(`${WSS_URL}${connectionId}`);
    const audioChunks: ArrayBuffer[] = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('TTS timeout (30s)'));
      }
    }, 30000);

    ws.onopen = () => {
      // Send config
      ws.send(
        `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-96kbitrate-mono-mp3"}}}}`
      );

      // Send SSML
      const ssml = buildSsml(text, voiceId, options?.rate, options?.pitch);
      ws.send(`${buildHeaders(requestId)}\r\n\r\n${ssml}`);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        // Binary message = audio data
        event.data.arrayBuffer().then((buffer) => {
          // Find the separator "Path:audio\r\n\r\n" in the binary data
          const view = new Uint8Array(buffer);
          const separator = 'Path:audio\r\n';
          let headerEnd = -1;
          for (let i = 0; i < Math.min(view.length, 500); i++) {
            if (view[i] === 0x50 && view[i + 1] === 0x61 && view[i + 2] === 0x74 && view[i + 3] === 0x68) {
              // Found "Path"
              for (let j = i; j < Math.min(view.length, i + 50); j++) {
                if (view[j] === 0x0d && view[j + 1] === 0x0a && view[j + 2] === 0x0d && view[j + 3] === 0x0a) {
                  headerEnd = j + 4;
                  break;
                }
                if (view[j] === 0x0a && view[j + 1] === 0x0a) {
                  headerEnd = j + 2;
                  break;
                }
              }
              break;
            }
          }

          if (headerEnd > 0 && headerEnd < view.length) {
            audioChunks.push(buffer.slice(headerEnd));
          }
        });
      } else if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          // End of audio
          clearTimeout(timeout);
          resolved = true;
          ws.close();
          const blob = new Blob(audioChunks, { type: 'audio/mpeg' });
          resolve(blob);
        }
      }
    };

    ws.onerror = (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        reject(new Error('Erreur de connexion au service TTS'));
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        if (audioChunks.length > 0) {
          resolve(new Blob(audioChunks, { type: 'audio/mpeg' }));
        } else {
          reject(new Error('Connexion TTS fermee sans audio'));
        }
      }
    };
  });
}

/**
 * Preview a voice with a short sample text.
 * Returns an audio URL that can be played.
 */
export async function previewVoice(voiceId: string): Promise<string> {
  const voice = TTS_VOICES.find((v) => v.id === voiceId);
  const sampleTexts: Record<string, string> = {
    FR: 'Bonjour, bienvenue sur Studiio, la plateforme de creation video.',
    EN: 'Hello, welcome to Studiio, the video creation platform.',
    ES: 'Hola, bienvenido a Studiio, la plataforma de creacion de video.',
    PT: 'Ola, bem-vindo ao Studiio, a plataforma de criacao de video.',
    DE: 'Hallo, willkommen bei Studiio, der Plattform fur Videoproduktion.',
  };

  const sampleText = sampleTexts[voice?.lang || 'FR'] || sampleTexts.FR;
  const blob = await synthesize(sampleText, voiceId);
  return URL.createObjectURL(blob);
}
