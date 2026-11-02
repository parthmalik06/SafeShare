import { NextResponse } from "next/server";
import { Err, makeToken, peek, userFromReq } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/qr?loan=<id>&purpose=handover|return  -> signed, 10-minute code (borrower side)
// GET /api/qr?token=<token>                      -> what the code says (owner side, before confirming)
// Who is asking comes from the session header, never from the URL.
export async function GET(req: Request) {
  try {
    const user = userFromReq(req), q = new URL(req.url).searchParams;
    if (q.get("token")) return NextResponse.json(peek(user, q.get("token")!));
    return NextResponse.json(makeToken(user, q.get("loan") || "", q.get("purpose") || ""));
  } catch (e) {
    if (e instanceof Err) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
