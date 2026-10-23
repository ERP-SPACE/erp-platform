import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["2xs"] }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
