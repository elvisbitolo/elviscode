import { SYSTEM_PROMPT } from "../../../lib/system-prompt";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function POST(request) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: "GROQ_API_KEY is not set. Add it to .env.local and restart the server." },
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
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.length > 0
    )
    .slice(-20)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 12000),
    }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "A user message is required." }, { status: 400 });
  }

  let upstream;
  try {
    upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      }),
    });
  } catch {
    return Response.json({ error: "Could not reach the model provider." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const details = await upstream.text().catch(() => "");
    return Response.json(
      { error: `Model provider error (${upstream.status}): ${details.slice(0, 500)}` },
      { status: upstream.status }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    start(controller) {
      const reader = upstream.body.getReader();
      let buffer = "";
      let closed = false;

      const finish = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      (async () => {
        try {
          while (true) {
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
              if (!data || data === "[DONE]") continue;

              try {
                const payload = JSON.parse(data);
                const token = payload.choices?.[0]?.delta?.content;
                if (token && !closed) controller.enqueue(encoder.encode(token));
              } catch {
                continue;
              }
            }
          }
        } catch (error) {
          if (!closed) {
            closed = true;
            controller.error(error);
          }
        } finally {
          reader.releaseLock();
        }

        finish();
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
