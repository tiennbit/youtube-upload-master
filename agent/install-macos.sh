#!/bin/bash
echo ""
echo "========================================"
echo "  TubeFlow Desktop Agent - Cài Đặt"
echo "========================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "[!] Node.js chưa được cài đặt!"
    echo "    Tải và cài đặt từ: https://nodejs.org"
    echo "    Hoặc chạy: brew install node (macOS)"
    echo ""
    exit 1
fi

echo "[OK] Node.js đã cài đặt"
echo "     Phiên bản: $(node -v)"
echo ""

# Install dependencies
echo "[*] Đang cài đặt dependencies..."
cd "$(dirname "$0")"
npm install
if [ $? -ne 0 ]; then
    echo "[!] Lỗi cài đặt dependencies!"
    exit 1
fi
echo "[OK] Dependencies đã cài đặt"
echo ""

# Build
echo "[*] Đang build agent..."
npm run build
if [ $? -ne 0 ]; then
    echo "[!] Lỗi build!"
    exit 1
fi
echo "[OK] Build thành công"
echo ""

# Run
echo "========================================"
echo "  Khởi động TubeFlow Agent..."
echo "========================================"
echo ""
node dist/index.js
