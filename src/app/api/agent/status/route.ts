import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET /api/agent/status — Check agent online/offline status
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Use raw query to avoid Prisma client cache issues with new fields
    const result = await prisma.$queryRaw<Array<{
      agentLastSeen: Date | null;
      agentVersion: string | null;
      agentStatus: string | null;
      agentActiveUploads: number;
      agentMessage: string | null;
    }>>`
      SELECT "agentLastSeen", "agentVersion", "agentStatus", "agentActiveUploads", "agentMessage"
      FROM "UserSettings"
      WHERE "userId" = ${userId}
      LIMIT 1
    `;

    const settings = result[0] || null;

    if (!settings?.agentLastSeen) {
      return NextResponse.json({
        online: false,
        lastSeen: null,
        message: "Agent chưa từng kết nối",
        offlineForSeconds: 999999,
      });
    }

    const lastSeen = new Date(settings.agentLastSeen);
    const diffMs = Date.now() - lastSeen.getTime();
    const online = diffMs < 90000; // 90 seconds = 3 poll cycles missed = offline

    return NextResponse.json({
      online,
      lastSeen: settings.agentLastSeen,
      version: settings.agentVersion,
      status: settings.agentStatus,
      activeUploads: settings.agentActiveUploads || 0,
      message: settings.agentMessage,
      offlineForSeconds: Math.floor(diffMs / 1000),
    });
  } catch (err: unknown) {
    // Fallback if columns don't exist yet
    return NextResponse.json({
      online: false,
      lastSeen: null,
      message: "Agent chưa từng kết nối",
      offlineForSeconds: 999999,
    });
  }
}
