"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

const GREETING =
  "I'm ElvisCode. Ask me to write, debug, or explain code — or help with authorized security work.";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  async function send(event) {
    event?.preventDefault();

    const text = input.trim();
    if (!text || busy) return;

    const history = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let reply = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: reply }]);
      }
    } catch (cause) {
      setError(cause.message || "Something went wrong.");
      setMessages(history);
    } finally {
      setBusy(false);
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
              <h1 className={styles.welcomeTitle}>What can I help you build?</h1>
              <p className={styles.welcomeText}>{GREETING}</p>
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
                    {message.content ||
                      (busy && index === messages.length - 1 ? (
                        <span className={styles.cursor} />
                      ) : null)}
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
          ElvisCode can make mistakes. Check important code and security advice.
        </p>
      </main>
    </div>
  );
}
