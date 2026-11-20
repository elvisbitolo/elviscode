import { fetchPage, fetchRenderedPage } from "../../../lib/web-fetch";
import { SYSTEM_PROMPT } from "../../../lib/system-prompt";
import { isUnlocked } from "../../../lib/session";
import { clientKey, rateLimit } from "../../../lib/rate-limit";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_ROUNDS = 6;

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

async function callModel(messages, apiKey) {
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages = incoming
    .filter((message) => {
      if (!message || typeof message.content !== "string") return false;
      if (message.role === "user" || message.role === "assistant") return true;
      return message.role === "tool" && typeof message.tool_call_id === "string";
    })
    .slice(-40)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 16000),
      ...(message.role === "tool" ? { tool_call_id: message.tool_call_id } : {}),
      ...(message.role === "assistant" && Array.isArray(message.tool_calls)
        ? { tool_calls: message.tool_calls }
        : {}),
    }));

  const last = messages[messages.length - 1];
  if (!last || (last.role !== "user" && last.role !== "tool")) {
    return Response.json({ error: "A user message is required." }, { status: 400 });
  }

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const raw = await callModel(messages, apiKey);
      if (!raw) throw new Error("The model returned an empty response.");

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
          pending.push({ id, name, code: String(args.code || "") });
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
    return Response.json({ error: error.message || "Something went wrong." }, { status: 502 });
  }
}
