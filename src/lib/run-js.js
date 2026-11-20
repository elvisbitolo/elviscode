const bootstrap = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'">
<script>
(function () {
  const outputs = [];
  const format = (value) => {
    if (typeof value === "string") return value;
    if (typeof value === "undefined") return "undefined";
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };
  const sandboxConsole = {
    log: (...args) => outputs.push(args.map(format).join(" ")),
    info: (...args) => outputs.push(args.map(format).join(" ")),
    warn: (...args) => outputs.push("WARN " + args.map(format).join(" ")),
    error: (...args) => outputs.push("ERROR " + args.map(format).join(" ")),
  };

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || data.type !== "elviscode-run") return;

    outputs.length = 0;
    try {
      const runner = new Function(
        "console",
        '"use strict"; return (async () => {\\n' + data.code + "\\n})();"
      );
      const value = await runner(sandboxConsole);
      if (typeof value !== "undefined") outputs.push(format(value));
      parent.postMessage(
        { type: "elviscode-result", id: data.id, ok: true, output: outputs.join("\\n") },
        "*"
      );
    } catch (error) {
      outputs.push(String((error && error.stack) || error));
      parent.postMessage(
        { type: "elviscode-result", id: data.id, ok: false, output: outputs.join("\\n") },
        "*"
      );
    }
  });

  parent.postMessage({ type: "elviscode-ready" }, "*");
})();
</script>`;

let nextId = 0;

export function runInSandbox(code) {
  return new Promise((resolve) => {
    const id = ++nextId;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;left:-9999px;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    iframe.srcdoc = bootstrap;

    let settled = false;
    let timer;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      iframe.remove();
    };

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(payload);
    };

    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "elviscode-ready") {
        iframe.contentWindow.postMessage({ type: "elviscode-run", id, code: String(code) }, "*");
        return;
      }

      if (data.type === "elviscode-result" && data.id === id) {
        finish({ ok: Boolean(data.ok), output: String(data.output || "").slice(0, 8000) });
      }
    };

    timer = setTimeout(() => {
      finish({ ok: false, output: "Execution timed out after 5 seconds." });
    }, 5000);

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}
