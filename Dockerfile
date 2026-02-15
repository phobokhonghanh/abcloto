# Sử dụng Python bản slim để dung lượng nhẹ nhưng vẫn đủ dùng
FROM python:3.10-slim

# Cài đặt FFmpeg và các công cụ hệ thống cần thiết
RUN apt-get update && apt-get install -y \
    ffmpeg \
    psmisc \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Copy file requirements và cài đặt các thư viện Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ mã nguồn vào container
COPY . .

# Tạo các thư mục cần thiết và cấp quyền (đề phòng)
RUN mkdir -p data/songs/full data/songs/number data/songs/background data/songs/start data/songs/end static/temp data/lyrics

# Mở cổng 8000 (Cổng mặc định của ứng dụng)
EXPOSE 8000

# Chạy ứng dụng bằng Uvicorn
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
