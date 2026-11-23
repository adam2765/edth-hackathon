/**
 * The command post's lock [266]. The coordinator is open to read: the phone and a second screen
 * still see the mission. Changing anything needs the operator's PIN, set in CP_PIN. With no CP_PIN
 * the coordinator stays open, as it was for the hackathon, so a laptop on a private network still
 * starts without a key.
 *
 * The cookie holds an HMAC of the PIN, not the PIN: a browser that has it can change the mission,
 * and one that has not cannot, but the value is useless anywhere else. Server only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const CP_COOKIE = "v2m_cp";

export function cpPin(): string | null {
  const pin = process.env.CP_PIN?.trim();
  return pin ? pin : null;
}

/** The cookie's value for a PIN. Stable across restarts, so an operator stays signed in. */
export function cpToken(pin: string): string {
  return createHmac("sha256", pin).update("command-post").digest("hex");
}

function cookieOf(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

/** True when the request may change the mission: no PIN set, or the operator's cookie matches. */
export function isOperator(req: Request): boolean {
  const pin = cpPin();
  if (!pin) return true;
  const got = cookieOf(req, CP_COOKIE);
  if (!got) return false;
  const want = cpToken(pin);
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A 401 for a changing request from a browser that did not unlock the command post. */
export function operatorDenied(req: Request): NextResponse | null {
  if (isOperator(req)) return null;
  return NextResponse.json({ error: "The command post is locked. Enter the operator PIN." }, { status: 401 });
}
