import { fetchPage, fetchRenderedPage } from "../../../lib/web-fetch";
import { SYSTEM_PROMPT } from "../../../lib/system-prompt";
import { isUnlocked } from "../../../lib/session";
import { clientKey, rateLimit } from "../../../lib/rate-limit";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_ROUNDS = 6;
const MAX_BODY_BYTES = 96_000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 16_000;
const MAX_TOOL_CALLS_PER_ROUND = 3;
const MAX_TOOL_CODE_CHARS = 20_000;
const ALLOWED_TOOLS = new Set(["fetch_url", "fetch_rendered_page", "run_js", "run_python"]);

const tools = [
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch a public web page by URL and return its readable text. Use when the user provides a URL or asks about a specific page. Private and local network addresses are blocked.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "An absolute http or https URL.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_python",
      description:
        "Execute Python code in a sandboxed browser iframe using Pyodide and return stdout plus the final expression. Use for Python calculations, data work, or verifying Python snippets. Standard library only; no network or file access.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Python code to execute.",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_rendered_page",
      description:
        "Read a public page through a headless browser and return it as markdown. Use when fetch_url returns little or no content, or for JavaScript-heavy pages and PDFs. Private and local network addresses are blocked.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "An absolute http or https URL.",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_js",
      description:
        "Execute JavaScript in a sandboxed browser iframe and return console output plus the returned value. Use for calculations, data processing, verifying code, or producing results. The code has no network access and runs on the user's machine.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "JavaScript code to execute.",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
];

function toolResult(id, value) {
  return {
    role: "tool",
    tool_call_id: id,
    content: JSON.stringify(value).slice(0, 16000),
  };
}

function validateMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    return { error: `Send between 1 and ${MAX_MESSAGES} messages.` };
  }
  const messages = [];
  for (const message of input) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return { error: "Invalid message format." };
    if (!["user", "assistant", "tool"].includes(message.role)) return { error: "Unsupported message role." };
    if (typeof message.content !== "string" || message.content.length > MAX_MESSAGE_CHARS) return { error: "Message content is invalid or too long." };
    const clean = { role: message.role, content: message.content };
    if (message.role === "tool") {
      if (typeof message.tool_call_id !== "string" || message.tool_call_id.length > 128) return { error: "Invalid tool result identifier." };
      clean.tool_call_id = message.tool_call_id;
    }
    if (message.role === "assistant" && message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length > MAX_TOOL_CALLS_PER_ROUND) return { error: "Invalid tool-call history." };
      const calls = [];
      for (const call of message.tool_calls) {
        const id = call?.id, name = call?.function?.name, args = call?.function?.arguments;
        if (typeof id !== "string" || id.length > 128 || !ALLOWED_TOOLS.has(name) || typeof args !== "string" || args.length > 8_000) return { error: "Invalid tool-call history." };
        calls.push({ id, type: "function", function: { name, arguments: args } });
      }
      clean.tool_calls = calls;
    }
    messages.push(clean);
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user" && last.role !== "tool") return { error: "A user message is required." };
  return { messages };
}

async function callModel(messages, apiKey) {
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      tools,
      tool_choice: "auto",
      temperature: 0.6,
      max_tokens: 3000,
      stream: false,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Model provider error (${response.status}): ${details.slice(0, 500)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message;
}

export async function POST(request) {
  if (!isUnlocked(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limit = rateLimit(`chat:${clientKey(request)}`, 12, 60_000);
  if (!limit.ok) {
    return Response.json(
      { error: "Rate limit reached. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return Response.json({ error: "Request is too large." }, { status: 413 });

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return Response.json({ error: "Request is too large." }, { status: 413 });
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validated = validateMessages(body?.messages);
  if (validated.error) return Response.json({ error: validated.error }, { status: 400 });
  const messages = validated.messages;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return Response.json({ error: "GROQ_API_KEY is not configured on the server." }, { status: 500 });

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const raw = await callModel(messages, apiKey);
      if (!raw) throw new Error("The model returned an empty response.");

      if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > MAX_TOOL_CALLS_PER_ROUND) {
        return Response.json({ error: "The model requested too many tools at once. Please try again." }, { status: 502 });
      }

      const assistant = {
        role: "assistant",
        content: typeof raw.content === "string" ? raw.content : "",
        ...(Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0
          ? { tool_calls: raw.tool_calls }
          : {}),
      };
      messages.push(assistant);

      const toolCalls = assistant.tool_calls || [];
      if (toolCalls.length === 0) {
        return Response.json({ messages, content: assistant.content });
      }

      const pending = [];

      for (const call of toolCalls) {
        const id = call.id || call.tool_call_id || `call_${pending.length}_${round}`;
        const name = call.function?.name;
        let args = {};

        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          messages.push(toolResult(id, { ok: false, error: "Invalid tool arguments." }));
          continue;
        }

        if (name === "fetch_url" || name === "fetch_rendered_page") {
          if (typeof args.url !== "string" || args.url.length > 2_048) {
            messages.push(toolResult(id, { ok: false, error: "Invalid URL argument." }));
            continue;
          }
          try {
            const page =
              name === "fetch_url" ? await fetchPage(args.url) : await fetchRenderedPage(args.url);
            messages.push(
              toolResult(id, {
                ok: true,
                url: page.url,
                title: page.title,
                text: page.text.slice(0, 14000),
                truncated: page.truncated,
              })
            );
          } catch (error) {
            messages.push(toolResult(id, { ok: false, error: error.message }));
          }
        } else if (name === "run_js" || name === "run_python") {
          if (typeof args.code !== "string" || args.code.length > MAX_TOOL_CODE_CHARS) {
            messages.push(toolResult(id, { ok: false, error: "Code is invalid or too long." }));
            continue;
          }
          pending.push({ id, name, code: args.code });
        } else {
          messages.push(toolResult(id, { ok: false, error: `Unknown tool: ${name}` }));
        }
      }

      if (pending.length > 0) {
        return Response.json({ messages, content: assistant.content, pending });
      }
    }

    return Response.json({
      messages,
      content: "I stopped after too many tool calls. Try a simpler request.",
    });
  } catch (error) {
    if (error?.name === "TimeoutError") return Response.json({ error: "The model request timed out. Please try again." }, { status: 504 });
    return Response.json({ error: error.message || "Something went wrong." }, { status: 502 });
  }
}
