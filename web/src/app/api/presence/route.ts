import { NextResponse } from "next/server";
import { Err, presence, userFromReq } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const user = userFromReq(req), b = await req.json();
    if (!b.deviceId) return NextResponse.json({ ok: false });
    presence().set(String(b.deviceId), {
      user, deviceId: String(b.deviceId), label: String(b.label || "Device").slice(0, 40),
      page: String(b.page || "").slice(0, 80), seen: Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Err) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
