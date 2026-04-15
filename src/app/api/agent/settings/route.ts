import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agent/settings — Agent fetches settings without claiming a job
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing agent token" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const user = await prisma.user.findUnique({
    where: { agentToken: token },
    include: { settings: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  const settings = user.settings;

  return NextResponse.json({
    settings: settings
      ? {
          gologinToken: settings.gologinToken,
          nextcloudUrl: settings.nextcloudUrl,
          nextcloudUsername: settings.nextcloudUsername,
          nextcloudPassword: settings.nextcloudPassword,
          maxConcurrent: settings.maxConcurrent ?? 3,
          autoUploadEnabled: settings.autoUploadEnabled ?? false,
        }
      : null,
  });
}
