const FUNCTIONS = {
  sqrt: { min: 1, max: 1, fn: Math.sqrt },
  abs: { min: 1, max: 1, fn: Math.abs },
  round: { min: 1, max: 1, fn: Math.round },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  exp: { min: 1, max: 1, fn: Math.exp },
  sin: { min: 1, max: 1, fn: Math.sin },
  cos: { min: 1, max: 1, fn: Math.cos },
  tan: { min: 1, max: 1, fn: Math.tan },
  log: { min: 1, max: 1, fn: Math.log },
  log10: { min: 1, max: 1, fn: Math.log10 },
  pow: { min: 2, max: 2, fn: Math.pow },
  min: { min: 1, max: 32, fn: Math.min },
  max: { min: 1, max: 32, fn: Math.max },
};

const CONSTANTS = { pi: Math.PI, e: Math.E };

function tokenize(expression) {
  const tokens = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    const remaining = expression.slice(index);
    const word = remaining.match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (word) {
      const value = word[0];
      tokens.push({
        type: /^[0-9.]/.test(value) ? "number" : "name",
        value,
      });
      index += value.length;
      continue;
    }

    if ("+-*/%^(),".includes(character)) {
      tokens.push({
        type: "+-*/%^".includes(character) ? "op" : character === "(" ? "lparen" : character === ")" ? "rparen" : "comma",
        value: character,
      });
      index += 1;
      continue;
    }

    throw new Error(`Unexpected character: ${character}`);
  }

  return tokens;
}

export function calculateExpression(input) {
  const expression = String(input ?? "").trim();
  if (!expression) throw new Error("Expression is empty.");
  if (expression.length > 500) throw new Error("Expression is too long.");

  const tokens = tokenize(expression);
  let position = 0;

  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  function expect(type, value) {
    const token = consume();
    if (!token || token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${value || type}.`);
    }
    return token;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) {
      const operator = consume().value;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (peek()?.type === "op" && ["*", "/", "%"].includes(peek().value)) {
      const operator = consume().value;
      const right = parseUnary();
      if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else value %= right;
    }
    return value;
  }

  function parseUnary() {
    if (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) {
      const operator = consume().value;
      const value = parseUnary();
      return operator === "-" ? -value : value;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    if (peek()?.type === "op" && peek().value === "^") {
      consume();
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parseArguments() {
    const args = [];
    if (peek()?.type === "rparen") return args;
    while (true) {
      args.push(parseExpression());
      if (peek()?.type === "comma") {
        consume();
        continue;
      }
      expect("rparen");
      return args;
    }
  }

  function parsePrimary() {
    const token = consume();
    if (!token) throw new Error("Incomplete expression.");

    if (token.type === "number") return Number(token.value);

    if (token.type === "name") {
      if (peek()?.type === "lparen") {
        consume();
        const spec = FUNCTIONS[token.value];
        if (!spec) throw new Error(`Unknown function: ${token.value}`);
        const args = parseArguments();
        if (args.length < spec.min || args.length > spec.max) {
          throw new Error(`${token.value} expects ${spec.min === spec.max ? spec.min : `${spec.min}-${spec.max}`} argument(s).`);
        }
        return spec.fn(...args);
      }
      if (Object.hasOwn(CONSTANTS, token.value)) return CONSTANTS[token.value];
      throw new Error(`Unknown name: ${token.value}`);
    }

    if (token.type === "lparen") {
      const value = parseExpression();
      expect("rparen");
      return value;
    }

    throw new Error(`Unexpected token: ${token.value}`);
  }

  const result = parseExpression();
  if (position !== tokens.length) throw new Error(`Unexpected token: ${peek().value}`);
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number.");
  if (Math.abs(result) > 1e15) throw new Error("Result is too large.");

  return { expression, result };
}
