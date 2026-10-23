# Vận hành local và chuẩn bị môi trường thật

## Phát triển

Mặc định backend dùng `.runtime/quan1.db` và `.runtime/media` theo thư mục gốc tuyệt đối do `app/db.py` tính. Không bắt buộc PostgreSQL/Docker để chạy luồng admin. Các biến môi trường dùng `os.getenv`; không tự đọc file `.env`. Với PowerShell, đặt `$env:DATABASE_URL`, `$env:MEDIA_ROOT`, `$env:COOKIE_SECURE` trước khi chạy.

Frontend Vite proxy `/api` tới 127.0.0.1:8000; trình duyệt không gửi token trong URL hay localStorage. Khi triển khai phải bố trí reverse proxy cùng origin cho `/api`; chưa có cấu hình reverse proxy/production trong repo này. Liên kết từ admin sang web hiện trỏ các cổng local được tài liệu hóa.

## Migration/seed

Chạy `uv run alembic upgrade head` trước khi khởi động API. Không gọi `create_all` lúc app khởi động. Chạy lại upgrade và seed không tạo dữ liệu lặp, không reset dữ liệu. Migration đầu không hỗ trợ destructive downgrade; khôi phục từ backup khi cần quay lại. Muốn chạy PostgreSQL, dùng URL `postgresql+psycopg://...`; database phải hỗ trợ PostGIS và tài khoản migration phải được phép tạo extension. Nhánh migration PostgreSQL chưa được kiểm thử trong phiên này.

## Sao lưu

1. Dừng API/worker ghi dữ liệu. Giữ frontend cũng được, nhưng người dùng phải ngừng thao tác.
2. Sao chép `.runtime/quan1.db` và **toàn bộ** `.runtime/media` cùng thời điểm sang thư mục backup riêng. DB chứa văn bản thuyết minh; media chứa ảnh và có thể có tệp audio lịch sử từ bản cũ.
3. Với PostgreSQL, dùng `pg_dump` và sao lưu media cùng phiên bản, ghi lại revision Alembic và commit source.
4. Kiểm tra file tồn tại, dung lượng/checksum; thử khôi phục vào database và thư mục media khác trước khi dùng cho môi trường thật.

Để khôi phục, đặt DATABASE_URL/MEDIA_ROOT trỏ vào bản sao trong môi trường riêng, khởi động và kiểm tra `/health/ready`, đăng nhập, mở địa điểm và nghe TTS từ văn bản. Không ghi đè database đang chạy. Chưa thực hiện drill backup/restore production.

## Theo dõi lỗi

- `/api/v1/health/live`: process hoạt động.
- `/api/v1/health/ready`: truy cập được bảng users (migration/database sẵn sàng).
- API trả `X-Request-ID` để đối chiếu request. Uvicorn log thông thường; chưa tích hợp kho log tập trung.
- Khi API không kết nối, giao diện hiển thị lỗi và nút thử lại. Đang nhập trong dialog thì nội dung còn trong bộ nhớ màn hình; chưa có lưu nháp offline tự động. Lưu thành công chỉ được báo khi backend trả thành công.
- TTS đọc trực tiếp văn bản của phiên bản đã xuất bản; thay đổi bản nháp cần duyệt/xuất bản lại. HTTP 409 nghĩa là revision đã thay đổi; mở lại nội dung để lấy bản mới.
- Trước khi nâng lên `0003`, dừng backend cũ, sao lưu và chạy migration; sau đó khởi động backend mới. Migration chuyển toàn bộ tiêu đề/văn bản sang bảng chuẩn hóa, giữ các release và media cũ. Không tự xóa tệp audio lịch sử.
- Nếu thiếu giọng đọc, kiểm tra ngôn ngữ/giọng đã cài trong hệ điều hành hoặc thử trình duyệt khác. Danh sách ngôn ngữ trong DB không bảo đảm mọi thiết bị có đủ 15 giọng.

## Công việc còn lại trước production

Không seed tài khoản demo. Cần luồng tạo admin/đổi mật khẩu, quản trị tài khoản và phân quyền nhiều vai trò; HTTPS/secure cookies; reverse proxy và CSP; giới hạn body/timeouts phía proxy; rate limit chia sẻ; kiểm tra PostgreSQL/PostGIS; migration rehearsal; lưu trữ S3; backup/restore; giám sát và load test thực tế. Đây là công việc chưa hoàn thành, không phải bằng chứng hệ thống đã sẵn sàng public.
