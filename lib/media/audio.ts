import { blobToBase64 } from './image';

/**
 * Client-side audio normalization.
 *
 * Two constraints collide here and drive the whole design:
 *  - Vercel caps the request body at 4.5MB;
 *  - Groq's free Whisper budget is 28,800 audio-seconds/day.
 * Both are served by capping duration at 120s and shipping the smallest
 * representation that keeps transcription accurate.
 *
 * Already-compressed uploads (mp3/m4a/ogg/webm/flac) pass through untouched --
 * Whisper accepts them directly, and re-encoding would only lose quality. Only
 * WAV and oversized files get decoded and downsampled, because an uncompressed
 * 120s WAV at 16kHz is ~3.8MB of bytes (~5.1MB as base64) and would blow the
 * body cap outright.
 */

export const MAX_DURATION_SEC = 120;
/** Bytes, before base64 inflation (~4/3). */
const BYTE_BUDGET = 2_000_000;
/** Preferred first, each a sample rate Whisper handles acceptably. */
const SAMPLE_RATE_LADDER = [16_000, 12_000, 8_000];

const PASSTHROUGH = /^audio\/(mpeg|mp3|mp4|m4a|aac|ogg|opus|webm|flac|x-m4a)$/;

export interface NormalizedAudio {
  base64: string;
  mimeType: string;
  durationSec: number;
  bytes: number;
  /** True when we re-encoded rather than passing the original through. */
  transcoded: boolean;
  sampleRate?: number;
  previewUrl: string;
}

export async function normalizeAudio(file: Blob, filename = 'audio'): Promise<NormalizedAudio> {
  const type = file.type || guessType(filename);
  const durationSec = await probeDuration(file);

  if (durationSec > MAX_DURATION_SEC + 0.5) {
    throw new Error(
      `That recording is ${Math.round(durationSec)}s. Please trim it to ${MAX_DURATION_SEC}s or less.`,
    );
  }

  if (PASSTHROUGH.test(type) && file.size <= BYTE_BUDGET) {
    return {
      base64: await blobToBase64(file),
      mimeType: type,
      durationSec,
      bytes: file.size,
      transcoded: false,
      previewUrl: URL.createObjectURL(file),
    };
  }

  // WAV, or a compressed file too large to pass through: decode and downsample.
  const decoded = await decode(file);
  const duration = Math.min(decoded.duration, MAX_DURATION_SEC);

  for (const rate of SAMPLE_RATE_LADDER) {
    // 16-bit mono => 2 bytes per frame, plus a 44-byte header.
    const projected = Math.ceil(duration * rate) * 2 + 44;
    if (projected <= BYTE_BUDGET) {
      const wav = encodeWav(await resampleMono(decoded, rate, duration), rate);
      return {
        base64: await blobToBase64(wav),
        mimeType: 'audio/wav',
        durationSec: duration,
        bytes: wav.size,
        transcoded: true,
        sampleRate: rate,
        previewUrl: URL.createObjectURL(wav),
      };
    }
  }

  throw new Error('That audio is too long to send. Try a shorter clip.');
}

/* ------------------------------------------------------------------ recording */

export interface Recorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
  mimeType: string;
}

/**
 * Records via MediaRecorder, which gives us Opus in a WebM container at roughly
 * 24-32kbps -- about 480KB for a full two minutes. This is why recording is the
 * cheap path and file upload is the one that may need transcoding.
 */
export async function startRecording(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot record audio. Upload a file instead.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const mimeType = pickRecordingMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve(new Blob(chunks, { type: 'audio/webm' }));
      }),
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

function pickRecordingMime(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return undefined;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

/* -------------------------------------------------------------------- helpers */

type AudioCtor = typeof AudioContext;

function audioContext(sampleRate?: number): AudioContext {
  const Ctor: AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
  return sampleRate ? new Ctor({ sampleRate }) : new Ctor();
}

async function decode(file: Blob): Promise<AudioBuffer> {
  const ctx = audioContext();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('Could not read that audio file.');
  } finally {
    void ctx.close();
  }
}

/** Duration without a full decode where the browser can manage it. */
async function probeDuration(file: Blob): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.src = url;
    const duration = await new Promise<number>((resolve) => {
      const done = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.onloadedmetadata = done;
      el.onerror = () => resolve(0);
      setTimeout(done, 4000);
    });
    if (duration > 0) return duration;
  } finally {
    URL.revokeObjectURL(url);
  }
  // Metadata-less WebM from MediaRecorder lands here; a decode is the fallback.
  return (await decode(file)).duration;
}

/** Mix to mono and resample using an OfflineAudioContext. */
async function resampleMono(
  buffer: AudioBuffer,
  targetRate: number,
  durationSec: number,
): Promise<Float32Array> {
  const frames = Math.ceil(durationSec * targetRate);
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Minimal 16-bit PCM WAV writer. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function guessType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
  };
  return map[ext] ?? 'application/octet-stream';
}

/* ----------------------------------------------------- on-device speech output */

/**
 * The guaranteed floor under hosted TTS.
 *
 * Runs entirely in the visitor's browser, so it costs no quota and cannot rate
 * limit. X-Ray labels it as an on-device route rather than presenting it as a
 * hosted model.
 */
export function speakOnDevice(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      reject(new Error('This browser has no built-in voice.'));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('The device voice could not speak this text.'));
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
