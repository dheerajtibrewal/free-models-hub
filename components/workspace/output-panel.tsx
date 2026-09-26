'use client';

import * as React from 'react';
import { Check, Copy, Download, MonitorSpeaker, Pause, Play, Sparkles } from 'lucide-react';
import type { Modality } from '@/lib/registry';
import { isOnDeviceAudio, type Payload } from '@/lib/router/types';
import { speakOnDevice, stopSpeaking } from '@/lib/media/audio';
import { Badge, Button, EmptyState, Panel, PanelHeader, Skeleton } from '@/components/ui';
import type { RunState } from '@/lib/hooks/use-run';

export function OutputPanel({
  modality,
  run,
  action,
}: {
  modality: Modality;
  run: RunState;
  action: string;
}) {
  return (
    <Panel className="flex min-h-[320px] flex-col">
      <PanelHeader
        title="Output"
        hint={run.status === 'running' ? 'Running…' : undefined}
        actions={run.result ? <OutputActions payload={run.result} /> : null}
      />
      <div className="flex flex-1 flex-col p-5">
        {run.status === 'idle' ? (
          <EmptyState
            icon={<Sparkles size={22} aria-hidden="true" />}
            title={`Nothing yet`}
            body={`Add your input, then hit ${action}. We'll pick the models for you.`}
          />
        ) : null}

        {run.status === 'running' && !run.result ? <RunningSkeleton modality={modality} /> : null}

        {run.error && !run.result ? <ErrorState message={run.error.message} /> : null}

        {run.result ? <Result payload={run.result} /> : null}
      </div>
    </Panel>
  );
}

function Result({ payload }: { payload: Payload }) {
  if (payload.modality === 'text') {
    return (
      <div className="flex-1">
        <p className="whitespace-pre-wrap font-mono text-[13.5px] leading-relaxed text-fg">
          {payload.text}
        </p>
      </div>
    );
  }

  if (payload.modality === 'image') {
    return (
      <div className="fl-rise overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)]">
        {/* Base64 straight from the provider; there is no URL for next/image to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:${payload.mimeType};base64,${payload.base64}`}
          alt="The generated image"
          className="mx-auto h-auto w-full object-contain"
        />
      </div>
    );
  }

  return <AudioResult payload={payload} />;
}

function AudioResult({ payload }: { payload: Payload }) {
  const [speaking, setSpeaking] = React.useState(false);

  React.useEffect(() => () => stopSpeaking(), []);

  // The on-device route: the Web Speech API only exists in the browser, so the
  // server returned the text plus a marker rather than audio bytes.
  if (isOnDeviceAudio(payload)) {
    const toggle = async () => {
      if (speaking) {
        stopSpeaking();
        setSpeaking(false);
        return;
      }
      setSpeaking(true);
      try {
        await speakOnDevice(payload.text);
      } finally {
        setSpeaking(false);
      }
    };

    return (
      <div className="fl-rise flex flex-1 flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge tone="amber">
            <MonitorSpeaker size={10} aria-hidden="true" />
            On-device voice
          </Badge>
          <span className="text-[11px] text-[var(--subtle-fg)]">
            Hosted speech was unavailable, so your browser reads it instead.
          </span>
        </div>
        <Button variant="primary" size="lg" onClick={() => void toggle()} className="self-start">
          {speaking ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          {speaking ? 'Stop' : 'Play'}
        </Button>
        <p className="whitespace-pre-wrap border-t border-[var(--border)] pt-4 font-mono text-[13px] leading-relaxed text-muted-fg">
          {payload.text}
        </p>
      </div>
    );
  }

  if (payload.modality !== 'audio') return null;

  return (
    <div className="fl-rise flex-1">
      <audio controls autoPlay src={`data:${payload.mimeType};base64,${payload.base64}`} className="w-full">
        <track kind="captions" />
      </audio>
    </div>
  );
}

function OutputActions({ payload }: { payload: Payload }) {
  const [copied, setCopied] = React.useState(false);

  if (payload.modality === 'text' || isOnDeviceAudio(payload)) {
    const text = payload.modality === 'text' ? payload.text : payload.text;
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* clipboard blocked; the text is selectable anyway */
          }
        }}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    );
  }

  const ext = payload.modality === 'image' ? extFor(payload.mimeType, 'png') : extFor(payload.mimeType, 'wav');

  return (
    <a
      href={`data:${payload.mimeType};base64,${payload.base64}`}
      download={`free-models-hub-output.${ext}`}
      className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium text-muted-fg transition-colors duration-200 hover:bg-[var(--muted)] hover:text-fg"
    >
      <Download size={13} aria-hidden="true" />
      Download
    </a>
  );
}

function extFor(mimeType: string, fallback: string): string {
  const sub = mimeType.split('/')[1]?.split(';')[0];
  if (!sub) return fallback;
  if (sub === 'jpeg') return 'jpg';
  if (sub === 'mpeg') return 'mp3';
  return sub;
}

function RunningSkeleton({ modality }: { modality: Modality }) {
  if (modality === 'image') {
    return <Skeleton className="aspect-square w-full rounded-[10px]" />;
  }
  if (modality === 'audio') {
    return <Skeleton className="h-14 w-full rounded-[10px]" />;
  }
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="h-4 w-[92%]" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-[78%]" />
      <Skeleton className="h-4 w-[85%]" />
      <Skeleton className="h-4 w-[45%]" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-[10px] border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.07)] p-4"
      role="alert"
    >
      <p className="text-[13px] font-medium text-[#f87171]">Run failed</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-fg">{message}</p>
    </div>
  );
}
