import type { ProviderId } from '../registry';
import type { ProviderAdapter } from '../router/types';
import { browserAdapter } from './browser';
import { cloudflareAdapter } from './cloudflare';
import { groqAdapter } from './groq';
import { openrouterAdapter } from './openrouter';

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  groq: groqAdapter,
  cloudflare: cloudflareAdapter,
  openrouter: openrouterAdapter,
  browser: browserAdapter,
};

export function adapterFor(provider: ProviderId): ProviderAdapter {
  return ADAPTERS[provider];
}

export function configuredProviders(): ProviderId[] {
  return (Object.keys(ADAPTERS) as ProviderId[]).filter((p) => ADAPTERS[p].isConfigured());
}

export { browserAdapter, cloudflareAdapter, groqAdapter, openrouterAdapter };
