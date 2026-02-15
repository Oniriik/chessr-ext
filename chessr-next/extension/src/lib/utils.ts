import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Les classes doivent être écrites avec le prefix tw- directement dans le code
// car Tailwind scanne le code source au build time
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
