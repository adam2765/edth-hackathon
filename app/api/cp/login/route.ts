import { NextResponse } from "next/server";
import { CP_COOKIE, cpPin, cpToken, isOperator } from "@/lib/reports/auth";

const MAX_TRIES = 5;
const WINDOW_MS = 60_000;
const tries = new Map<string, number[]>();

function limited(ip: string, now: number): boolean {
  const list = (tries.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  tries.set(ip, list);
  if (tries.size > 5000) tries.clear();
  return list.length > MAX_TRIES;
}

function client(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** Whether the command post needs a PIN, and whether this browser has already given it. */
export async function GET(req: Request) {
  return NextResponse.json({ required: cpPin() != null, signedIn: isOperator(req) });
}

/** The operator's PIN: sets the HttpOnly cookie the changing routes check. */
export async function POST(req: Request) {
  const pin = cpPin();
  if (!pin) return NextResponse.json({ ok: true });
  if (limited(client(req), Date.now())) return NextResponse.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  let body: { pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (typeof body.pin !== "string" || body.pin !== pin) {
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append("Set-Cookie", `${CP_COOKIE}=${cpToken(pin)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`);
  return res;
}
