import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// POST /api/uploads/[id]/retry
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const upload = await prisma.upload.findFirst({
    where: { id: Number(id), channel: { userId } },
  });

  if (!upload) {
    return NextResponse.json({ error: "Upload không tìm thấy" }, { status: 404 });
  }

  const updated = await prisma.upload.update({
    where: { id: Number(id) },
    data: { status: "PENDING", error: null },
  });

  return NextResponse.json(updated);
}
