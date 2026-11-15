import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { seedDatabase } from "@/lib/blissvoid/seed-data";

export const runtime = "nodejs";

export async function POST() {
  try {
    const existing = await db.workflow.count();
    if (existing > 0) {
      return NextResponse.json({ seeded: false });
    }
    await seedDatabase();
    return NextResponse.json({ seeded: true });
  } catch (err) {
    console.error(
      "[blissvoid] seed failed:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Seeding failed" },
      { status: 500 }
    );
  }
}
