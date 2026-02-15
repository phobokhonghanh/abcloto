# Giới Thiệu & Hướng Dẫn Sử Dụng - Lô Tô Hát Số

Chào mừng bạn đến với hệ thống **Lô Tô Hát Số**! Đây là hệ thống chuyên nghiệp giúp bạn tổ chức chơi lô tô với trải nghiệm âm thanh sống động và đồng bộ.

## 1. Các thành phần chính

### A. Trang Hiển Thị (Dành cho Người chơi)
Truy cập tại: `/` (Trang chủ)
*   Hiển thị bảng số 100 số (từ 00 đến 99).
*   Số được hô sẽ sáng lên (màu vàng) và số mới nhất sẽ nhấp nháy (màu đỏ).
*   **Nút Mute (Loa)**: Ở góc trên bên phải, giúp người chơi tắt âm thanh riêng trên máy mình nếu không muốn nghe.

### B. Trang Quản Trị (Dành cho Admin)
Truy cập tại: `/admin`
*   **Hô số**: Chọn bài hát hoặc dùng TTS để hô số.
*   **Điều khiển nhạc nền**: Bật/tắt nhạc nền, điều chỉnh âm lượng.
*   **Tự động giảm nhạc**: Khi có tiếng hô số, nhạc nền sẽ tự động giảm âm lượng (Ducking) để tiếng hô rõ hơn.

## 2. Các tính năng đặc sắc

### 1. Đồng bộ hóa thời gian thực (SSE)
Tất cả các hành động trên trang Admin (quay số, dừng, reset) sẽ ngay lập tức xuất hiện trên tất cả các màn hình hiển thị của người chơi mà không cần tải lại trang.

### 2. Đồng bộ nhạc nền (Audio Sync)
Nhạc nền giữa máy Admin và tất cả máy người chơi được đồng bộ nhịp điệu với nhau dựa trên thời gian thực từ Server. Nếu một người chơi vào sau, nhạc sẽ tự động nhảy đến đúng đoạn mà mọi người đang nghe.

### 3. Tạm dừng toàn hệ thống (Global Pause)
Khi Admin bấm **Tạm dừng**, tất cả âm thanh (nhạc nền và tiếng hô) trên máy người chơi cũng sẽ dừng lại ngay lập tức. Khi Admin bấm tiếp tục, âm thanh sẽ phát tiếp đồng nhất.

### 4. Chế độ Mute riêng biệt
*   **Mute trên Admin**: Admin có thể tắt tiếng máy mình để theo dõi bảng số mà không bị lẫn âm thanh nếu đang ở gần loa tổng.
*   **Mute trên Display**: Người chơi có thể tự tắt tiếng trên thiết bị cá nhân mà không làm ảnh hưởng đến loa chung của hội trường.

### 3. Công cụ Cắt Nhạc (Song Cutter)
Truy cập tại: `/static/cutter.html` (hoặc đường dẫn quản trị riêng).

Công cụ này giúp bạn tự tạo dữ liệu hô số từ các bài nhạc MP3.
1.  **Upload nhạc**: Copy file MP3 vào thư mục `data/songs/full/`.
2.  **Chọn bài hát**: Mở công cụ Cutter, chọn bài hát từ danh sách.
3.  **Cắt đoạn**:
    *   Nghe nhạc (Space để Play/Pause).
    *   Nhấn **[W]** để đánh dấu điểm bắt đầu (Start).
    *   Nhấn **[E]** để đánh dấu điểm kết thúc (End).
    *   Nhập số lô tô tương ứng vào ô Input.
    *   Nhấn **Lưu (Save)**.
4.  **Kết quả**: File cắt sẽ được lưu vào `data/songs/number/{số}/` và sẵn sàng để sử dụng trong game.

## 3. Hướng dẫn thao tác Admin nhanh
1.  Nhấn **Bắt đầu** để phát nhạc hiệu.
2.  Bật **Nhạc nền** nếu muốn không khí sôi động.
3.  Khi muốn hô số: Nhấn vào số tương ứng trên bảng Admin hoặc nhấn **Hô số ngẫu nhiên**.
4.  Nếu hô nhầm hoặc muốn bỏ qua: Nhấn **Qua lượt (Skip)**, tiếng hô cũ sẽ dừng ngay lập tức.
5.  Khi có người trúng: Nhấn **Kinh!** để phát nhạc chúc mừng.
6.  Xong ván: Nhấn **Reset Game** để làm mới bảng số cho ván sau.
