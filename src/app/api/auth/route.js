import { NextResponse } from "next/server";
import { isPasswordProtected, passwordMatches, setSessionCookie } from "../../../lib/session";
import { clientKey, rateLimit } from "../../../lib/rate-limit";

export async function POST(request) {
  const limit = rateLimit(`auth:${clientKey(request)}`, 8, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!isPasswordProtected()) return NextResponse.json({ ok: true });

  if (!passwordMatches(body?.password ?? "")) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  return setSessionCookie(NextResponse.json({ ok: true }), true);
}
