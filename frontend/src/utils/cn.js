import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge className fragments, resolving Tailwind conflicts (last wins). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
