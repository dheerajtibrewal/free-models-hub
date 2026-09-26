import { NextRequest } from 'next/server';
import { recipeBySlug } from '@/lib/registry';
import { execute, plan, planPreview, runRequestSchema } from '@/lib/router';
import { RouterError, type NormalizedError, type RunEvent } from '@/lib/router/types';
import { hashVisitor, snapshot, visitorAllowed } from '@/lib/quota';

export const runtime = 'nodejs';
/**
 * Vercel Hobby's ceiling. A three-step audio->image pipeline lands around
 * 5-12s, so this is headroom rather than a target.
 */
export const maxDuration = 60;

/**
 * The single execution endpoint, streamed as SSE.
 *
 * Streaming is not a nicety here -- it solves three problems at once:
 *  1. live per-step progress on a pipeline that can take 10+ seconds;
 *  2. escape from Vercel's 4.5MB *response* cap, which a 1024px base64 image
 *     would otherwise brush against;
 *  3. a natural channel for X-Ray events as they happen rather than after.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const visitorId = hashVisitor(clientIp(req));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorStream({ kind: 'bad_input', retryable: false, message: 'Malformed request body.' });
  }

  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorStream({
      kind: 'bad_input',
      retryable: false,
      message: first?.message ?? 'Invalid request.',
    });
  }

  const recipe = recipeBySlug(parsed.data.task);
  if (!recipe) {
    return errorStream({
      kind: 'bad_input',
      retryable: false,
      message: `Unknown task "${parsed.data.task}".`,
    });
  }

  // The recipe's first step declares what it consumes; reject a mismatch before
  // touching a provider.
  const expects = recipe.steps[0]?.from;
  if (expects && parsed.data.payload.modality !== expects) {
    return errorStream({
      kind: 'bad_input',
      retryable: false,
      message: `${recipe.title} expects ${expects} input.`,
    });
  }

  const snap = await snapshot(visitorId);
  if (!visitorAllowed(snap)) {
    return errorStream({
      kind: 'quota_exhausted',
      retryable: false,
      message: `You have used all ${snap.visitorLimit} free runs for today. The daily allowance resets at 00:00 UTC.`,
    });
  }

  let resolved;
  try {
    resolved = plan(recipe, snap);
  } catch (error) {
    return errorStream(
      error instanceof RouterError
        ? error.normalized
        : { kind: 'unknown', retryable: false, message: 'Could not plan a route.' },
    );
  }

  const encoder = new TextEncoder();
  const controller = new AbortController();
  // If the visitor closes the tab, stop paying for upstream calls.
  req.signal.addEventListener('abort', () => controller.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const emit = (event: RunEvent) => {
        try {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Client went away mid-run; the abort listener stops the work.
        }
      };

      emit({ type: 'plan', pair: recipe.pair, steps: planPreview(resolved) });

      try {
        await execute({
          plan: resolved,
          input: parsed.data.payload,
          instruction: parsed.data.instruction,
          visitorId,
          emit,
          signal: controller.signal,
        });
      } catch (error) {
        emit({
          type: 'error',
          error:
            error instanceof RouterError
              ? error.normalized
              : {
                  kind: 'unknown',
                  retryable: false,
                  message: error instanceof Error ? error.message : 'Run failed.',
                },
        });
      } finally {
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops proxies buffering the stream and defeating the progress events.
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Errors travel over the same SSE channel so the client has one code path. */
function errorStream(error: NormalizedError): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error })}\n\n`));
      c.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}
