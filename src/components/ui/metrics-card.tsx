// This file renders a Tailwind metric card used in the Sparkier dashboard header.
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface MetricsCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: 'primary' | 'secondary' | 'warning' | 'muted';
}

const toneClasses: Record<NonNullable<MetricsCardProps['tone']>, string> = {
  primary: 'border-sparkier-primary/20 bg-sparkier-primary/10 text-sparkier-primary',
  secondary: 'border-sparkier-secondary/20 bg-sparkier-secondary/10 text-sparkier-secondary',
  warning: 'border-amber-400/30 bg-amber-100 text-amber-600',
  muted: 'border-slate-200 bg-white text-slate-500',
};

export const MetricsCard = ({ icon: Icon, label, value, tone = 'muted' }: MetricsCardProps): JSX.Element => (
  <article
    className={cn(
      'flex items-center gap-4 rounded-xl border px-4 py-3 shadow-sm transition hover:shadow-card',
      toneClasses[tone]
    )}
  >
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/60">
      <Icon className="h-6 w-6" aria-hidden />
    </span>
    <div className="flex flex-col">
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  </article>
);
