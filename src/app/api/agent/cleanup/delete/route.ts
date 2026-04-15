import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// POST /api/agent/cleanup/delete
// Auth: Bearer <agentToken>
// Body: { jobIds: number[] }
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing agent token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { agentToken: token } });
  if (!user) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawIds: unknown[] = Array.isArray(body.jobIds) ? body.jobIds : [];
  const jobIds: number[] = [];
  for (const v of rawIds) {
    const n = Number(v);
    if (Number.isFinite(n)) jobIds.push(Math.floor(n));
  }

  if (jobIds.length === 0) {
    return NextResponse.json({ deleted: 0, error: "jobIds required" }, { status: 400 });
  }

  const uniqueIds: number[] = [];
  const seen = new Set<number>();
  for (const id of jobIds) {
    if (!seen.has(id) && uniqueIds.length < 1000) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  const deleted = await prisma.upload.deleteMany({
    where: {
      id: { in: uniqueIds },
      channel: { userId: user.id },
    },
  });

  return NextResponse.json({ deleted: deleted.count });
}
