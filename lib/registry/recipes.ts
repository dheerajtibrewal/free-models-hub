import type { Modality, Skill } from './types';

/** Canonical task key, e.g. 'audio->image'. */
export type TaskPair = `${Modality}->${Modality}`;

export interface RecipeStep {
  /** What this step must be able to do -- NOT which model does it. */
  skill: Skill;
  from: Modality;
  to: Modality;
  /** Short label for the X-Ray timeline. */
  title: string;
  /** Injected for 'chat' steps that transform rather than answer. */
  systemPrompt?: string;
  /**
   * True when the step exists to improve quality rather than to bridge a
   * modality gap. If every candidate is exhausted, the executor may skip an
   * optional step and pass its input through instead of failing the task.
   */
  optional?: boolean;
}

export interface Recipe {
  pair: TaskPair;
  slug: string;
  title: string;
  blurb: string;
  /** Verb shown on the run button. */
  action: string;
  steps: RecipeStep[];
}

const PROMPT_FROM_SPEECH = `You turn spoken descriptions into image-generation prompts.
The user described an image out loud, so the transcript is messy: filler words, false starts, self-corrections. Recover their actual intent.
Reply with ONLY the final prompt: one vivid paragraph naming subject, setting, composition, lighting and style. No preamble, no quotes, no options.`;

const PROMPT_FROM_TEXT = `You rewrite a rough idea into an image-generation prompt.
Reply with ONLY the final prompt: one vivid paragraph naming subject, setting, composition, lighting and style. Keep every concrete detail the user gave. No preamble, no quotes.`;

const DESCRIBE_FOR_SPEECH = `You describe an image for someone who cannot see it, to be read aloud.
Write 3-5 flowing sentences in plain spoken language. Lead with the subject, then setting, then notable detail and mood.
No markdown, no lists, no headings -- this text goes straight to a speech synthesiser.`;

// Deliberately caps its own length: Groq allows only 1,000 output tokens per
// minute, so a rambling "thorough description" can consume a whole minute's
// budget in one call -- and it opened with filler like "Based on the visual
// evidence provided, here is a thorough description:" anyway.
const OCR_AND_DESCRIBE = `Describe this image.

Lead with the subject, then setting and notable detail. If the image contains text, transcribe it accurately and keep its structure.
Start immediately with the description -- no preamble, no "this image shows", no headings. Keep it under 150 words unless transcribing text.`;

/**
 * Pipeline recipes, one per modality pair.
 *
 * Why recipes and not a graph search over the registry: BFS optimises for
 * reachability, not quality. For audio->image it would find the two-step
 * audio->text->image path and feed a raw transcript ("uh so like, a cat with a
 * crown, make it cinematic") straight into FLUX. The good route needs a third
 * step that rewrites spoken intent into a clean prompt -- intent that cannot be
 * derived from modality edges. With seven pairs, an explicit table is also far
 * easier to tune.
 */
export const RECIPES: Recipe[] = [
  {
    pair: 'text->text',
    slug: 'text-to-text',
    title: 'Text to Text',
    blurb: 'Ask, rewrite, summarise or extract. Routed to the fastest healthy free LLM.',
    action: 'Generate',
    steps: [{ skill: 'chat', from: 'text', to: 'text', title: 'Language model' }],
  },
  {
    pair: 'image->text',
    slug: 'image-to-text',
    title: 'Image to Text',
    blurb: 'Describe an image, read the text inside it, or pull out structured detail.',
    action: 'Describe',
    steps: [
      {
        skill: 'vision',
        from: 'image',
        to: 'text',
        title: 'Vision model',
        systemPrompt: OCR_AND_DESCRIBE,
      },
    ],
  },
  {
    pair: 'audio->text',
    slug: 'audio-to-text',
    title: 'Audio to Text',
    blurb: 'Transcribe speech from a recording or a file, up to two minutes.',
    action: 'Transcribe',
    steps: [{ skill: 'transcribe', from: 'audio', to: 'text', title: 'Speech recognition' }],
  },
  {
    pair: 'text->image',
    slug: 'text-to-image',
    title: 'Text to Image',
    blurb: 'Generate an image. Your idea is sharpened into a full prompt first.',
    action: 'Generate',
    steps: [
      {
        skill: 'chat',
        from: 'text',
        to: 'text',
        title: 'Prompt enrichment',
        systemPrompt: PROMPT_FROM_TEXT,
        optional: true,
      },
      { skill: 'image-gen', from: 'text', to: 'image', title: 'Image generation' },
    ],
  },
  {
    pair: 'text->audio',
    slug: 'text-to-audio',
    title: 'Text to Audio',
    blurb: 'Read text aloud. Falls back to your device voice if hosted TTS is spent.',
    action: 'Speak',
    steps: [{ skill: 'tts', from: 'text', to: 'audio', title: 'Speech synthesis' }],
  },
  {
    pair: 'audio->image',
    slug: 'audio-to-image',
    title: 'Audio to Image',
    blurb: 'Describe a picture out loud and get it drawn. Three models, one click.',
    action: 'Visualise',
    steps: [
      { skill: 'transcribe', from: 'audio', to: 'text', title: 'Speech recognition' },
      {
        skill: 'chat',
        from: 'text',
        to: 'text',
        title: 'Intent to prompt',
        systemPrompt: PROMPT_FROM_SPEECH,
      },
      { skill: 'image-gen', from: 'text', to: 'image', title: 'Image generation' },
    ],
  },
  {
    pair: 'image->audio',
    slug: 'image-to-audio',
    title: 'Image to Audio',
    blurb: 'Hear an image described aloud. Useful as an accessibility aid.',
    action: 'Narrate',
    steps: [
      {
        skill: 'vision',
        from: 'image',
        to: 'text',
        title: 'Vision model',
        systemPrompt: DESCRIBE_FOR_SPEECH,
      },
      { skill: 'tts', from: 'text', to: 'audio', title: 'Speech synthesis' },
    ],
  },
];

const BY_SLUG = new Map(RECIPES.map((r) => [r.slug, r]));
const BY_PAIR = new Map(RECIPES.map((r) => [r.pair, r]));

export function recipeBySlug(slug: string): Recipe | undefined {
  return BY_SLUG.get(slug);
}

export function recipeByPair(pair: TaskPair): Recipe | undefined {
  return BY_PAIR.get(pair);
}

export function pairOf(from: Modality, to: Modality): TaskPair {
  return `${from}->${to}`;
}
