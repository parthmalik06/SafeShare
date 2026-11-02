import { NextResponse } from "next/server";
import { Err, presence, stateFor, userFromReq } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = stateFor(userFromReq(req));
    const now = Date.now();
    const devices = [...presence().values()].map((p) => ({ ...p, online: now - p.seen < 12000 })).filter((p) => now - p.seen < 120000);
    return NextResponse.json({ ...s, devices });
  } catch (e) {
    if (e instanceof Err) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
