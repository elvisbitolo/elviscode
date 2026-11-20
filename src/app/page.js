"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import { runInSandbox } from "../lib/run-js";
import { runInPython } from "../lib/run-python";
import styles from "./page.module.css";

const STORAGE_KEY = "elviscode.chat.v1";
const MAX_ROUNDS = 8;

const SUGGESTIONS = [
  "Write a JS function that deduplicates an array",
  "Use Python to compute the first 10 Fibonacci numbers",
  "What is on https://example.com?",
];

function activityFor(names) {
  if (names.length > 1) return "Using tools";
  if (names.includes("run_python")) return "Running Python";
  if (names.includes("run_js")) return "Running JavaScript";
  if (names.includes("fetch_rendered_page")) return "Rendering a page";
  if (names.includes("fetch_url")) return "Fetching a web page";
  return "Working";
}

export default function Home() {
  const [auth, setAuth] = useState({ loading: true, required: false, unlocked: false });
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [error, setError] = useState("");
  const threadRef = useRef(null);
  const historyRef = useRef([]);
  const restoredRef = useRef(false);

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
    restoredRef.current = true;

    queueMicrotask(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (!saved) return;
        if (Array.isArray(saved.messages)) setMessages(saved.messages);
        if (Array.isArray(saved.history)) historyRef.current = saved.history;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    });
  }, [auth]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, activity]);

  function saveChat(nextMessages, nextHistory) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: nextMessages, history: nextHistory }));
    } catch {
      return;
    }
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
    } catch {
      setAuthError("Could not sign in.");
    }
  }

  async function send(event, overrideText) {
    event?.preventDefault?.();

    const text = (overrideText ?? input).trim();
    if (!text || busy || (auth.required && !auth.unlocked)) return;

    const previousHistory = historyRef.current;
    const base = [...messages, { role: "user", content: text }];
    let history = [...previousHistory, { role: "user", content: text }];

    setMessages([...base, { role: "assistant", content: "", thinking: true }]);
    setInput("");
    setError("");
    setActivity("Thinking");
    setBusy(true);

    try {
      let answer = "";

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
          throw new Error(data.error || `Request failed (${response.status})`);
        }

        history = data.messages;
        setActivity(data.content ? "Finishing up" : "Thinking");

        if (!data.pending?.length) {
          answer = data.content || "";
          break;
        }

        setActivity(activityFor(data.pending.map((call) => call.name)));

        for (const call of data.pending) {
          let result;

          if (call.name === "run_js") {
            result = await runInSandbox(call.code);
          } else if (call.name === "run_python") {
            result = await runInPython(call.code);
          } else {
            continue;
          }

          history.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }

        if (round === MAX_ROUNDS - 1) {
          answer = "I stopped after too many tool calls. Try a simpler request.";
        }
      }

      const finalMessages = [...base, { role: "assistant", content: answer }];
      historyRef.current = history;
      setMessages(finalMessages);
      saveChat(finalMessages, history);
    } catch (cause) {
      historyRef.current = previousHistory;
      setError(cause.message || "Something went wrong.");
      setMessages(base);
      saveChat(base, previousHistory);
    } finally {
      setBusy(false);
      setActivity("");
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function clearChat() {
    setMessages([]);
    setInput("");
    setError("");
    setActivity("");
    historyRef.current = [];
    localStorage.removeItem(STORAGE_KEY);
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
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>E</span>
          ElvisCode
        </div>
        <button
          type="button"
          className={styles.clearButton}
          onClick={clearChat}
          disabled={busy || messages.length === 0}
        >
          New chat
        </button>
      </header>

      <main className={styles.main}>
        <div className={styles.thread} ref={threadRef}>
          {messages.length === 0 ? (
            <div className={styles.welcome}>
              <span className={styles.welcomeLogo}>E</span>
              <h1 className={styles.welcomeTitle}>What can I help you build?</h1>
              <p className={styles.welcomeText}>
                Coding help, web page reading, Python and JavaScript execution — all in one chat.
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
                  key={index}
                  className={`${styles.row} ${
                    message.role === "user" ? styles.userRow : styles.assistantRow
                  }`}
                >
                  <div className={styles.avatar}>
                    {message.role === "user" ? "You" : "AI"}
                  </div>
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

        <form className={styles.composer} onSubmit={send}>
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
            type="submit"
            className={styles.sendButton}
            disabled={busy || !input.trim()}
          >
            Send
          </button>
        </form>

        <p className={styles.footer}>
          Code runs in a browser sandbox. Check important code and security advice.
        </p>
      </main>
    </div>
  );
}
