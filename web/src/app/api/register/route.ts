import { NextResponse } from "next/server";
import { Err, register } from "@/lib/store";

export async function POST(req: Request) {
  try {
    const b = await req.json();
    return NextResponse.json(register(b.name, b.password));
  } catch (e) {
    if (e instanceof Err) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
