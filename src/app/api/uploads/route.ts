import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// GET /api/uploads — list user's uploads
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uploads = await prisma.upload.findMany({
    where: { channel: { userId } },
    include: { channel: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(uploads);
}
