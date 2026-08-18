import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function runHue(hue: number): string {
  return `hsl(${hue} 70% 45%)`;
}

export function sameLedgerPage(
  a: { path: string; origin?: string },
  b: { path: string; origin?: string },
): boolean {
  return a.path === b.path && (a.origin ?? "") === (b.origin ?? "");
}
