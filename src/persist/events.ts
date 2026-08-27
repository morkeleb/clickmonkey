import { appendFileSync } from "node:fs";
import { redactEnvInText } from "../executor/secrets.js";

export type PersistEvent = {
  ts: string;
  type: string;
  [key: string]: unknown;
};

/** JSONL. Callers must not put secrets or HTML on the event. */
export function appendEvent(path: string, event: PersistEvent): void {
  appendFileSync(path, `${redactEnvInText(JSON.stringify(event))}\n`, "utf8");
}
