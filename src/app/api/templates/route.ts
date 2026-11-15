import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mapTemplate } from "@/lib/blissvoid/dto";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await db.template.findMany({
      orderBy: [{ featured: "desc" }, { uses: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ templates: rows.map(mapTemplate) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
