import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { mapCredential } from "@/lib/blissvoid/dto";
import { encryptJSON } from "@/lib/engine/crypto";
import { CREDENTIAL_TYPES } from "@/lib/blissvoid/types";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1),
  data: z.record(z.string(), z.string()),
});

export async function GET() {
  try {
    const rows = await db.credential.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ credentials: rows.map(mapCredential) });
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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide a name, a known type and a data object of string fields" },
        { status: 400 }
      );
    }
    const { name, type, data } = parsed.data;
    if (!CREDENTIAL_TYPES.some((t) => t.value === type)) {
      return NextResponse.json(
        { error: `Unknown credential type "${type}"` },
        { status: 400 }
      );
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Credential data cannot be empty" }, { status: 400 });
    }

    const credential = await db.credential.create({
      data: {
        name: name.trim(),
        type,
        dataEnc: encryptJSON(data),
        status: "unverified",
      },
    });

    await db.activityLog.create({
      data: {
        kind: "credential.added",
        message: `Credential "${credential.name}" (${type}) was added to the vault`,
      },
    });

    return NextResponse.json({ credential: mapCredential(credential) }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
