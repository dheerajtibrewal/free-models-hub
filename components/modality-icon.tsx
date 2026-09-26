import { AudioLines, ImageIcon, Type } from 'lucide-react';
import type { Modality } from '@/lib/registry';

const ICONS = {
  text: Type,
  image: ImageIcon,
  audio: AudioLines,
} as const;

export const MODALITY_LABEL: Record<Modality, string> = {
  text: 'Text',
  image: 'Image',
  audio: 'Audio',
};

export function ModalityIcon({
  modality,
  size = 16,
  className,
}: {
  modality: Modality;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[modality];
  return <Icon size={size} className={className} aria-hidden="true" />;
}
