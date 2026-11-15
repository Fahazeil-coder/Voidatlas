import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const variable = await db.variable.findUnique({ where: { id } });
    if (!variable) {
      return NextResponse.json({ error: "Variable not found" }, { status: 404 });
    }
    await db.variable.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
