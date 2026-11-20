import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "elviscode_session";

export function isPasswordProtected() {
  return Boolean(process.env.APP_PASSWORD);
}

function sessionToken() {
  return createHmac("sha256", process.env.APP_PASSWORD || "")
    .update("elviscode-session")
    .digest("hex");
}

function safeEqualText(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

export function isUnlocked(request) {
  if (!isPasswordProtected()) return true;
  const value = request.cookies.get(COOKIE_NAME)?.value;
  return Boolean(value && safeEqualText(value, sessionToken()));
}

export function passwordMatches(password) {
  return safeEqualText(password, process.env.APP_PASSWORD || "");
}

export function setSessionCookie(response, unlocked) {
  if (unlocked) {
    response.cookies.set(COOKIE_NAME, sessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    response.cookies.delete(COOKIE_NAME);
  }
  return response;
}
