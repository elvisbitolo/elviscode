import { connection, NextResponse } from "next/server";
import { isPasswordProtected, isUnlocked } from "../../../lib/session";

export async function GET(request) {
  await connection();
  return NextResponse.json({
    required: isPasswordProtected(),
    unlocked: isUnlocked(request),
  });
}
