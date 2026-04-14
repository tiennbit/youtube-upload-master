import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// DELETE /api/channels/[id]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const channel = await prisma.channel.findFirst({
    where: { id: Number(id), userId },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel không tìm thấy" }, { status: 404 });
  }

  await prisma.channel.delete({ where: { id: Number(id) } });
  return NextResponse.json({ success: true });
}

// PUT /api/channels/[id]
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const channel = await prisma.channel.findFirst({
    where: { id: Number(id), userId },
  });

  if (!channel) {
    return NextResponse.json({ error: "Channel không tìm thấy" }, { status: 404 });
  }

  const updated = await prisma.channel.update({
    where: { id: Number(id) },
    data: {
      name: body.name ?? undefined,
      slug: body.slug !== undefined ? body.slug : undefined,
      gologinProfileId: body.gologinProfileId !== undefined ? body.gologinProfileId : undefined,
      studioUrl: body.studioUrl !== undefined ? body.studioUrl : undefined,
      nextcloudFolder: body.nextcloudFolder !== undefined ? body.nextcloudFolder : undefined,
      uploadEnabled: body.uploadEnabled !== undefined ? body.uploadEnabled : undefined,
      uploadVisibility: body.uploadVisibility !== undefined ? body.uploadVisibility : undefined,
      uploadStartHour: body.uploadStartHour !== undefined ? body.uploadStartHour : undefined,
      uploadEndHour: body.uploadEndHour !== undefined ? body.uploadEndHour : undefined,
      uploadInterval: body.uploadInterval !== undefined ? body.uploadInterval : undefined,
    },
  });

  return NextResponse.json(updated);
}
