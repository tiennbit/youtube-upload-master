# 🚀 Hướng Dẫn Cài Đặt TubeFlow Agent — Windows 10/11

> Tài liệu này dành cho **người dùng cuối** muốn cài TubeFlow Agent lên máy tính Windows.  
> Thời gian cài đặt: khoảng **10–15 phút**.

---

## ✅ Yêu Cầu Trước Khi Cài

| Yêu cầu | Chi tiết |
|---------|---------|
| Hệ điều hành | Windows 10 hoặc Windows 11 (64-bit) |
| RAM | Tối thiểu 4 GB (khuyến nghị 8 GB) |
| Ổ đĩa | Tối thiểu 2 GB trống |
| Internet | Bắt buộc (để kết nối YouTube, Nextcloud, Server) |
| GoLogin | Tài khoản GoLogin đã có profiles đăng nhập YouTube |

---

## Bước 1 — Cài Node.js

1. Truy cập **https://nodejs.org**
2. Tải phiên bản **LTS** (ví dụ: `v20.x.x LTS`)
3. Chạy file `.msi` vừa tải → Next → Next → Install
4. Sau khi cài xong, mở **Command Prompt** (nhấn `Win + R`, gõ `cmd`, Enter)
5. Gõ lệnh kiểm tra:
   ```
   node -v
   ```
   Nếu hiển thị `v20.x.x` là thành công ✅

---

## Bước 2 — Tải TubeFlow Agent

### Cách 1: Tải file ZIP (đơn giản nhất)

1. Truy cập: **https://github.com/tiennbit/youtube-upload-master**
2. Click nút **`< > Code`** màu xanh → **Download ZIP**
3. Giải nén vào thư mục dễ nhớ, ví dụ: `C:\TubeFlow\`

### Cách 2: Dùng Git (nếu đã cài Git)

```cmd
git clone https://github.com/tiennbit/youtube-upload-master.git C:\TubeFlow
```

---

## Bước 3 — Cài Đặt Agent

1. Mở thư mục vừa giải nén → vào thư mục **`agent`**
2. Double-click vào file **`install-windows.bat`**

   > Nếu Windows hỏi *"Do you want to allow this app to make changes?"* → Click **Yes**

3. Script sẽ tự động:
   - Kiểm tra Node.js
   - Cài dependencies (`npm install`)
   - Build source code (`npm run build`)
   - Khởi động Agent

4. Lần đầu chạy, Agent hỏi:
   ```
   Server URL: https://your-tubeflow-server.com
   Agent Token: [nhập token từ Dashboard]
   ```

   - **Server URL**: Địa chỉ web TubeFlow của bạn (do admin cung cấp)
   - **Agent Token**: Copy từ Dashboard → Settings → Agent Token

5. Gõ `Y` để xác nhận → Agent bắt đầu chạy ✅

---

## Bước 4 — Cài Đặt Tự Động Khởi Động Cùng Windows

Để Agent tự chạy khi bật máy, không cần mở thủ công:

1. Tạo file `start-tubeflow.bat` ở Desktop với nội dung:
   ```batch
   @echo off
   cd /d C:\TubeFlow\agent
   echo Y | node dist/index.js
   ```

2. Nhấn `Win + R` → gõ `shell:startup` → Enter
3. Copy file `start-tubeflow.bat` vào thư mục vừa mở
4. Từ bây giờ Agent sẽ tự khởi động mỗi khi bật máy ✅

---

## Bước 5 — Kiểm Tra Hoạt Động

Khi Agent chạy thành công, cửa sổ CMD hiển thị:

```
╔══════════════════════════════════════╗
║     🚀 TubeFlow Desktop Agent        ║
║     Phiên bản: 1.0.0                 ║
╚══════════════════════════════════════╝

✅ Kết nối thành công! Server version: 1.0.0
✅ Agent Token hợp lệ
📋 Loaded upload history: X channels từ server

🤖 Agent đang chạy — poll mỗi 30s
```

**Các log quan trọng cần theo dõi:**

| Log | Ý nghĩa |
|-----|---------|
| `✅ Upload hoàn thành` | Video đã lên YouTube thành công |
| `❌ Upload thất bại` | Lỗi — xem chi tiết bên cạnh |
| `🔒 File đã bị lock` | Kênh khác đang xử lý file này — bình thường |
| `⏰ ngoài giờ hẹn` | Chưa đến giờ upload — bình thường |

---

## ❌ Xử Lý Lỗi Thường Gặp

### `Node.js chưa được cài đặt`
→ Cài Node.js theo Bước 1

### `Lỗi kết nối server`
→ Kiểm tra Server URL có đúng không (phải là `https://...`)  
→ Kiểm tra internet

### `Agent Token không hợp lệ`
→ Copy lại token từ Dashboard → Settings

### Cửa sổ CMD tự đóng sau vài giây
→ Chạy Agent trực tiếp từ CMD để xem lỗi:
```cmd
cd C:\TubeFlow\agent
node dist/index.js
```

### `Download failed: 404`
→ File video đã được kênh khác xử lý — Agent sẽ tự pick video mới tiếp theo

---

## 🔄 Cập Nhật Agent Khi Có Phiên Bản Mới

```cmd
cd C:\TubeFlow
git pull
cd agent
npm install
npm run build
```

Sau đó khởi động lại Agent.

---

## 📞 Hỗ Trợ

Gặp vấn đề? Liên hệ admin qua Telegram hoặc email đã được cung cấp.
