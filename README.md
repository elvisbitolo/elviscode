# ElvisCode

A lightweight ChatGPT-style chat app for coding and authorized security work. The UI runs locally; the model runs in the cloud, so it works on low-spec machines.

## Features

- Markdown replies with fenced code blocks, syntax highlighting, and copy buttons.
- Streaming replies with stop and regenerate controls.
- Multiple saved chats, custom instructions, model selection, and Markdown export.
- File and code attachments plus optional browser voice input.
- `search_web` — searches through Jina Search or DuckDuckGo.
- `fetch_url` — reads a static public page.
- `fetch_rendered_page` — reads JavaScript-heavy pages and PDFs through a headless-browser reader.
- `run_js` — runs JavaScript in a sandboxed browser iframe with no network access.
- `run_python` — runs Python via Pyodide in a sandboxed iframe (standard library only).
- Chat history, preferences, and usage estimates are saved in the browser.
- Optional password gate, per-instance rate limiting, and optional Upstash Redis for shared limits.
- Vercel Web Analytics page views and privacy-safe custom usage events.

## Setup

1. Get a free API key from Groq.
2. Copy `.env.example` to `.env.local` and fill in:
   ```
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   APP_PASSWORD=change-me-to-a-long-random-password
   JINA_API_KEY=
   UPSTASH_REDIS_REST_URL=
   UPSTASH_REDIS_REST_TOKEN=
   ```
   Leave `APP_PASSWORD` empty to disable the login screen. Leave the Upstash values empty to use local in-memory rate limits.
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000

## Vercel

Add the same variables under Project → Settings → Environment Variables, then redeploy. `.env.local` is not uploaded to Vercel.

`JINA_API_KEY` is optional; web search and page reading work without it at a lower rate limit. For shared rate limits across Vercel functions, create an Upstash Redis database and add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the same environment variables.

## Configuration

- `src/lib/system-prompt.js` — assistant instructions, scope, and tool guidance.
- `src/app/api/chat/route.js` — tool-calling agent loop and model proxy.
- `src/lib/web-fetch.js` — URL fetching with SSRF, size, and timeout limits.
- `src/lib/web-search.js` — web search with Jina Search or DuckDuckGo fallback.
- `src/lib/run-js.js` / `src/lib/run-python.js` — browser sandboxes.
- `src/lib/session.js` / `src/lib/rate-limit.js` — access controls.
- `src/components/Markdown.jsx` — response rendering.
- `src/app/page.js` — the chat interface and saved history.

## Checks

```bash
npm run lint
npm run build
```
