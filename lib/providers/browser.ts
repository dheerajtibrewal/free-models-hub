import type { Capability } from '../registry';
import type { NormalizedError, ProviderAdapter, StepInput, StepOutput } from '../router/types';
import { RouterError } from '../router/types';
import { transportToError } from './http';

/**
 * The on-device voice route.
 *
 * Nothing is called here: the server hands the text back with a marker and the
 * visitor's own browser speaks it via the Web Speech API. That makes this the
 * one route that can never rate-limit and never costs quota -- which is exactly
 * why it sits last in priority as the guaranteed floor under hosted TTS.
 */
export const browserAdapter: ProviderAdapter = {
  id: 'browser',

  isConfigured() {
    return true;
  },

  async invoke(_cap: Capability, input: StepInput): Promise<StepOutput> {
    if (input.payload.modality !== 'text') {
      throw new RouterError({
        kind: 'bad_input',
        retryable: false,
        message: 'the on-device voice needs text input',
      });
    }
    return {
      payload: { modality: 'audio', onDevice: true, text: input.payload.text },
    };
  },

  normalizeError(error: unknown): NormalizedError {
    return transportToError(error);
  },
};
