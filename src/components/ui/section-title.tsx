// This file renders reusable section titles for the Sparkier dashboard layout.
import { cn } from '@/lib/utils';

interface SectionTitleProps {
  title: string;
  subtitle?: string;
  className?: string;
}

export const SectionTitle = ({ title, subtitle, className }: SectionTitleProps) => (
  <div className={cn('flex flex-col gap-1', className)}>
    <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
    {subtitle ? <p className="text-sm text-slate-600">{subtitle}</p> : null}
  </div>
);
