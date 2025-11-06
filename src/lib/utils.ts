// This file exposes UI utility helpers shared across the Sparkier dashboard components.
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: Array<string | undefined | null | false>): string => twMerge(clsx(inputs));
