import { randomBytes } from "node:crypto";

/** UTC stamp plus 16 bits of hex so concurrent runs do not collide. */
export function newRunId(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}
