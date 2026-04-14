import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { maybeFireReport } from "@/lib/telegram";

// POST /api/agent/heartbeat — Agent sends heartbeat every poll cycle
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { agentToken: token } });
  if (!user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    const activeProfiles = JSON.stringify(body.activeProfiles || []);
    // Use raw SQL to work even if Prisma client hasn't regenerated
    await prisma.$executeRaw`
      UPDATE "UserSettings"
      SET "agentLastSeen" = NOW(),
          "agentVersion" = ${body.version || null},
          "agentStatus" = ${body.status || 'idle'},
          "agentActiveUploads" = ${body.activeUploads || 0},
          "agentMessage" = ${body.message || null},
          "agentActiveProfiles" = ${activeProfiles}
      WHERE "userId" = ${user.id}
    `;
  } catch {
    // Silently fail — columns may not exist yet
  }

  // Fire periodic Telegram report if due (async, non-blocking)
  maybeFireReport(user.id).catch(() => {});

  return NextResponse.json({ ok: true });
}
