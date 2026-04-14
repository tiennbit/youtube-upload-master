import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// POST /api/gologin/start-profile — Start a GoLogin profile directly via GoLogin Cloud API
export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profileId } = await request.json();
  if (!profileId) {
    return NextResponse.json({ error: "profileId required" }, { status: 400 });
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings?.gologinToken) {
    return NextResponse.json({
      error: "Chưa cấu hình GoLogin API Token. Vào Cài đặt để nhập token.",
    }, { status: 400 });
  }

  try {
    // Check if agent is currently using this profile (lock mechanism)
    try {
      const agentLock = await prisma.$queryRaw<
        { agentActiveProfiles: string | null; agentLastSeen: Date | null }[]
      >`SELECT "agentActiveProfiles", "agentLastSeen" FROM "UserSettings" WHERE "userId" = ${userId}`;

      if (agentLock[0]?.agentActiveProfiles && agentLock[0]?.agentLastSeen) {
        const lastSeen = new Date(agentLock[0].agentLastSeen).getTime();
        const isAgentAlive = Date.now() - lastSeen < 2 * 60 * 1000; // 2 minutes

        if (isAgentAlive) {
          const activeProfiles: string[] = JSON.parse(agentLock[0].agentActiveProfiles);
          if (activeProfiles.includes(profileId)) {
            return NextResponse.json({
              error: "Profile đang được agent sử dụng. Vui lòng đợi agent hoàn thành upload.",
            }, { status: 409 });
          }
        }
      }
    } catch {
      // Non-blocking — if lock check fails, allow starting (column may not exist yet)
    }

    // Start the profile in GoLogin cloud
    const startRes = await fetch(`https://api.gologin.com/browser/${profileId}/web`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.gologinToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!startRes.ok) {
      const errorText = await startRes.text();
      return NextResponse.json({
        error: `GoLogin API lỗi (${startRes.status}): ${errorText}`,
      }, { status: 502 });
    }

    const data = await startRes.json();

    return NextResponse.json({
      success: true,
      wsUrl: data.wsUrl || data.ws_url || null,
      message: `Profile đã được khởi chạy trên GoLogin Cloud. Mở GoLogin app để xem.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({
      error: `Không thể kết nối GoLogin API: ${message}`,
    }, { status: 502 });
  }
}

// DELETE /api/gologin/start-profile — Stop a GoLogin cloud profile
export async function DELETE(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profileId } = await request.json();
  if (!profileId) {
    return NextResponse.json({ error: "profileId required" }, { status: 400 });
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings?.gologinToken) {
    return NextResponse.json({ error: "Token not found" }, { status: 400 });
  }

  try {
    await fetch(`https://api.gologin.com/browser/${profileId}/web`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${settings.gologinToken}` },
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to stop profile" }, { status: 502 });
  }
}
