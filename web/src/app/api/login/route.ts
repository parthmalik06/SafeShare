import { NextResponse } from "next/server";
import { Err, login, logout } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const b = await req.json();
    if (b.logout) { logout(req.headers.get("x-session") || ""); return NextResponse.json({ ok: true }); }
    return NextResponse.json(login(b.name, b.password));
  } catch (e) {
    if (e instanceof Err) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
