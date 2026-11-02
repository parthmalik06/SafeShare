import { NextResponse } from "next/server";
import { Err, perform, userFromReq } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const b = await req.json();
    return NextResponse.json({ ok: true, ...perform({ ...b, actor: userFromReq(req) }) });
  } catch (e) {
    if (e instanceof Err) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
