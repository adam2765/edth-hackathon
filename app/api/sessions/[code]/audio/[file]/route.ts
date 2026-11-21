import { NextResponse } from "next/server";
import { AUDIO_FILE, getStore } from "@/lib/reports/store";
import { sessionCode } from "@/lib/reports/types";

const TYPES: Record<string, string> = {
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  caf: "audio/x-caf",
  webm: "audio/webm",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  bin: "application/octet-stream",
};

/** A held radio report's recording, for the operator to listen to [203]: `GET /api/sessions/<code>/audio/<file>`. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[code]/audio/[file]">) {
  const { code, file } = await ctx.params;
  const session = sessionCode(code);
  if (!session || !AUDIO_FILE.test(file)) return NextResponse.json({ error: "No such recording." }, { status: 404 });
  try {
    const data = await getStore().readAudio(session, file);
    if (!data) return NextResponse.json({ error: "No such recording." }, { status: 404 });
    const ext = file.slice(file.lastIndexOf(".") + 1);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Content-Length": String(data.length), "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    console.error("reading the recording failed", err);
    return NextResponse.json({ error: "Reading the recording failed." }, { status: 500 });
  }
}
