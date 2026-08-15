export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  baseUrl: string;
  model: string;
  apiKey?: string;
  messages: ChatMessage[];
}

export type ChatClient = (req: ChatRequest) => Promise<string>;

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function openAiText(data: unknown): string {
  const choice = asRecord(asRecord(data)?.choices instanceof Array ? (data as { choices: unknown[] }).choices[0] : undefined);
  const message = asRecord(choice?.message);
  return typeof message?.content === "string" ? message.content : "";
}

function anthropicText(data: unknown): string {
  const content = asRecord(data)?.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const rec = asRecord(block);
    if (rec?.type === "text" && typeof rec.text === "string") parts.push(rec.text);
  }
  return parts.join("");
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return body ? `${res.status} ${res.statusText}: ${body.slice(0, 400)}` : `${res.status} ${res.statusText}`;
}

async function chatOpenAi(req: ChatRequest): Promise<string> {
  const url = `${stripSlash(req.baseUrl)}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`chat failed: ${await readError(res)}`);
  return openAiText(await res.json());
}

async function chatAnthropic(req: ChatRequest): Promise<string> {
  const origin = new URL(req.baseUrl).origin;
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (req.apiKey) headers["x-api-key"] = req.apiKey;
  const res = await fetch(`${origin}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: req.model,
      max_tokens: 2048,
      temperature: 0.2,
      messages,
      ...(system ? { system } : {}),
    }),
  });
  if (!res.ok) throw new Error(`chat failed: ${await readError(res)}`);
  return anthropicText(await res.json());
}

export const chat: ChatClient = async (req) => {
  if (req.baseUrl.includes("api.anthropic.com")) return chatAnthropic(req);
  return chatOpenAi(req);
};
