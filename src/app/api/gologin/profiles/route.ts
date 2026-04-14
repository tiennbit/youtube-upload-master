import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import prisma from "@/lib/prisma";

// GET /api/gologin/profiles — fetch GoLogin profiles using user's token
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await prisma.userSettings.findUnique({ where: { userId } });

  if (!settings?.gologinToken) {
    return NextResponse.json({
      error: "Chưa cấu hình GoLogin API Token. Vào Cài đặt để nhập token.",
      profiles: [],
    }, { status: 400 });
  }

  try {
    const allProfiles: { id: string; name: string; os: string }[] = [];
    let page = 1;
    const PAGE_SIZE = 30;

    // Loop through all pages (GoLogin returns 30 profiles per page)
    while (true) {
      const res = await fetch(`https://api.gologin.com/browser/v2?page=${page}`, {
        headers: { Authorization: `Bearer ${settings.gologinToken}` },
      });

      if (!res.ok) {
        if (page === 1) {
          return NextResponse.json({
            error: "GoLogin API lỗi. Kiểm tra lại token.",
            profiles: [],
          }, { status: 502 });
        }
        break;
      }

      const data = await res.json();
      const pageProfiles = data.profiles || [];

      for (const p of pageProfiles) {
        allProfiles.push({ id: p.id, name: p.name, os: p.os });
      }

      // Stop if this page has fewer than PAGE_SIZE results (last page)
      if (pageProfiles.length < PAGE_SIZE) break;

      page++;

      // Safety limit: max 50 pages = 1500 profiles
      if (page > 50) break;
    }

    return NextResponse.json({ profiles: allProfiles });
  } catch {
    return NextResponse.json({
      error: "Không thể kết nối GoLogin API",
      profiles: [],
    }, { status: 502 });
  }
}
