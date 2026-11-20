"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@vercel/analytics/react";
import Markdown from "../components/Markdown";
import { runInSandbox } from "../lib/run-js";
import { runInPython } from "../lib/run-python";
import styles from "./page.module.css";

const CHATS_KEY = "elviscode.chats.v2";
const ACTIVE_KEY = "elviscode.active.v2";
const PREFS_KEY = "elviscode.prefs.v1";
const STATS_KEY = "elviscode.stats.v1";
const LEGACY_KEY = "elviscode.chat.v1";

const MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
];

const RATES = {
  "openai/gpt-oss-120b": [0.15, 0.6],
  "openai/gpt-oss-20b": [0.075, 0.3],
  "qwen/qwen3.8-27b": [0.8, 4.0],
};

const SUGGESTIONS = [
  "Search the web for the latest Next.js docs and summarize them",
  "Write a JS function that deduplicates an array",
  "Use Python to compute the first 10 Fibonacci numbers",
];

function makeChat() {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function titleFrom(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 38) || "New chat";
}

function estimateCost(model, usage) {
  const [inputRate, outputRate] = RATES[model] || [0, 0];
  return ((usage.prompt_tokens || 0) * inputRate + (usage.completion_tokens || 0) * outputRate) / 1_000_000;
}

function activityFor(names) {
  if (names.length > 1) return "Using tools";
  if (names.includes("run_python")) return "Running Python";
  if (names.includes("run_js")) return "Running JavaScript";
  if (names.includes("search_web")) return "Searching the web";
  if (names.includes("fetch_rendered_page")) return "Rendering a page";
  if (names.includes("fetch_url")) return "Fetching a web page";
  return "Working";
}

async function consumeEvents(response, handler) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");

      while (separator !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");

        const line = block.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        await handler(JSON.parse(raw));
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default function Home() {
  const [auth, setAuth] = useState({ loading: true, required: false, unlocked: false });
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [activity, setActivity] = useState("");
  const [error, setError] = useState("");
  const [model, setModel] = useState("openai/gpt-oss-120b");
  const [persona, setPersona] = useState("");
  const [stats, setStats] = useState({ requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const threadRef = useRef(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const recognitionRef = useRef(null);
  const restoredRef = useRef(false);

  const activeChat = chats.find((chat) => chat.id === activeId) || null;
  const messages = useMemo(() => activeChat?.messages || [], [activeChat]);

  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.json())
      .then((data) =>
        setAuth({
          loading: false,
          required: Boolean(data.required),
          unlocked: Boolean(data.unlocked),
        })
      )
      .catch(() => setAuth({ loading: false, required: false, unlocked: true }));
  }, []);

  useEffect(() => {
    if (auth.loading || !auth.unlocked || restoredRef.current) return;

    queueMicrotask(() => {
      let loaded = null;
      try {
        loaded = JSON.parse(localStorage.getItem(CHATS_KEY) || "null");
      } catch {
        loaded = null;
      }

      if (!Array.isArray(loaded) || loaded.length === 0) {
        try {
          const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
          if (legacy?.messages?.length) {
            loaded = [{ ...makeChat(), title: "Previous chat", messages: legacy.messages, history: legacy.history || [] }];
          }
        } catch {
          loaded = null;
        }
      }

      if (!Array.isArray(loaded) || loaded.length === 0) loaded = [makeChat()];
      setChats(loaded);

      const savedActive = localStorage.getItem(ACTIVE_KEY);
      setActiveId(loaded.some((chat) => chat.id === savedActive) ? savedActive : loaded[0].id);

      try {
        const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
        if (prefs?.model) setModel(prefs.model);
        if (typeof prefs?.persona === "string") setPersona(prefs.persona);
      } catch {
        setModel(MODELS[0].id);
        setPersona("");
      }

      try {
        const savedStats = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
        if (savedStats) setStats(savedStats);
      } catch {
        setStats({ requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 });
      }

      restoredRef.current = true;
    });
  }, [auth]);

  useEffect(() => {
    if (restoredRef.current) localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    if (restoredRef.current && activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  useEffect(() => {
    if (restoredRef.current) localStorage.setItem(PREFS_KEY, JSON.stringify({ model, persona }));
  }, [model, persona]);

  useEffect(() => {
    if (restoredRef.current) localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, activity]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      recognitionRef.current?.stop();
    };
  }, []);

  function patchChat(chatId, updater) {
    setChats((current) => current.map((chat) => (chat.id === chatId ? updater(chat) : chat)));
  }

  function patchMessage(chatId, messageId, updater) {
    patchChat(chatId, (chat) => ({
      ...chat,
      messages: chat.messages.map((message) => (message.id === messageId ? updater(message) : message)),
    }));
  }

  async function runAgent(chatId, history, assistantId, signal) {
    let current = history;

    for (let round = 0; round < 8; round += 1) {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: current, model, persona }),
        signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      let needsTools = false;
      let finished = false;

      await consumeEvents(response, async (event) => {
        if (event.type === "delta") {
          patchMessage(chatId, assistantId, (message) => ({
            ...message,
            content: message.content + event.text,
          }));
        } else if (event.type === "status") {
          setActivity(event.text);
        } else if (event.type === "usage") {
          setStats((currentStats) => ({
            requests: currentStats.requests + 1,
            promptTokens: currentStats.promptTokens + (event.usage.prompt_tokens || 0),
            completionTokens: currentStats.completionTokens + (event.usage.completion_tokens || 0),
            cost: currentStats.cost + estimateCost(model, event.usage),
          }));
        } else if (event.type === "tools") {
          current = event.messages;
          setActivity(event.status || "Using tools");
          track("assistant_tools_used", {
            count: event.pending.length,
            status: event.status || "tools",
          });

          for (const call of event.pending) {
            let result;
            try {
              if (call.name === "run_js") result = await runInSandbox(call.code);
              else if (call.name === "run_python") result = await runInPython(call.code);
              else continue;
            } catch (cause) {
              result = { ok: false, output: cause.message };
            }
            track("browser_tool_executed", {
              tool: call.name,
              success: result.ok !== false,
            });
            current.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }

          needsTools = true;
        } else if (event.type === "done") {
          current = event.messages;
          finished = true;
        } else if (event.type === "error") {
          throw new Error(event.error);
        }
      });

      if (finished) return current;
      if (!needsTools) return current;
    }

    patchMessage(chatId, assistantId, (message) => ({
      ...message,
      content: `${message.content}\n\nI stopped after too many tool calls.`,
    }));
    return current;
  }

  async function finishTurn(chatId, assistantId, history, controller) {
    try {
      const finalHistory = await runAgent(chatId, history, assistantId, controller.signal);
      patchChat(chatId, (chat) => ({
        ...chat,
        history: finalHistory,
        messages: chat.messages.map((message) =>
          message.id === assistantId ? { ...message, thinking: false } : message
        ),
        updatedAt: Date.now(),
      }));
    } catch (cause) {
      if (cause.name !== "AbortError") setError(cause.message || "Something went wrong.");
      patchChat(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((message) =>
          message.id === assistantId
            ? { ...message, thinking: false, content: message.content || "Stopped." }
            : message
        ),
        updatedAt: Date.now(),
      }));
    } finally {
      setBusy(false);
      setActivity("");
      abortRef.current = null;
    }
  }

  async function send(event, overrideText) {
    event?.preventDefault?.();

    const text = (overrideText ?? input).trim();
    if (!text || busy || !activeChat || (auth.required && !auth.unlocked)) return;

    const attachmentText = attachments
      .map((item) => `\n\n--- ${item.name} ---\n\`\`\`\n${item.content}\n\`\`\``)
      .join("");
    const content = text + attachmentText;
    const assistantId = crypto.randomUUID();
    const chatId = activeChat.id;
    const history = [...activeChat.history, { role: "user", content }];
    track("chat_sent", { model, attachments: attachments.length });

    patchChat(chatId, (chat) => ({
      ...chat,
      title: chat.messages.length === 0 ? titleFrom(text) : chat.title,
      messages: [
        ...chat.messages,
        { id: crypto.randomUUID(), role: "user", content },
        { id: assistantId, role: "assistant", content: "", thinking: true },
      ],
      updatedAt: Date.now(),
    }));

    setInput("");
    setAttachments([]);
    setError("");
    setActivity("Thinking");
    setBusy(true);
    setSidebarOpen(false);

    const controller = new AbortController();
    abortRef.current = controller;
    await finishTurn(chatId, assistantId, history, controller);
  }

  async function regenerate() {
    if (busy || !activeChat) return;

    const chatMessages = activeChat.messages;
    const lastUserOffset = [...chatMessages].reverse().findIndex((message) => message.role === "user");
    if (lastUserOffset === -1) return;

    const userIndex = chatMessages.length - 1 - lastUserOffset;
    const assistantId = crypto.randomUUID();
    track("chat_regenerated", { model });

    const messagesToKeep = chatMessages.slice(0, userIndex + 1).concat({
      id: assistantId,
      role: "assistant",
      content: "",
      thinking: true,
    });

    const historyOffset = [...activeChat.history].reverse().findIndex((message) => message.role === "user");
    const history =
      historyOffset === -1
        ? activeChat.history
        : activeChat.history.slice(0, activeChat.history.length - historyOffset);

    patchChat(activeChat.id, (chat) => ({
      ...chat,
      messages: messagesToKeep,
      updatedAt: Date.now(),
    }));

    setError("");
    setActivity("Thinking");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    await finishTurn(activeChat.id, assistantId, history, controller);
  }

  async function addFiles(event) {
    const files = Array.from(event.target.files || []).slice(0, 4);
    event.target.value = "";
    let accepted = 0;

    for (const file of files) {
      if (file.size > 80_000) {
        setError(`${file.name} is too large (80 KB max).`);
        continue;
      }
      const content = await file.text();
      setAttachments((current) => [...current, { name: file.name, content }].slice(0, 4));
      accepted += 1;
    }

    if (accepted > 0) track("files_attached", { count: accepted });
  }

  function toggleVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Voice input is not supported in this browser.");
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "Microphone permission denied." : "Voice input failed.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    track("voice_input_started");
  }

  function selectModel(nextModel) {
    setModel(nextModel);
    track("model_changed", { model: nextModel });
  }

  function exportChat() {
    if (!activeChat) return;
    track("chat_exported");
    const markdown = `# ${activeChat.title}\n\n${activeChat.messages
      .map((message) => `## ${message.role === "user" ? "You" : "ElvisCode"}\n\n${message.content}`)
      .join("\n\n---\n\n")}`;
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeChat.title.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function login(event) {
    event.preventDefault();
    setAuthError("");

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        setAuthError(data.error || "Could not sign in.");
        return;
      }
      setPassword("");
      setAuth((current) => ({ ...current, unlocked: true }));
      track("chat_unlocked");
    } catch {
      setAuthError("Could not sign in.");
    }
  }

  function startNewChat() {
    const chat = makeChat();
    setChats((current) => [chat, ...current]);
    setActiveId(chat.id);
    setInput("");
    setAttachments([]);
    setError("");
    setSidebarOpen(false);
  }

  function deleteChat(chatId) {
    const next = chats.filter((chat) => chat.id !== chatId);
    if (next.length === 0) {
      const chat = makeChat();
      setChats([chat]);
      setActiveId(chat.id);
      return;
    }
    setChats(next);
    if (chatId === activeId) setActiveId(next[0].id);
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  if (auth.loading) {
    return (
      <div className={styles.gate}>
        <div className={styles.gateCard}>Loading...</div>
      </div>
    );
  }

  if (auth.required && !auth.unlocked) {
    return (
      <div className={styles.gate}>
        <form className={styles.gateCard} onSubmit={login}>
          <span className={styles.welcomeLogo}>E</span>
          <h1 className={styles.gateTitle}>ElvisCode</h1>
          <p className={styles.gateText}>Enter the access password to continue.</p>
          <input
            className={styles.gateInput}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoFocus
          />
          {authError ? <p className={styles.gateError}>{authError}</p> : null}
          <button type="submit" className={styles.gateButton} disabled={!password}>
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {sidebarOpen ? (
        <button
          type="button"
          className={styles.overlay}
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarTop}>
          <div className={styles.brand}>
            <span className={styles.logo}>E</span>
            ElvisCode
          </div>
          <button type="button" className={styles.newChat} onClick={startNewChat}>
            + New chat
          </button>
        </div>
        <div className={styles.chatList}>
          {[...chats]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((chat) => (
              <div key={chat.id} className={styles.chatItem}>
                <button
                  type="button"
                  className={`${styles.chatButton} ${chat.id === activeId ? styles.chatActive : ""}`}
                  onClick={() => {
                    setActiveId(chat.id);
                    setSidebarOpen(false);
                    setError("");
                  }}
                >
                  {chat.title}
                </button>
                <button
                  type="button"
                  className={styles.deleteChat}
                  aria-label="Delete chat"
                  onClick={() => deleteChat(chat.id)}
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      </aside>

      <div className={styles.page}>
        <header className={styles.header}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div className={styles.headerTitle}>{activeChat?.title || "ElvisCode"}</div>
          <div className={styles.headerActions}>
            <select
              className={styles.modelSelect}
              value={model}
              onChange={(event) => selectModel(event.target.value)}
              aria-label="Model"
            >
              {MODELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="button" className={styles.textButton} onClick={exportChat} disabled={!activeChat}>
              Export
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.thread} ref={threadRef}>
            {messages.length === 0 ? (
              <div className={styles.welcome}>
                <span className={styles.welcomeLogo}>E</span>
                <h1 className={styles.welcomeTitle}>What can I help you build?</h1>
                <p className={styles.welcomeText}>
                  Coding, web search, page reading, and sandboxed code execution in one chat.
                </p>
                <div className={styles.suggestions}>
                  {SUGGESTIONS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className={styles.suggestion}
                      onClick={() => send(null, prompt)}
                      disabled={busy}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.messages}>
                {messages.map((message, index) => (
                  <div
                    key={message.id || index}
                    className={`${styles.row} ${
                      message.role === "user" ? styles.userRow : styles.assistantRow
                    }`}
                  >
                    <div className={styles.avatar}>{message.role === "user" ? "You" : "AI"}</div>
                    <div
                      className={`${styles.bubble} ${
                        message.role === "user" ? styles.userBubble : styles.assistantBubble
                      }`}
                    >
                      {message.thinking ? (
                        <div className={styles.thinking}>
                          <span className={styles.dots}>
                            <i />
                            <i />
                            <i />
                          </span>
                          <span>{activity || "Thinking"}</span>
                        </div>
                      ) : message.role === "user" ? (
                        message.content
                      ) : (
                        <Markdown content={message.content} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error ? <div className={styles.error}>{error}</div> : null}
          </div>

          <div className={styles.composerArea}>
            {attachments.length > 0 ? (
              <div className={styles.attachments}>
                {attachments.map((item, index) => (
                  <span key={index} className={styles.attachment}>
                    {item.name}
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      onClick={() =>
                        setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <form className={styles.composer} onSubmit={send}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Attach files"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                +
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".txt,.md,.js,.jsx,.ts,.tsx,.py,.json,.css,.html,.csv,.yml,.yaml"
                onChange={addFiles}
                hidden
              />
              <textarea
                className={styles.input}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message ElvisCode..."
                aria-label="Message ElvisCode"
                rows={1}
                disabled={busy}
              />
              <button
                type="button"
                className={`${styles.iconButton} ${listening ? styles.listening : ""}`}
                aria-label="Voice input"
                onClick={toggleVoice}
                disabled={busy}
              >
                ●
              </button>
              {busy ? (
                <button type="button" className={styles.sendButton} onClick={() => abortRef.current?.abort()}>
                  Stop
                </button>
              ) : (
                <button type="submit" className={styles.sendButton} disabled={!input.trim() && attachments.length === 0}>
                  Send
                </button>
              )}
            </form>

            <div className={styles.bottomRow}>
              <button type="button" className={styles.textButton} onClick={regenerate} disabled={busy || messages.length === 0}>
                Regenerate
              </button>
              <span className={styles.hint}>Code runs in a sandbox. Verify important answers.</span>
            </div>
          </div>
        </main>
      </div>

      {settingsOpen ? (
        <div className={styles.modalOverlay} onClick={() => setSettingsOpen(false)}>
          <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Settings</h2>
              <button type="button" className={styles.iconButton} onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </div>

            <label className={styles.label} htmlFor="persona">
              Custom instructions
            </label>
            <textarea
              id="persona"
              className={styles.personaInput}
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              placeholder="e.g. Always answer with concise bullet points."
            />
            <button type="button" className={styles.textButton} onClick={() => setPersona("")}>
              Reset instructions
            </button>

            <div className={styles.stats}>
              <h3>Usage estimate</h3>
              <p>Requests: {stats.requests}</p>
              <p>Input tokens: {stats.promptTokens.toLocaleString()}</p>
              <p>Output tokens: {stats.completionTokens.toLocaleString()}</p>
              <p>Estimated cost: ${stats.cost.toFixed(4)}</p>
            </div>

            <label className={styles.label} htmlFor="modelSetting">
              Model
            </label>
            <select
              id="modelSetting"
              className={styles.modelSelect}
              value={model}
              onChange={(event) => selectModel(event.target.value)}
            >
              {MODELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
