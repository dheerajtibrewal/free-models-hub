import type { Capability } from '../registry';
import type { NormalizedError, ProviderAdapter, StepInput, StepOutput } from '../router/types';
import { RouterError } from '../router/types';
import { base64ToBytes, bytesToBase64, dataUrl, httpBinary, httpJson, transportToError } from './http';

const BASE = 'https://api.groq.com/openai/v1';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface TranscriptionResponse {
  text?: string;
  duration?: number;
}

function key(): string | undefined {
  return process.env.GROQ_API_KEY;
}

export const groqAdapter: ProviderAdapter = {
  id: 'groq',

  isConfigured() {
    return Boolean(key());
  },

  async invoke(cap: Capability, input: StepInput, signal: AbortSignal): Promise<StepOutput> {
    const apiKey = key();
    if (!apiKey) {
      throw new RouterError({ kind: 'auth', retryable: true, message: 'GROQ_API_KEY is not set' });
    }
    const auth = { Authorization: `Bearer ${apiKey}` };

    if (cap.skills.includes('transcribe') && input.payload.modality === 'audio') {
      if ('onDevice' in input.payload) {
        throw new RouterError({
          kind: 'bad_input',
          retryable: false,
          message: 'cannot transcribe an on-device audio marker',
        });
      }
      const form = new FormData();
      form.append(
        'file',
        new Blob([base64ToBytes(input.payload.base64)], { type: input.payload.mimeType }),
        'audio.webm',
      );
      form.append('model', cap.modelId);
      form.append('response_format', 'verbose_json');

      const res = await httpJson<TranscriptionResponse>(
        `${BASE}/audio/transcriptions`,
        { method: 'POST', headers: auth, body: form },
        signal,
      );

      return {
        payload: { modality: 'text', text: (res.text ?? '').trim() },
        usage: { audioSeconds: res.duration ?? input.payload.durationSec },
      };
    }

    if (cap.skills.includes('tts')) {
      if (input.payload.modality !== 'text') {
        throw new RouterError({
          kind: 'bad_input',
          retryable: false,
          message: 'TTS needs text input',
        });
      }
      const { bytes, mimeType } = await httpBinary(
        `${BASE}/audio/speech`,
        {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cap.modelId,
            input: input.payload.text.slice(0, 4000),
            // Orpheus accepts only: autumn diana hannah austin daniel troy
            voice: process.env.GROQ_TTS_VOICE ?? 'diana',
            response_format: 'wav',
          }),
        },
        signal,
      );
      return {
        payload: {
          modality: 'audio',
          base64: bytesToBase64(bytes),
          mimeType: mimeType.startsWith('audio/') ? mimeType : 'audio/wav',
        },
      };
    }

    // chat + vision share the completions endpoint; only the content shape differs.
    const messages: unknown[] = [];
    if (input.systemPrompt) {
      messages.push({ role: 'system', content: input.systemPrompt });
    }

    if (input.payload.modality === 'image') {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: input.instruction?.trim() || 'Describe this image.' },
          {
            type: 'image_url',
            image_url: { url: dataUrl(input.payload.base64, input.payload.mimeType) },
          },
        ],
      });
    } else if (input.payload.modality === 'text') {
      messages.push({ role: 'user', content: input.payload.text });
    } else {
      throw new RouterError({
        kind: 'bad_input',
        retryable: false,
        message: `groq chat cannot accept ${input.payload.modality}`,
      });
    }

    const res = await httpJson<ChatResponse>(
      `${BASE}/chat/completions`,
      {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cap.modelId,
          messages,
          temperature: 0.7,
          // Never request more than the model's per-minute output budget:
          // Groq rejects the call outright if max_tokens alone exceeds OTPM.
          max_tokens: cap.maxOutputTokens ?? 1024,
        }),
      },
      signal,
    );

    const text = res.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      throw new RouterError({
        kind: 'unavailable',
        retryable: true,
        message: 'groq returned an empty completion',
      });
    }

    return {
      payload: { modality: 'text', text },
      usage: {
        inputTokens: res.usage?.prompt_tokens,
        outputTokens: res.usage?.completion_tokens,
      },
    };
  },

  normalizeError(error: unknown): NormalizedError {
    return transportToError(error);
  },
};
