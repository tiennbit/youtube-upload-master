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
  const rawIds = Array.isArray(body.jobIds) ? body.jobIds : [];
  const jobIds = rawIds
    .map((v: unknown) => Number(v))
    .filter((v: number) => Number.isFinite(v))
    .map((v: number) => Math.floor(v));

  if (jobIds.length === 0) {
    return NextResponse.json({ deleted: 0, error: "jobIds required" }, { status: 400 });
  }

  const uniqueIds = Array.from(new Set(jobIds)).slice(0, 1000);

  const deleted = await prisma.upload.deleteMany({
    where: {
      id: { in: uniqueIds },
      channel: { userId: user.id },
    },
  });

  return NextResponse.json({ deleted: deleted.count });
}
