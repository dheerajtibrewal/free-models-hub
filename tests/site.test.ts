import { afterEach, describe, expect, it } from 'vitest';
import { siteUrl } from '@/lib/site';

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL'] as const;
afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe('siteUrl', () => {
  // The regression: a variable defined in the Vercel dashboard but left blank
  // arrives as '', which `?? fallback` does NOT catch. new URL('') then threw
  // and failed the entire production build.
  it('survives an env var that is defined but empty', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '';
    expect(() => new URL(siteUrl())).not.toThrow();
    expect(siteUrl()).toBe('http://localhost:3000');
  });

  it('survives a whitespace-only value', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '   ';
    expect(() => new URL(siteUrl())).not.toThrow();
  });

  it('survives a malformed value rather than failing the build', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'ht!tp://not a url';
    expect(() => new URL(siteUrl())).not.toThrow();
  });

  it('uses an explicit URL when it is valid', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://free-llm.example.com';
    expect(siteUrl()).toBe('https://free-llm.example.com');
  });

  it('accepts a bare hostname and a trailing slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'free-llm.example.com/';
    expect(siteUrl()).toBe('https://free-llm.example.com');
  });

  it("falls back to Vercel's own URL so a fresh import needs no config", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'free-models-hub.vercel.app';
    expect(siteUrl()).toBe('https://free-models-hub.vercel.app');
  });

  it('prefers the production domain over the per-deployment URL', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.vercel.app';
    process.env.VERCEL_URL = 'preview-abc123.vercel.app';
    expect(siteUrl()).toBe('https://prod.vercel.app');
  });

  it('always returns something new URL() accepts', () => {
    for (const v of ['', ' ', '://', 'https://', 'x']) {
      process.env.NEXT_PUBLIC_SITE_URL = v;
      expect(() => new URL(siteUrl())).not.toThrow();
    }
  });
});
