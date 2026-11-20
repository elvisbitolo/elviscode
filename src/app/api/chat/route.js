import { TOOLS, TOOL_DEFINITIONS, getTool } from "../../../lib/tool-registry";
import { executeServerTool } from "../../../lib/tool-executors";
import { buildSystemPrompt } from "../../../lib/system-prompt";
import { isUnlocked } from "../../../lib/session";
import { clientKey, rateLimit } from "../../../lib/rate-limit";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_ROUNDS = 6;
const MAX_BODY_BYTES = 512_000;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 120_000;
const MAX_TOOL_RESULT_CHARS = 16_000;
const MAX_TOOL_CALLS_PER_ROUND = 3;
const MAX_TOOL_CODE_CHARS = 20_000;
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const ALLOWED_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
const ALLOWED_TOOLS = new Set(TOOLS.map((tool) => tool.name));

const tools = TOOL_DEFINITIONS;

function toolResult(id, value) {
  return {
    role: "tool",
    tool_call_id: id,
    content: JSON.stringify(value).slice(0, MAX_TOOL_RESULT_CHARS),
  };
}

function encodeEvent(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function validateMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    return { error: `Send between 1 and ${MAX_MESSAGES} messages.` };
  }

  const messages = [];
  for (const message of input) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { error: "Invalid message format." };
    }
    if (!["user", "assistant", "tool"].includes(message.role)) {
      return { error: "Unsupported message role." };
    }
    if (typeof message.content !== "string" || message.content.length > MAX_MESSAGE_CHARS) {
      return { error: "Message content is invalid or too long." };
    }

    const clean = { role: message.role, content: message.content };

    if (message.role === "tool") {
      if (typeof message.tool_call_id !== "string" || message.tool_call_id.length > 128) {
        return { error: "Invalid tool result identifier." };
      }
      clean.tool_call_id = message.tool_call_id;
    }

    if (message.role === "assistant" && message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length > MAX_TOOL_CALLS_PER_ROUND) {
        return { error: "Invalid tool-call history." };
      }
      const calls = [];
      for (const call of message.tool_calls) {
        const id = call?.id;
        const name = call?.function?.name;
        const args = call?.function?.arguments;
        if (
          typeof id !== "string" ||
          id.length > 128 ||
          !ALLOWED_TOOLS.has(name) ||
          typeof args !== "string" ||
          args.length > 8_000
        ) {
          return { error: "Invalid tool-call history." };
        }
        calls.push({ id, type: "function", function: { name, arguments: args } });
      }
      clean.tool_calls = calls;
    }

    messages.push(clean);
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user" && last.role !== "tool") {
    return { error: "A user message is required." };
  }
  return { messages };
}

async function runServerTool(name, args, id) {
  try {
    return toolResult(id, await executeServerTool(name, args));
  } catch (error) {
    return toolResult(id, { ok: false, error: error.message });
  }
}

function accumulateToolCall(calls, delta) {
  const index = delta.index ?? 0;
  const call = calls.get(index) || {
    index,
    id: "",
    type: "function",
    function: { name: "", arguments: "" },
  };

  if (delta.id) call.id += delta.id;
  if (delta.type) call.type = delta.type;
  if (delta.function?.name) call.function.name += delta.function.name;
  if (delta.function?.arguments) call.function.arguments += delta.function.arguments;

  calls.set(index, call);
}

export async function POST(request) {
  if (!isUnlocked(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limit = await rateLimit(`chat:${clientKey(request)}`, 20, 60_000);
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
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return Response.json({ error: "Request is too large." }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validated = validateMessages(body?.messages);
  if (validated.error) return Response.json({ error: validated.error }, { status: 400 });
  const messages = validated.messages;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "GROQ_API_KEY is not set. Add it to .env.local locally or to your Vercel environment variables, then redeploy.",
      },
      { status: 500 }
    );
  }

  const model = ALLOWED_MODELS.includes(body.model)
    ? body.model
    : process.env.GROQ_MODEL && ALLOWED_MODELS.includes(process.env.GROQ_MODEL)
      ? process.env.GROQ_MODEL
      : DEFAULT_MODEL;

  const persona =
    typeof body.persona === "string" && body.persona.trim()
      ? body.persona.trim().slice(0, 4000)
      : "";
  const systemPrompt = buildSystemPrompt(persona);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          return;
        }
      };

      try {
        let current = messages;

        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          send({ type: "status", text: round === 0 ? "Thinking" : "Continuing" });

          const upstream = await fetch(GROQ_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "system", content: systemPrompt }, ...current],
              tools,
              tool_choice: "auto",
              temperature: 0.6,
              max_tokens: 3000,
              stream: true,
              stream_options: { include_usage: true },
            }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
          });

          if (!upstream.ok || !upstream.body) {
            const details = await upstream.text().catch(() => "");
            send({
              type: "error",
              error: `Model provider error (${upstream.status}): ${details.slice(0, 400)}`,
            });
            finish();
            return;
          }

          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          const calls = new Map();
          let buffer = "";
          let textContent = "";
          let usage = null;
          let reachedDone = false;

          while (!reachedDone) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf("\n");

            while (newline !== -1) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              newline = buffer.indexOf("\n");

              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data) continue;
              if (data === "[DONE]") {
                reachedDone = true;
                continue;
              }

              let payload;
              try {
                payload = JSON.parse(data);
              } catch {
                continue;
              }

              if (payload.usage) usage = payload.usage;

              const delta = payload.choices?.[0]?.delta;
              if (!delta) continue;

              if (typeof delta.content === "string" && delta.content) {
                textContent += delta.content;
                send({ type: "delta", text: delta.content });
              }

              if (Array.isArray(delta.tool_calls)) {
                for (const call of delta.tool_calls) accumulateToolCall(calls, call);
              }
            }
          }

          reader.releaseLock();
          if (usage) send({ type: "usage", usage });

          const toolCalls = [...calls.values()]
            .sort((a, b) => a.index - b.index)
            .map((call, index) => ({ ...call, id: call.id || `call_${index}_${round}` }));
          if (toolCalls.length > MAX_TOOL_CALLS_PER_ROUND) {
            send({
              type: "error",
              error: "The model requested too many tools at once. Please try again.",
            });
            finish();
            return;
          }

          const assistant = {
            role: "assistant",
            content: textContent,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          };
          current.push(assistant);

          if (toolCalls.length === 0) {
            send({ type: "done", messages: current });
            finish();
            return;
          }

          const pending = [];
          const statusTexts = [];

          for (const call of toolCalls) {
            const id = call.id;
            const name = call.function?.name;
            const tool = getTool(name);
            let args = {};

            try {
              const parsed = JSON.parse(call.function?.arguments || "{}");
              args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
            } catch {
              current.push(toolResult(id, { ok: false, error: "Invalid tool arguments." }));
              continue;
            }

            if (!tool) {
              current.push(toolResult(id, { ok: false, error: `Unknown tool: ${name}` }));
              continue;
            }

            if (tool.executor === "client") {
              if (typeof args.code !== "string" || args.code.length > MAX_TOOL_CODE_CHARS) {
                current.push(toolResult(id, { ok: false, error: "Code is invalid or too long." }));
                continue;
              }
              pending.push({ id, name, code: args.code });
              statusTexts.push(tool.status);
              continue;
            }

            const required = tool.parameters.required || [];
            const missing = required.filter(
              (key) => args[key] === undefined || args[key] === null || args[key] === ""
            );
            if (missing.length > 0) {
              current.push(toolResult(id, { ok: false, error: `Missing argument: ${missing.join(", ")}` }));
              continue;
            }

            if (typeof args.url === "string" && args.url.length > 2_048) {
              current.push(toolResult(id, { ok: false, error: "Invalid URL argument." }));
              continue;
            }

            statusTexts.push(tool.status);
            current.push(await runServerTool(name, args, id));
          }

          if (pending.length > 0) {
            send({
              type: "tools",
              messages: current,
              pending,
              status: statusTexts[0] || "Using tools",
            });
            finish();
            return;
          }
        }

        const stopped = "I stopped after too many tool calls. Try a simpler request.";
        send({ type: "delta", text: stopped });
        send({ type: "done", messages: current });
        finish();
      } catch (error) {
        if (error?.name === "AbortError") {
          finish();
          return;
        }
        if (error?.name === "TimeoutError") {
          send({ type: "error", error: "The model request timed out. Please try again." });
          finish();
          return;
        }
        send({ type: "error", error: error.message || "Something went wrong." });
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
