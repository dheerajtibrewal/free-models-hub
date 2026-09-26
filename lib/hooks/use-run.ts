'use client';

import * as React from 'react';
import type { InputPayload } from '@/lib/router/schema';
import type { NormalizedError, Payload, RunEvent, XRayTrace } from '@/lib/router/types';
import { taskCompleted, taskFailed, taskStarted } from '@/lib/analytics/events';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

export interface StepProgress {
  index: number;
  title: string;
  state: 'pending' | 'active' | 'done' | 'skipped';
  label?: string;
  latencyMs?: number;
  /** Set when this step fell back to another model. */
  fellBackFrom?: string;
}

export interface RunState {
  status: RunStatus;
  steps: StepProgress[];
  result?: Payload;
  trace?: XRayTrace;
  error?: NormalizedError;
}

const INITIAL: RunState = { status: 'idle', steps: [] };

/**
 * Consumes the /api/run SSE stream.
 *
 * The endpoint streams rather than returning JSON for three reasons: live
 * progress on a pipeline that can take 10+ seconds, escaping Vercel's 4.5MB
 * response cap (a 1024px base64 image brushes against it), and delivering trace
 * events as they happen.
 */
export function useRun(taskSlug: string) {
  const [state, setState] = React.useState<RunState>(INITIAL);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) =>
      s.status === 'running'
        ? {
            ...s,
            status: 'error',
            error: { kind: 'timeout', retryable: false, message: 'Run cancelled.' },
          }
        : s,
    );
  }, []);

  const run = React.useCallback(
    async (payload: InputPayload, instruction?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ status: 'running', steps: [] });
      taskStarted(taskSlug);

      try {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: taskSlug, payload, instruction }),
          signal: controller.signal,
        });

        if (!res.body) throw new Error('The server sent no response stream.');

        for await (const event of readEvents(res.body, controller.signal)) {
          setState((prev) => reduce(prev, event));
          if (event.type === 'trace') {
            if (event.trace.error) taskFailed(taskSlug, event.trace.error.kind);
            else taskCompleted(taskSlug, event.trace.totalLatencyMs, event.trace.fallbackOccurred);
          }
          if (event.type === 'error') taskFailed(taskSlug, event.error.kind);
        }

        setState((prev) =>
          prev.status === 'running'
            ? prev.result
              ? { ...prev, status: 'done' }
              : {
                  ...prev,
                  status: 'error',
                  error:
                    prev.error ?? {
                      kind: 'unknown',
                      retryable: false,
                      message: 'The run ended without producing a result.',
                    },
                }
            : prev,
        );
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        taskFailed(taskSlug, 'network');
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: { kind: 'unknown', retryable: false, message },
        }));
      } finally {
        abortRef.current = null;
      }
    },
    [taskSlug],
  );

  return { ...state, run, reset, cancel };
}

/* --------------------------------------------------------------------- reducer */

function reduce(prev: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'plan':
      return {
        ...prev,
        steps: event.steps.map((s) => ({
          index: s.index,
          title: s.title,
          state: 'pending' as const,
          label: s.candidate,
        })),
      };

    case 'step_start':
      return {
        ...prev,
        steps: upsert(prev.steps, event.index, (s) => ({
          ...s,
          title: event.title,
          state: 'active',
          label: event.label,
        })),
      };

    case 'step_retry':
      return {
        ...prev,
        steps: upsert(prev.steps, event.index, (s) => ({
          ...s,
          label: event.next,
          fellBackFrom: event.failed,
        })),
      };

    case 'step_done':
      return {
        ...prev,
        steps: upsert(prev.steps, event.index, (s) => ({
          ...s,
          state: 'done',
          latencyMs: event.latencyMs,
        })),
      };

    case 'step_skipped':
      return {
        ...prev,
        steps: upsert(prev.steps, event.index, (s) => ({ ...s, state: 'skipped' })),
      };

    case 'result':
      return { ...prev, result: event.payload };

    case 'trace':
      return {
        ...prev,
        trace: event.trace,
        status: event.trace.error ? 'error' : prev.result ? 'done' : prev.status,
        error: event.trace.error ?? prev.error,
      };

    case 'error':
      return { ...prev, status: 'error', error: event.error };

    default:
      return prev;
  }
}

function upsert(
  steps: StepProgress[],
  index: number,
  update: (s: StepProgress) => StepProgress,
): StepProgress[] {
  const existing = steps.find((s) => s.index === index);
  if (!existing) {
    return [...steps, update({ index, title: `Step ${index + 1}`, state: 'pending' })].sort(
      (a, b) => a.index - b.index,
    );
  }
  return steps.map((s) => (s.index === index ? update(s) : s));
}

/* ------------------------------------------------------------------ SSE parser */

async function* readEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<RunEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; a base64 image can span many chunks.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseChunk(chunk);
        if (parsed) yield parsed;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseChunk(chunk: string): RunEvent | null {
  const data = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('');
  if (!data) return null;
  try {
    return JSON.parse(data) as RunEvent;
  } catch {
    return null;
  }
}
