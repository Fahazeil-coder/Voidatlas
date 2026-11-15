import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const upsertSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(2000),
});

export async function GET() {
  try {
    const rows = await db.variable.findMany({ orderBy: { key: "asc" } });
    return NextResponse.json({
      variables: rows.map((row) => ({ id: row.id, key: row.key, value: row.value })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Variables need a key (max 80 chars) and a value (max 2000 chars)." },
        { status: 400 }
      );
    }
    const { key, value } = parsed.data;
    await db.variable.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
