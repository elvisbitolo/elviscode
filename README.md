# ElvisCode

A lightweight ChatGPT-style chat app for coding and authorized security work. The UI runs locally; the model runs in the cloud, so it works on low-spec machines.

## Features

- Markdown replies with fenced code blocks, syntax highlighting, and copy buttons.
- `fetch_url` — reads a static public page.
- `fetch_rendered_page` — reads JavaScript-heavy pages and PDFs through a headless-browser reader.
- `run_js` — runs JavaScript in a sandboxed browser iframe with no network access.
- `run_python` — runs Python via Pyodide in a sandboxed iframe (standard library only).
- Chat history is saved in the browser and survives reloads.
- Optional password gate and rate limiting.

## Setup

1. Get a free API key from Groq.
2. Copy `.env.example` to `.env.local` and fill in:
   ```
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   APP_PASSWORD=change-me-to-a-long-random-password
   JINA_API_KEY=
   ```
   Leave `APP_PASSWORD` empty to disable the login screen.
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000

## Vercel

Add the same variables under Project → Settings → Environment Variables, then redeploy. `.env.local` is not uploaded to Vercel.

`JINA_API_KEY` is optional; the page reader works without it at a lower rate limit.

## Configuration

- `src/lib/system-prompt.js` — assistant instructions, scope, and tool guidance.
- `src/app/api/chat/route.js` — tool-calling agent loop and model proxy.
- `src/lib/web-fetch.js` — URL fetching with SSRF, size, and timeout limits.
- `src/lib/run-js.js` / `src/lib/run-python.js` — browser sandboxes.
- `src/lib/session.js` / `src/lib/rate-limit.js` — access controls.
- `src/components/Markdown.jsx` — response rendering.
- `src/app/page.js` — the chat interface and saved history.

## Checks

```bash
npm run lint
npm run build
```
