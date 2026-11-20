"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "../components/Markdown";
import { runInSandbox } from "../lib/run-js";
import styles from "./page.module.css";

const SUGGESTIONS = [
  "Explain this code: function f(x){ return x*2 }",
  "Write a JS function that deduplicates an array",
  "What is on https://example.com?",
];

const MAX_ROUNDS = 8;

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [error, setError] = useState("");
  const threadRef = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, activity]);

  async function send(event, overrideText) {
    event?.preventDefault?.();

    const text = (overrideText ?? input).trim();
    if (!text || busy) return;

    const base = [...messages, { role: "user", content: text }];
    let history = [...historyRef.current, { role: "user", content: text }];

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

        const names = data.pending.map((call) => call.name);
        setActivity(
          names.includes("fetch_url") && names.includes("run_js")
            ? "Fetching a page and running code"
            : names.includes("fetch_url")
              ? "Fetching a web page"
              : "Running code"
        );

        for (const call of data.pending) {
          if (call.name !== "run_js") continue;
          const result = await runInSandbox(call.code);
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

      historyRef.current = history;
      setMessages([...base, { role: "assistant", content: answer }]);
    } catch (cause) {
      setError(cause.message || "Something went wrong.");
      setMessages(base);
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
                Coding help, web page reading, and JavaScript you can actually run — all in one chat.
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
