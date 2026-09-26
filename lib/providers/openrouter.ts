import type { Capability } from '../registry';
import type { NormalizedError, ProviderAdapter, StepInput, StepOutput } from '../router/types';
import { RouterError } from '../router/types';
import { siteUrl } from '../site';
import { dataUrl, httpJson, redact, transportToError } from './http';

/**
 * Last-resort text/vision fallback.
 *
 * OpenRouter's :free endpoints allow only 50 requests/DAY under $10 lifetime
 * credit, so every capability here carries priority 90 in the registry. It
 * exists to keep the site answering when Groq's daily pool is gone, not to
 * carry traffic.
 */
const BASE = 'https://openrouter.ai/api/v1';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',

  isConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY);
  },

  async invoke(cap: Capability, input: StepInput, signal: AbortSignal): Promise<StepOutput> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new RouterError({
        kind: 'auth',
        retryable: true,
        message: 'OPENROUTER_API_KEY is not set',
      });
    }

    const messages: unknown[] = [];
    if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });

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
        message: `openrouter cannot accept ${input.payload.modality}`,
      });
    }

    const res = await httpJson<ChatResponse>(
      `${BASE}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // OpenRouter attributes free-tier traffic by these headers.
          'HTTP-Referer': siteUrl(),
          'X-Title': 'Free LLM',
        },
        body: JSON.stringify({ model: cap.modelId, messages, max_tokens: cap.maxOutputTokens ?? 1024 }),
      },
      signal,
    );

    if (res.error?.message) {
      throw new RouterError({
        kind: 'unavailable',
        retryable: true,
        message: redact(res.error.message),
      });
    }

    const text = res.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      throw new RouterError({
        kind: 'unavailable',
        retryable: true,
        message: 'openrouter returned an empty completion',
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
