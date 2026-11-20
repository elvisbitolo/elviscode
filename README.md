# ElvisCode

A lightweight ChatGPT-style chat app for coding and authorized security work. The UI runs locally; the model runs in the cloud, so it works on low-spec machines.

## Setup

1. Get a free API key from Groq.
2. Create `.env.local` in this folder:
   ```
   GROQ_API_KEY=your_key_here
   GROQ_MODEL=llama-3.3-70b-versatile
   ```
   (You can copy `.env.example` as a starting point.)
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000

## Configuration

- `src/lib/system-prompt.js` — the assistant's instructions and scope.
- `src/app/api/chat/route.js` — the server-side proxy that keeps your API key private.
- `src/app/page.js` — the chat interface.

To use another OpenAI-compatible provider, change the URL and model in `src/app/api/chat/route.js`.

## Checks

```bash
npm run lint
npm run build
```
