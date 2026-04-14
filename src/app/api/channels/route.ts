import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// GET /api/channels — list user's channels
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const channels = await prisma.channel.findMany({
    where: { userId },
    include: { _count: { select: { uploads: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(channels);
}

// POST /api/channels — create channel
export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: "Tên channel là bắt buộc" }, { status: 400 });
    }

    if (!body.studioUrl || !/^https:\/\/studio\.youtube\.com\/channel\/UC/.test(body.studioUrl)) {
      return NextResponse.json({ error: "Studio URL bắt buộc và phải có dạng: https://studio.youtube.com/channel/UC..." }, { status: 400 });
    }

    const channel = await prisma.channel.create({
      data: {
        userId,
        name: body.name,
        slug: body.slug || null,
        gologinProfileId: body.gologinProfileId || null,
        studioUrl: body.studioUrl,
        nextcloudFolder: body.nextcloudFolder || null,
        uploadVisibility: body.uploadVisibility || "public",
        uploadStartHour: body.uploadStartHour ?? 8,
        uploadEndHour: body.uploadEndHour ?? 22,
        uploadInterval: body.uploadInterval ?? 30,
      },
    });

    return NextResponse.json(channel, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002" || error?.message?.includes("Unique constraint")) {
      return NextResponse.json({ error: "Channel với tên này đã tồn tại" }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
