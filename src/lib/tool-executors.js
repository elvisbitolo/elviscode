import { createHash, randomUUID } from "node:crypto";
import { fetchPage, fetchRenderedPage } from "./web-fetch";
import { searchWeb } from "./web-search";
import { calculateExpression } from "./calculate";
import { convertUnits } from "./units";

const HASH_ALGORITHMS = new Set(["sha256", "sha1", "md5"]);

function currentTime(timezone) {
  const zone = typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";
  const now = new Date();

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(now);
  } catch {
    throw new Error(`Unknown timezone: ${zone}`);
  }

  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);

  return { iso: now.toISOString(), timezone: zone, local };
}

function hashText(text, algorithm) {
  const name = typeof algorithm === "string" && algorithm.trim() ? algorithm.trim().toLowerCase() : "sha256";
  if (!HASH_ALGORITHMS.has(name)) throw new Error(`Unsupported algorithm: ${name}`);
  return { algorithm: name, digest: createHash(name).update(String(text ?? ""), "utf8").digest("hex") };
}

function encodeBase64(text, operation) {
  const input = String(text ?? "");
  if (operation === "decode") {
    return { operation, text: Buffer.from(input, "base64").toString("utf8") };
  }
  if (operation && operation !== "encode") throw new Error(`Unsupported operation: ${operation}`);
  return { operation: "encode", text: Buffer.from(input, "utf8").toString("base64") };
}

function formatJson(json, indent) {
  const parsed = JSON.parse(String(json ?? ""));
  const spaces = Number.isInteger(indent) ? Math.min(8, Math.max(0, indent)) : 2;
  return { text: JSON.stringify(parsed, null, spaces), indent: spaces };
}

function generateUuids(count) {
  const amount = Number.isInteger(count) ? Math.min(20, Math.max(1, count)) : 1;
  return { uuids: Array.from({ length: amount }, () => randomUUID()) };
}

export async function executeServerTool(name, args = {}) {
  if (name === "search_web") {
    return { ok: true, ...(await searchWeb(args.query)) };
  }

  if (name === "fetch_url" || name === "fetch_rendered_page") {
    const page = name === "fetch_url" ? await fetchPage(args.url) : await fetchRenderedPage(args.url);
    return {
      ok: true,
      url: page.url,
      title: page.title,
      text: String(page.text || "").slice(0, 14000),
      truncated: page.truncated,
    };
  }

  if (name === "calculate") return { ok: true, ...calculateExpression(args.expression) };
  if (name === "get_time") return { ok: true, ...currentTime(args.timezone) };
  if (name === "hash_text") return { ok: true, ...hashText(args.text, args.algorithm) };
  if (name === "base64") return { ok: true, ...encodeBase64(args.text, args.operation) };
  if (name === "format_json") return { ok: true, ...formatJson(args.json, args.indent) };
  if (name === "generate_uuid") return { ok: true, ...generateUuids(args.count) };
  if (name === "convert_units") return { ok: true, ...convertUnits(args.value, args.from, args.to) };

  return { ok: false, error: `Unknown tool: ${name}` };
}
