import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const MAX_BYTES = 300_000;
const MAX_TEXT = 20_000;
const TIMEOUT = 8_000;
const MAX_REDIRECTS = 3;

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
]) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const address of ["::", "::1"]) blocked.addAddress(address, "ipv6");
for (const [address, prefix] of [
  ["fc00::", 7],
  ["fe80::", 10],
  ["2001:db8::", 32],
]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

function isBlockedAddress(address, family) {
  if (family === 6) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], "ipv4");
  }
  return blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

const namedEntities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1].toLowerCase() === "x";
      const code = Number.parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(html) {
  const title = decodeEntities(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""
  ).trim();

  let body = html.replace(
    /<(script|style|noscript|svg|iframe|nav|footer|header)[\s\S]*?<\/\1>/gi,
    " "
  );
  body = body.replace(/<br\s*\/?>/gi, "\n");
  body = body.replace(/<\/(p|div|section|article|h[1-6]|li|tr|table)>/gi, "\n");
  body = body.replace(/<[^>]+>/g, " ");
  body = decodeEntities(body);
  body = body
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text: body };
}

async function validateHost(hostname, port) {
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) throw new Error("Host could not be resolved.");

  for (const { address, family } of addresses) {
    if (isIP(address) && isBlockedAddress(address, family)) {
      throw new Error("That address is not allowed.");
    }
  }

  if (port && port !== "80" && port !== "443") {
    throw new Error("Only ports 80 and 443 are allowed.");
  }

  return addresses[0].address;
}

function readResponse(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    response.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        response.destroy();
        reject(new Error("Page is too large to read."));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
  });
}

async function requestOnce(rawUrl, redirectsLeft) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  const address = await validateHost(url.hostname, url.port);
  const transport = url.protocol === "https:" ? https : http;
  const port = url.port || (url.protocol === "https:" ? 443 : 80);

  const response = await new Promise((resolve, reject) => {
    const request = transport.request(
      {
        host: address,
        port,
        path: url.pathname + url.search,
        method: "GET",
        servername: url.hostname,
        headers: {
          Host: url.host,
          Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "identity",
          "User-Agent": "ElvisCode/1.0 (+fetch tool)",
        },
        timeout: TIMEOUT,
      },
      resolve
    );

    request.on("timeout", () => request.destroy(new Error("Page took too long to load.")));
    request.on("error", reject);
    request.end();
  });

  const status = response.statusCode || 0;
  if (status >= 300 && status < 400 && response.headers.location) {
    response.resume();
    if (redirectsLeft === 0) throw new Error("Too many redirects.");
    const next = new URL(response.headers.location, url).toString();
    return requestOnce(next, redirectsLeft - 1);
  }

  if (status < 200 || status >= 300) {
    response.resume();
    throw new Error(`Page returned HTTP ${status}.`);
  }

  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/json") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    response.resume();
    throw new Error("That content type cannot be read as text.");
  }

  const charset = contentType.match(/charset=([^;]+)/)?.[1]?.trim() || "utf-8";
  const buffer = await readResponse(response);
  let content;
  try {
    content = new TextDecoder(charset).decode(buffer);
  } catch {
    content = buffer.toString("utf8");
  }

  return htmlToText(content);
}

async function readLimitedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error("Page is too large to read.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchPage(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error("Invalid URL.");
  }

  const page = await requestOnce(url.toString(), MAX_REDIRECTS);
  const text = page.text.slice(0, MAX_TEXT);

  return {
    url: url.toString(),
    title: page.title,
    text,
    truncated: page.text.length > MAX_TEXT,
  };
}

export async function fetchRenderedPage(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error("Invalid URL.");
  }

  await validateHost(url.hostname, url.port);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch("https://r.jina.ai/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Respond-With": "markdown",
        ...(process.env.JINA_API_KEY
          ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ url: url.toString() }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Page reader returned HTTP ${response.status}.`);

    const full = await readLimitedText(response);
    return {
      url: url.toString(),
      text: full.slice(0, MAX_TEXT),
      truncated: full.length > MAX_TEXT,
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Page reader took too long.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
