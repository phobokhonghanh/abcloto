# Lô Tô Hát Số - Hướng Dẫn Triển Khai (Deployment Guide)

Tài liệu này cung cấp hướng dẫn chi tiết về cách cài đặt, cấu hình và vận hành hệ thống **Lô Tô Hát Số** trong môi trường Production và Development.

---

## 1. Tổng Quan
**Lô Tô Hát Số** là ứng dụng web thời gian thực (Real-time Web App) hỗ trợ tổ chức trò chơi Lô Tô với các tính năng:
*   Hô số tự động (kết hợp Audio có sẵn và Text-to-Speech).
*   Đồng bộ hóa trạng thái game và nhạc nền giữa tất cả thiết bị.
*   Giao diện quản trị (Admin) và hiển thị (Display) tách biệt.

## 2. Yêu Cầu Hệ Thống (Prerequisites)
Để vận hành hệ thống, máy chủ hoặc máy tính cá nhân cần đáp ứng:
*   **Hệ điều hành**: Linux (Ubuntu/Debian recommended), macOS, hoặc Windows.
*   **Python**: Phiên bản 3.8 trở lên (nếu chạy trực tiếp).
*   **Docker**: Khuyến nghị để triển khai nhanh chóng (Koyeb, Railway, VPS).
*   **Mạng**: Cần kết nối mạng nội bộ (LAN) hoặc Internet để các thiết bị khác truy cập.

## 3. Cài Đặt (Installation)

### Bước 1: Chuẩn bị mã nguồn
Tải thư mục dự án về máy hoặc clone từ repository (nếu có).
```bash
cd abcloto
```

### Bước 2: Tạo môi trường ảo (Virtual Environment)
Khuyến nghị sử dụng môi trường ảo để quản lý thư viện, tránh xung đột với hệ thống.

**Linux / macOS:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows:**
```bash
python -m venv venv
venv\Scripts\activate
```

### Bước 3: Cài đặt thư viện phụ thuộc
Sử dụng `pip` để cài đặt các gói cần thiết từ `requirements.txt`:
```bash
pip install -r requirements.txt
```
*Các thư viện chính: `fastapi`, `uvicorn`, `pydantic`, `gTTS`, `mutagen`, `pydub`.*

## 4. Vận Hành (Running the Application)

### Cách 1: Sử dụng Script tự động (Khuyên dùng cho Linux/Mac)
Dự án cung cấp sẵn script `start.sh` để tự động kích hoạt môi trường và khởi chạy server.
```bash
./start.sh
```
*Lưu ý: Cần cấp quyền thực thi cho script trước lần chạy đầu tiên: `chmod +x start.sh`*

### Cách 2: Chạy thủ công
Nếu bạn muốn chạy trực tiếp hoặc cần debug:
```bash
# Đảm bảo đã kích hoạt venv
uvicorn app:app --host 0.0.0.0 --port 8000
```

### Cách 3: Sử dụng Docker (Khuyên dùng cho Server/Koyeb)
Phương pháp này giúp cài đặt sẵn các phụ thuộc hệ thống như **FFmpeg** mà không cần cấu hình bằng tay.

1.  **Build Image**:
    ```bash
    docker build -t abcloto-app .
    ```

2.  **Chạy Container**:
    ```bash
    docker run -d -p 8000:8000 --name loto-app abcloto-app
    ```

## 5. Cấu Trúc Dự Án (Project Structure)
```
abcloto/
├── app.py              # Mã nguồn chính (Server FastAPI)
├── Dockerfile          # Cấu hình đóng gói Docker
├── requirements.txt    # Danh sách thư viện phụ thuộc
├── start.sh            # Script khởi chạy nhanh
├── static/             # Tài nguyên tĩnh (Frontend)
│   ├── index.html      # Giao diện người chơi
│   ├── admin.html      # Giao diện quản trị viên
│   ├── cutter.html     # Công cụ cắt nhạc
│   ├── style.css       # CSS chung
│   └── js/             # Mã nguồn JavaScript
├── data/               # Dữ liệu âm thanh
│   ├── songs/          # Nhạc hô số & Nhạc nền
│   └── ...
└── DEPLOYMENT.md       # Tài liệu này
```

## 6. Xử Lý Sự Cố (Troubleshooting)

### Lỗi "Address already in use" (Port 8000 bị chiếm dụng)
Nếu không chạy được do cổng 8000 đang được sử dụng bởi ứng dụng khác:
1.  **Tìm tiến trình đang chiếm dụng**:
    ```bash
    fuser -k 8000/tcp
    ```
    *(Script `start.sh` đã tích hợp sẵn lệnh này để tự động giải phóng cổng)*

2.  **Đổi cổng**: Chạy lệnh với tham số port khác, ví dụ 8080:
    ```bash
    uvicorn app:app --host 0.0.0.0 --port 8080
    ```

### Lỗi "ModuleNotFoundError" trong Docker
Đảm bảo bạn đã build lại image sau khi cập nhật `requirements.txt`:
```bash
docker build -t abcloto-app .
```

---
*Tài liệu được cập nhật lần cuối: 2026-02-15*
