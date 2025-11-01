// This file exposes UI utility helpers shared across the Sparkier dashboard components.
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs) => twMerge(clsx(inputs));
