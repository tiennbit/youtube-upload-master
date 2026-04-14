import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { sendPeriodicReport } from "@/lib/telegram";

// POST /api/settings/send-report — Manually trigger a Telegram report
export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const success = await sendPeriodicReport(userId);
  if (success) {
    return NextResponse.json({ success: true });
  } else {
    return NextResponse.json(
      { success: false, error: "Khong gui duoc bao cao. Kiem tra cau hinh Telegram va dam bao da co it nhat 1 channel." },
      { status: 400 }
    );
  }
}
