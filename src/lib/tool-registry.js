export const TOOLS = [
  {
    name: "search_web",
    description:
      "Search the web for a query and return titles, URLs, and snippets. Use when you need to find pages or current information and do not have a specific URL.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for." } },
      required: ["query"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Searching the web",
    prompt: "search_web(query): search the web when you need to find pages or current information. Use returned URLs with fetch_url or fetch_rendered_page for details.",
  },
  {
    name: "fetch_url",
    description:
      "Fetch a public web page by URL and return its readable text. Use when you have a specific URL and expect static HTML.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "An absolute http or https URL." } },
      required: ["url"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Fetching a page",
    prompt: "fetch_url(url): read a static public web page. Use it first when a URL is given.",
  },
  {
    name: "fetch_rendered_page",
    description:
      "Read a public page through a headless browser and return it as markdown. Use for JavaScript-heavy pages and PDFs, or when fetch_url returns little content.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "An absolute http or https URL." } },
      required: ["url"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Rendering a page",
    prompt: "fetch_rendered_page(url): read a page through a headless browser as markdown. Use for JavaScript-heavy pages and PDFs, or when fetch_url returns little or nothing.",
  },
  {
    name: "run_js",
    description:
      "Execute JavaScript in a sandboxed browser iframe with console output. Use for JS calculations, data work, and verifying snippets. No network access.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "JavaScript code to execute." } },
      required: ["code"],
      additionalProperties: false,
    },
    executor: "client",
    status: "Running JavaScript",
    prompt: "run_js(code): execute JavaScript in a sandboxed browser iframe with console.log available. No network access.",
  },
  {
    name: "run_python",
    description:
      "Execute Python in a sandboxed browser iframe via Pyodide with stdout captured. Use for Python calculations and data work. Standard library only; no network or file access.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "Python code to execute." } },
      required: ["code"],
      additionalProperties: false,
    },
    executor: "client",
    status: "Running Python",
    prompt: "run_python(code): execute Python in a sandboxed browser iframe with stdout captured. Standard library only; no network or file access.",
  },
  {
    name: "calculate",
    description:
      "Evaluate a math expression safely without executing code. Supports + - * / % ^, parentheses, constants pi and e, and functions sqrt, abs, round, floor, ceil, min, max, pow, log, log10, exp, sin, cos, tan.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "A math expression, e.g. sqrt(2) * pi." },
      },
      required: ["expression"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Calculating",
    prompt: "calculate(expression): safely evaluate arithmetic and math functions instead of guessing numbers.",
  },
  {
    name: "get_time",
    description:
      "Get the current date and time in UTC or a named IANA timezone such as Africa/Nairobi.",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "Optional IANA timezone. Defaults to UTC." },
      },
      additionalProperties: false,
    },
    executor: "server",
    status: "Checking the time",
    prompt: "get_time(timezone): get the current date and time in UTC or a named timezone when asked about now.",
  },
  {
    name: "hash_text",
    description: "Hash text with SHA-256, SHA-1, or MD5 and return the hex digest.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to hash." },
        algorithm: {
          type: "string",
          enum: ["sha256", "sha1", "md5"],
          description: "Hash algorithm. Defaults to sha256.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Hashing text",
    prompt: "hash_text(text, algorithm): return a SHA-256, SHA-1, or MD5 hex digest.",
  },
  {
    name: "base64",
    description: "Encode text to Base64 or decode Base64 back to UTF-8 text.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Input text or Base64 string." },
        operation: {
          type: "string",
          enum: ["encode", "decode"],
          description: "Encode text to Base64 or decode Base64 to text. Defaults to encode.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Encoding data",
    prompt: "base64(text, operation): encode text to Base64 or decode Base64 to text.",
  },
  {
    name: "format_json",
    description: "Validate and pretty-print a JSON string.",
    parameters: {
      type: "object",
      properties: {
        json: { type: "string", description: "JSON text to validate and format." },
        indent: { type: "integer", description: "Spaces per level, 0 to 8. Defaults to 2." },
      },
      required: ["json"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Formatting JSON",
    prompt: "format_json(json, indent): validate and pretty-print JSON instead of formatting it by hand.",
  },
  {
    name: "generate_uuid",
    description: "Generate one or more random UUID v4 strings.",
    parameters: {
      type: "object",
      properties: {
        count: { type: "integer", description: "How many UUIDs to generate, 1 to 20. Defaults to 1." },
      },
      additionalProperties: false,
    },
    executor: "server",
    status: "Generating UUIDs",
    prompt: "generate_uuid(count): generate random UUID v4 values.",
  },
  {
    name: "convert_units",
    description:
      "Convert a value between common units of length, mass, temperature, data, and time.",
    parameters: {
      type: "object",
      properties: {
        value: { type: "number", description: "Numeric value to convert." },
        from: { type: "string", description: "Source unit, e.g. km, lb, c, MiB, h." },
        to: { type: "string", description: "Target unit, e.g. mi, kg, f, GB, min." },
      },
      required: ["value", "from", "to"],
      additionalProperties: false,
    },
    executor: "server",
    status: "Converting units",
    prompt: "convert_units(value, from, to): convert between length, mass, temperature, data, and time units.",
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

export const TOOL_DEFINITIONS = TOOLS.map(({ name, description, parameters }) => ({
  type: "function",
  function: { name, description, parameters },
}));

export const TOOL_PROMPT = TOOLS.map((tool) => `- ${tool.prompt}`).join("\n");

export function getTool(name) {
  return TOOL_MAP.get(name) || null;
}

export function activityLabel(names) {
  if (names.length > 1) return "Using tools";
  if (names.length === 0) return "Working";
  return getTool(names[0])?.status || "Working";
}
