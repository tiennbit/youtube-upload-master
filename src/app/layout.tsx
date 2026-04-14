import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TubeFlow — YouTube Upload Automation",
  description:
    "Nền tảng tự động hóa upload video YouTube. Quản lý channels, lên lịch đăng video, kết nối GoLogin.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
