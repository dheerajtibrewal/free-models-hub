import type { Capability } from '../registry';
import type { NormalizedError, ProviderAdapter, StepInput, StepOutput } from '../router/types';
import { RouterError } from '../router/types';
import { base64ToBytes, bytesToBase64, redact, statusToError, transportToError } from './http';

/**
 * Workers AI returns three different response shapes depending on the model
 * family: JSON-wrapped text, JSON-wrapped base64 (FLUX), and raw binary (SDXL,
 * MeloTTS). The adapter sniffs the content-type rather than hardcoding which
 * model does which, so a model swap in the registry does not break here.
 */
interface CfEnvelope<T> {
  result?: T;
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
}

function creds(): { accountId?: string; token?: string } {
  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  };
}

export const cloudflareAdapter: ProviderAdapter = {
  id: 'cloudflare',

  isConfigured() {
    const { accountId, token } = creds();
    return Boolean(accountId && token);
  },

  async invoke(cap: Capability, input: StepInput, signal: AbortSignal): Promise<StepOutput> {
    const { accountId, token } = creds();
    if (!accountId || !token) {
      throw new RouterError({
        kind: 'auth',
        retryable: true,
        message: 'CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not set',
      });
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cap.modelId}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const body = buildBody(cap, input);

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 400);
      } catch {
        /* empty body */
      }
      throw new RouterError(statusToError(res.status, detail));
    }

    const contentType = res.headers.get('content-type') ?? '';

    // Raw binary: SDXL images and MeloTTS audio come back unwrapped.
    if (!contentType.includes('application/json')) {
      const bytes = await res.arrayBuffer();
      const base64 = bytesToBase64(bytes);
      if (cap.emits === 'image') {
        return {
          payload: { modality: 'image', base64, mimeType: contentType || 'image/png' },
          usage: { neurons: cap.quota.neuronsPerCall },
        };
      }
      return {
        payload: { modality: 'audio', base64, mimeType: contentType || 'audio/mpeg' },
        usage: { neurons: cap.quota.neuronsPerCall },
      };
    }

    const json = (await res.json()) as CfEnvelope<Record<string, unknown>>;
    if (json.success === false) {
      const msg = redact(
        json.errors?.map((e) => e.message).join('; ') || 'cloudflare reported failure',
      );
      throw new RouterError({ kind: 'unavailable', retryable: true, message: msg });
    }

    const result = json.result ?? {};

    if (cap.emits === 'image') {
      const image = typeof result.image === 'string' ? result.image : undefined;
      if (!image) {
        throw new RouterError({
          kind: 'unavailable',
          retryable: true,
          message: 'cloudflare returned no image',
        });
      }
      return {
        payload: { modality: 'image', base64: image, mimeType: 'image/jpeg' },
        usage: { neurons: cap.quota.neuronsPerCall },
      };
    }

    if (cap.emits === 'audio') {
      const audio = typeof result.audio === 'string' ? result.audio : undefined;
      if (!audio) {
        throw new RouterError({
          kind: 'unavailable',
          retryable: true,
          message: 'cloudflare returned no audio',
        });
      }
      return {
        payload: { modality: 'audio', base64: audio, mimeType: 'audio/mpeg' },
        usage: { neurons: cap.quota.neuronsPerCall },
      };
    }

    const text =
      typeof result.response === 'string'
        ? result.response
        : typeof result.text === 'string'
          ? result.text
          : '';
    if (!text.trim()) {
      throw new RouterError({
        kind: 'unavailable',
        retryable: true,
        message: 'cloudflare returned an empty response',
      });
    }

    return {
      payload: { modality: 'text', text: text.trim() },
      usage: { neurons: cap.quota.neuronsPerCall },
    };
  },

  normalizeError(error: unknown): NormalizedError {
    return transportToError(error);
  },
};

function buildBody(cap: Capability, input: StepInput): Record<string, unknown> {
  if (cap.skills.includes('transcribe')) {
    if (input.payload.modality !== 'audio' || 'onDevice' in input.payload) {
      throw new RouterError({
        kind: 'bad_input',
        retryable: false,
        message: 'transcription needs hosted audio bytes',
      });
    }
    // Workers AI Whisper takes the audio as an array of byte values.
    return { audio: Array.from(base64ToBytes(input.payload.base64)) };
  }

  if (cap.skills.includes('image-gen')) {
    if (input.payload.modality !== 'text') {
      throw new RouterError({
        kind: 'bad_input',
        retryable: false,
        message: 'image generation needs a text prompt',
      });
    }
    return { prompt: input.payload.text.slice(0, 2000), ...cap.providerParams };
  }

  if (cap.skills.includes('tts')) {
    if (input.payload.modality !== 'text') {
      throw new RouterError({ kind: 'bad_input', retryable: false, message: 'TTS needs text' });
    }
    return { prompt: input.payload.text.slice(0, 4000), lang: 'en', ...cap.providerParams };
  }

  // vision / chat
  if (input.payload.modality === 'image') {
    return {
      prompt: input.instruction?.trim() || 'Describe this image.',
      ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
      image: Array.from(base64ToBytes(input.payload.base64)),
      max_tokens: cap.maxOutputTokens ?? 1024,
    };
  }

  if (input.payload.modality !== 'text') {
    throw new RouterError({
      kind: 'bad_input',
      retryable: false,
      message: `cloudflare chat cannot accept ${input.payload.modality}`,
    });
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
  messages.push({ role: 'user', content: input.payload.text });
  return { messages, max_tokens: cap.maxOutputTokens ?? 1024 };
}
