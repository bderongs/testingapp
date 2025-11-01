// This file renders a status badge highlighting story verification progress.
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: 'unverified' | 'baseline' | 'outdated';
}

const statusStyles: Record<StatusBadgeProps['status'], string> = {
  unverified: 'bg-amber-100 text-amber-700 border border-amber-200',
  baseline: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  outdated: 'bg-rose-100 text-rose-700 border border-rose-200',
};

const statusLabel: Record<StatusBadgeProps['status'], string> = {
  unverified: 'Unverified',
  baseline: 'Baseline',
  outdated: 'Outdated',
};

export const StatusBadge = ({ status }: StatusBadgeProps): JSX.Element => (
  <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', statusStyles[status])}>
    {statusLabel[status]}
  </span>
);
