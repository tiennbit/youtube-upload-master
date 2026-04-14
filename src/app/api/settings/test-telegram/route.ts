import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { sendTestMessage } from "@/lib/telegram";

// POST /api/settings/test-telegram — Test Telegram bot connection
export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { botToken, chatId } = await request.json();
  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "Bot Token va Chat ID la bat buoc" },
      { status: 400 }
    );
  }

  const success = await sendTestMessage(botToken, chatId);
  if (success) {
    return NextResponse.json({ success: true, message: "Da gui tin nhan test thanh cong!" });
  } else {
    return NextResponse.json(
      { success: false, error: "Khong gui duoc tin nhan. Kiem tra Bot Token va Chat ID." },
      { status: 400 }
    );
  }
}
