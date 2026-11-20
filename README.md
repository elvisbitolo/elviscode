# ElvisCode

A lightweight ChatGPT-style chat app for coding and authorized security work. The UI runs locally; the model runs in the cloud, so it works on low-spec machines.

## Features

- Markdown replies with fenced code blocks, syntax highlighting, and copy buttons.
- `fetch_url` tool: reads a public web page and summarizes it for the assistant.
- `run_js` tool: runs JavaScript in a sandboxed browser iframe and returns console output.
- Tool activity indicators while the assistant works.

## Setup

1. Get a free API key from Groq.
2. Create `.env.local` in this folder:
   ```
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   ```
   (You can copy `.env.example` as a starting point.)
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000

## Vercel

Add `GROQ_API_KEY` and optionally `GROQ_MODEL` under Project → Settings → Environment Variables, then redeploy. `.env.local` is not uploaded to Vercel.

## Configuration

- `src/lib/system-prompt.js` — the assistant's instructions, scope, and tool guidance.
- `src/app/api/chat/route.js` — the tool-calling agent loop and model proxy.
- `src/lib/web-fetch.js` — URL fetching with SSRF, size, and timeout limits.
- `src/lib/run-js.js` — the browser sandbox runner.
- `src/components/Markdown.jsx` — response rendering.
- `src/app/page.js` — the chat interface.

## Checks

```bash
npm run lint
npm run build
```
