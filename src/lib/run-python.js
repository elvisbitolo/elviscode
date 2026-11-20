const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v314.0.8/full/";

const bootstrap = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${PYODIDE_BASE}; connect-src ${PYODIDE_BASE} blob:; worker-src blob:">
<script src="${PYODIDE_BASE}pyodide.js"></script>
<script>
(async function () {
  let pyodide = null;
  let output = [];
  const write = (text) => { output.push(String(text)); };

  try {
    pyodide = await loadPyodide({
      indexURL: "${PYODIDE_BASE}",
      stdout: write,
      stderr: (text) => write("STDERR " + text),
    });
    parent.postMessage({ type: "elviscode-python-ready" }, "*");
  } catch (error) {
    parent.postMessage({ type: "elviscode-python-ready", error: String(error) }, "*");
    return;
  }

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || data.type !== "elviscode-python-run") return;

    output = [];
    try {
      const value = await pyodide.runPythonAsync(data.code);
      if (typeof value !== "undefined" && value !== null) output.push(String(value));
      parent.postMessage(
        { type: "elviscode-python-result", id: data.id, ok: true, output: output.join("\\n") },
        "*"
      );
    } catch (error) {
      output.push(String(error));
      parent.postMessage(
        { type: "elviscode-python-result", id: data.id, ok: false, output: output.join("\\n") },
        "*"
      );
    }
  });
})();
</script>`;

let state = null;
let loading = null;
let nextId = 0;

function createPythonFrame() {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;left:-9999px;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    iframe.srcdoc = bootstrap;

    const current = { iframe, ready: false, pending: new Map() };
    state = current;

    const timer = setTimeout(() => {
      finish(new Error("Pyodide took too long to load."));
      current.iframe.remove();
      state = null;
    }, 90_000);

    const settle = (callback, value) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      callback(value);
    };

    const finish = (error) => {
      if (error) {
        settle(reject, error);
      } else {
        current.ready = true;
        settle(resolve, current);
      }
    };

    const onMessage = (event) => {
      if (event.source !== current.iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "elviscode-python-ready") {
        finish(data.error ? new Error(data.error) : null);
        return;
      }

      if (data.type === "elviscode-python-result") {
        const pending = current.pending.get(data.id);
        if (!pending) return;
        current.pending.delete(data.id);
        clearTimeout(pending.timer);
        pending.resolve({
          ok: Boolean(data.ok),
          output: String(data.output || "").slice(0, 8000),
        });
      }
    };

    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}

function ensurePythonFrame() {
  if (state?.ready) return Promise.resolve(state);
  if (loading) return loading;

  loading = createPythonFrame().finally(() => {
    loading = null;
  });
  return loading;
}

export async function runInPython(code) {
  const frame = await ensurePythonFrame();
  const id = ++nextId;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      frame.pending.delete(id);
      resolve({ ok: false, output: "Python execution timed out after 20 seconds." });
    }, 20_000);

    frame.pending.set(id, { resolve, timer });
    frame.iframe.contentWindow.postMessage(
      { type: "elviscode-python-run", id, code: String(code) },
      "*"
    );
  });
}
