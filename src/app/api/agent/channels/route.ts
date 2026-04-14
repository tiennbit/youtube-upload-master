import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agent/channels — Agent gets list of channels for scanning
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing agent token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({ where: { agentToken: token } });
  if (!user) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  const channels = await prisma.channel.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      nextcloudFolder: true,
      uploadEnabled: true,
      gologinProfileId: true,
      lastUpload: true,
      studioUrl: true,
    },
  });

  // Include stats collection settings for agent
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
    select: {
      statsCollectInterval: true,
      statsLastCollect: true,
    },
  });

  return NextResponse.json({
    channels,
    statsCollectInterval: settings?.statsCollectInterval ?? 120,
    statsLastCollect: settings?.statsLastCollect ?? null,
  });
}
