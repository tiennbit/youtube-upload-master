import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// GET /api/settings
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let settings = await prisma.userSettings.findUnique({ where: { userId } });

  if (!settings) {
    settings = await prisma.userSettings.create({ data: { userId } });
  }

  return NextResponse.json(settings);
}

// PUT /api/settings
export async function PUT(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const settings = await prisma.userSettings.upsert({
    where: { userId },
    update: {
      gologinToken: body.gologinToken !== undefined ? body.gologinToken : undefined,
      nextcloudUrl: body.nextcloudUrl !== undefined ? body.nextcloudUrl : undefined,
      nextcloudUsername: body.nextcloudUsername !== undefined ? body.nextcloudUsername : undefined,
      nextcloudPassword: body.nextcloudPassword !== undefined ? body.nextcloudPassword : undefined,
      autoUploadEnabled: body.autoUploadEnabled !== undefined ? body.autoUploadEnabled : undefined,
      maxConcurrent: body.maxConcurrent !== undefined ? body.maxConcurrent : undefined,
      telegramBotToken: body.telegramBotToken !== undefined ? body.telegramBotToken : undefined,
      telegramChatId: body.telegramChatId !== undefined ? body.telegramChatId : undefined,
      telegramEnabled: body.telegramEnabled !== undefined ? body.telegramEnabled : undefined,
      telegramReportCron: body.telegramReportCron !== undefined ? body.telegramReportCron : undefined,
      statsCollectInterval: body.statsCollectInterval !== undefined ? body.statsCollectInterval : undefined,
    },
    create: {
      userId,
      gologinToken: body.gologinToken || null,
      nextcloudUrl: body.nextcloudUrl || null,
      nextcloudUsername: body.nextcloudUsername || null,
      nextcloudPassword: body.nextcloudPassword || null,
      autoUploadEnabled: body.autoUploadEnabled ?? false,
      maxConcurrent: body.maxConcurrent ?? 3,
      telegramBotToken: body.telegramBotToken || null,
      telegramChatId: body.telegramChatId || null,
      telegramEnabled: body.telegramEnabled ?? false,
      telegramReportCron: body.telegramReportCron ?? 30,
      statsCollectInterval: body.statsCollectInterval ?? 120,
    },
  });

  return NextResponse.json(settings);
}
