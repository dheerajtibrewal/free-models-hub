'use client';

import * as React from 'react';
import { Mic, Square, Upload, X } from 'lucide-react';
import type { Modality } from '@/lib/registry';
import type { InputPayload } from '@/lib/router/schema';
import { normalizeImage, type NormalizedImage } from '@/lib/media/image';
import {
  MAX_DURATION_SEC,
  normalizeAudio,
  startRecording,
  type NormalizedAudio,
  type Recorder,
} from '@/lib/media/audio';
import { Button, Panel, PanelHeader } from '@/components/ui';
import { cn, formatBytes, formatDuration } from '@/lib/utils';

export interface InputState {
  payload?: InputPayload;
  instruction: string;
  /** Human-readable summary of what will be sent, e.g. '1024x768 · 184 KB'. */
  summary?: string;
  error?: string;
  busy?: boolean;
}

export function InputPanel({
  modality,
  state,
  onChange,
  disabled,
}: {
  modality: Modality;
  state: InputState;
  onChange: (next: InputState) => void;
  disabled?: boolean;
}) {
  return (
    <Panel className="flex min-h-[320px] flex-col">
      <PanelHeader
        title="Input"
        hint={state.summary}
        actions={
          state.payload ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ instruction: state.instruction })}
              disabled={disabled}
            >
              <X size={13} aria-hidden="true" />
              Clear
            </Button>
          ) : null
        }
      />

      <div className="flex flex-1 flex-col gap-4 p-5">
        {modality === 'text' ? (
          <TextInput state={state} onChange={onChange} disabled={disabled} />
        ) : null}
        {modality === 'image' ? (
          <ImageInput state={state} onChange={onChange} disabled={disabled} />
        ) : null}
        {modality === 'audio' ? (
          <AudioInput state={state} onChange={onChange} disabled={disabled} />
        ) : null}

        {state.error ? (
          <p className="text-[13px] text-[#f87171]" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ text */

function TextInput({
  state,
  onChange,
  disabled,
}: {
  state: InputState;
  onChange: (n: InputState) => void;
  disabled?: boolean;
}) {
  const value = state.payload?.modality === 'text' ? state.payload.text : '';

  return (
    <div className="flex flex-1 flex-col gap-2">
      <label htmlFor="text-input" className="text-[13px] font-medium text-muted-fg">
        Your text
      </label>
      <textarea
        id="text-input"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const text = e.target.value;
          onChange({
            ...state,
            error: undefined,
            payload: text ? { modality: 'text', text } : undefined,
            summary: text ? `${text.length.toLocaleString()} characters` : undefined,
          });
        }}
        placeholder="Ask a question, paste something to summarise, or describe an image you want…"
        rows={9}
        className={cn(
          'w-full flex-1 resize-y rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-3.5',
          'text-[14px] leading-relaxed text-fg placeholder:text-[var(--subtle-fg)]',
          'transition-colors duration-200 hover:border-[var(--border-hover)]',
          'disabled:opacity-60',
        )}
      />
    </div>
  );
}

/* ----------------------------------------------------------------------- image */

function ImageInput({
  state,
  onChange,
  disabled,
}: {
  state: InputState;
  onChange: (n: InputState) => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = React.useState<NormalizedImage | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (!state.payload) setPreview(null);
  }, [state.payload]);

  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.previewUrl);
    },
    [preview],
  );

  const accept = async (file: File | undefined) => {
    if (!file) return;
    onChange({ ...state, busy: true, error: undefined });
    try {
      // Downscaled in the browser: vision models gain nothing past ~1024px and
      // this is what keeps the upload well inside Vercel's 4.5MB body cap.
      const image = await normalizeImage(file);
      setPreview(image);
      onChange({
        ...state,
        busy: false,
        error: undefined,
        payload: { modality: 'image', base64: image.base64, mimeType: image.mimeType },
        summary: `${image.width}×${image.height} · ${formatBytes(image.bytes)}`,
      });
    } catch (err) {
      onChange({
        ...state,
        busy: false,
        error: err instanceof Error ? err.message : 'Could not read that image.',
      });
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3">
      {preview ? (
        <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)]">
          {/* Local object URL of the user's own file; next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.previewUrl}
            alt="The image you selected"
            className="mx-auto max-h-[300px] w-auto object-contain"
          />
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void accept(e.dataTransfer.files[0]);
          }}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-3 rounded-[10px] border border-dashed p-8 text-center',
            'transition-colors duration-200',
            dragging
              ? 'border-[var(--ring)] bg-[rgba(37,99,235,0.08)]'
              : 'border-[var(--border-hover)] bg-[var(--bg)]',
          )}
        >
          <Upload size={20} className="text-[var(--subtle-fg)]" aria-hidden="true" />
          <div>
            <p className="text-[13px] font-medium text-muted-fg">Drop an image here</p>
            <p className="mt-1 text-xs text-[var(--subtle-fg)]">
              PNG, JPEG or WebP · resized to 1024px before upload
            </p>
          </div>
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={disabled || state.busy}>
            {state.busy ? 'Processing…' : 'Choose file'}
          </Button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void accept(e.target.files?.[0])}
      />

      <div>
        <label htmlFor="image-instruction" className="text-[13px] font-medium text-muted-fg">
          What should we do with it? <span className="text-[var(--subtle-fg)]">(optional)</span>
        </label>
        <input
          id="image-instruction"
          value={state.instruction}
          disabled={disabled}
          onChange={(e) => onChange({ ...state, instruction: e.target.value })}
          placeholder="Read the text in this receipt"
          className="mt-2 h-11 w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3.5 text-[14px] text-fg placeholder:text-[var(--subtle-fg)] transition-colors duration-200 hover:border-[var(--border-hover)]"
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- audio */

function AudioInput({
  state,
  onChange,
  disabled,
}: {
  state: InputState;
  onChange: (n: InputState) => void;
  disabled?: boolean;
}) {
  const [audio, setAudio] = React.useState<NormalizedAudio | null>(null);
  const [recorder, setRecorder] = React.useState<Recorder | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!state.payload) setAudio(null);
  }, [state.payload]);

  // Recording auto-stops at the cap: two minutes is both the body-size ceiling
  // and what keeps the shared 28,800 audio-seconds/day budget usable.
  React.useEffect(() => {
    if (!recorder) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => {
      const secs = (Date.now() - started) / 1000;
      setElapsed(secs);
      if (secs >= MAX_DURATION_SEC) void finish(recorder);
    }, 200);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  const ingest = async (blob: Blob, filename: string) => {
    onChange({ ...state, busy: true, error: undefined });
    try {
      const normalized = await normalizeAudio(blob, filename);
      setAudio(normalized);
      onChange({
        ...state,
        busy: false,
        error: undefined,
        payload: {
          modality: 'audio',
          base64: normalized.base64,
          mimeType: normalized.mimeType,
          durationSec: normalized.durationSec,
        },
        summary: `${formatDuration(normalized.durationSec)} · ${formatBytes(normalized.bytes)}${
          normalized.transcoded ? ` · ${(normalized.sampleRate ?? 0) / 1000}kHz mono` : ''
        }`,
      });
    } catch (err) {
      onChange({
        ...state,
        busy: false,
        error: err instanceof Error ? err.message : 'Could not read that audio.',
      });
    }
  };

  const finish = async (active: Recorder) => {
    setRecorder(null);
    const blob = await active.stop();
    await ingest(blob, 'recording.webm');
  };

  const begin = async () => {
    try {
      setRecorder(await startRecording());
    } catch (err) {
      onChange({
        ...state,
        error: err instanceof Error ? err.message : 'Microphone unavailable.',
      });
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3">
      {recorder ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[10px] border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.06)] p-8">
          <div className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 rounded-full bg-[var(--destructive)]"
              style={{ animation: 'fl-pulse 1.2s ease-in-out infinite' }}
              aria-hidden="true"
            />
            <span className="tabular text-[22px] font-semibold" role="timer">
              {formatDuration(elapsed)}
            </span>
          </div>
          <p className="text-xs text-muted-fg">
            Stops automatically at {MAX_DURATION_SEC / 60} minutes
          </p>
          <Button variant="danger" size="md" onClick={() => void finish(recorder)}>
            <Square size={13} aria-hidden="true" />
            Stop
          </Button>
        </div>
      ) : audio ? (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-4">
          <audio controls src={audio.previewUrl} className="w-full">
            <track kind="captions" />
          </audio>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[10px] border border-dashed border-[var(--border-hover)] bg-[var(--bg)] p-8 text-center">
          <Mic size={20} className="text-[var(--subtle-fg)]" aria-hidden="true" />
          <div>
            <p className="text-[13px] font-medium text-muted-fg">Record or upload audio</p>
            <p className="mt-1 text-xs text-[var(--subtle-fg)]">
              Up to {MAX_DURATION_SEC / 60} minutes · speech works best
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" size="md" onClick={() => void begin()} disabled={disabled || state.busy}>
              <Mic size={14} aria-hidden="true" />
              Record
            </Button>
            <Button size="md" onClick={() => inputRef.current?.click()} disabled={disabled || state.busy}>
              <Upload size={14} aria-hidden="true" />
              {state.busy ? 'Processing…' : 'Upload'}
            </Button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void ingest(file, file.name);
        }}
      />
    </div>
  );
}
