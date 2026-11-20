import { decodeEntities } from "./web-fetch.js";

function cleanText(value) {
  return decodeEntities(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function cleanHref(href) {
  const decoded = decodeEntities(href).trim();
  if (decoded.startsWith("//")) return `https:${decoded}`;

  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : decoded;
  } catch {
    return decoded;
  }
}

function formatResults(results, source, query) {
  const stopWords = new Set(["and", "for", "how", "the", "what", "with", "latest"]);
  const terms = query
    .toLowerCase()
    .replace(/[^\w.\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !stopWords.has(term));
  const scored = results.map((result, index) => {
    const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
    return {
      ...result,
      index,
      score: terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0),
    };
  });
  const best = Math.max(0, ...scored.map((result) => result.score));
  const ranked = (best === 0 ? scored : scored.filter((result) => result.score > 0))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ index, score, ...result }) => result);
  const text = ranked
    .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`)
    .join("\n\n")
    .slice(0, 16000);
  return { results: ranked, source, text };
}

function parseBingRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, 6)
    .map((match) => {
      const item = match[1];
      return {
        title: cleanText(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""),
        url: decodeEntities(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim(),
        snippet: cleanText(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || ""),
      };
    })
    .filter((result) => result.title && result.url);
}

function parseDuckDuckGo(html) {
  const links = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetList = [...html.matchAll(snippets)].map((match) => cleanText(match[1]));
  const results = [];

  for (const match of html.matchAll(links)) {
    if (results.length >= 6) break;
    results.push({
      title: cleanText(match[2]),
      url: cleanHref(match[1]),
      snippet: snippetList[results.length] || "",
    });
  }

  return results;
}

async function searchWithJina(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers: {
        Authorization: `Bearer ${process.env.JINA_API_KEY}`,
        Accept: "text/plain",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Search service returned HTTP ${response.status}.`);
    return {
      source: "Jina Search",
      results: [],
      text: (await response.text()).slice(0, 16000),
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Search took too long.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithBing(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ElvisCode/1.0)" },
        signal: controller.signal,
      }
    );
    if (!response.ok) throw new Error(`Search returned HTTP ${response.status}.`);

    const results = parseBingRss((await response.text()).slice(0, 600_000));
    if (results.length === 0) throw new Error("No search results found.");
    return formatResults(results, "Bing RSS", query);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Search took too long.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithDuckDuckGo(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ElvisCode/1.0)" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Search returned HTTP ${response.status}.`);

    const results = parseDuckDuckGo((await response.text()).slice(0, 600_000));
    if (results.length === 0) throw new Error("No search results found.");
    return formatResults(results, "DuckDuckGo", query);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Search took too long.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchWeb(rawQuery) {
  const query = String(rawQuery || "").trim().slice(0, 300);
  if (!query) throw new Error("A search query is required.");

  if (process.env.JINA_API_KEY) return searchWithJina(query);

  let lastError = null;
  for (const search of [searchWithBing, searchWithDuckDuckGo]) {
    try {
      return await search(query);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No search results found.");
}
