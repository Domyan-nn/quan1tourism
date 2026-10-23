# Vận hành local và chuẩn bị môi trường thật

## Phát triển

Backend tự đọc `.runtime/local.env` (gitignored); biến môi trường shell được ưu tiên. Máy local đã cấu hình PostgreSQL `quan1tourism`. Nếu không có `DATABASE_URL`, backend dùng SQLite `.runtime/quan1.db`. Media mặc định ở `.runtime/media`. Không tự đọc `.env`. `OLLAMA_BASE_URL` mặc định `http://127.0.0.1:11434`, `OLLAMA_MODEL` mặc định `qwen3:4b`; không có API key cloud.

Frontend Vite proxy `/api` tới 127.0.0.1:8000; trình duyệt không gửi token trong URL hay localStorage. Khi triển khai phải bố trí reverse proxy cùng origin cho `/api`; chưa có cấu hình reverse proxy/production trong repo này. Liên kết từ admin sang web hiện trỏ các cổng local được tài liệu hóa.

## Migration/seed

Chạy `uv run alembic upgrade head` trước khi khởi động API. Không gọi `create_all` lúc app khởi động. Chạy lại upgrade và seed không reset dữ liệu. PostgreSQL 18 local đã chạy migration tới `0004`. Có thể dùng `scripts/setup_postgresql.py --database quan1tourism --import-sqlite` để tạo DB và chuyển dữ liệu hiện có; script không ghi đè DB đã có dữ liệu. PostGIS không bắt buộc. Nếu có extension, tài khoản migration cần quyền cài extension để thêm cột địa lý và GIST index.

Trong màn hình thêm địa điểm, AI chỉ tạo dữ liệu điền vào biểu mẫu; chưa ghi POI cho tới khi nhấn Lưu nháp. API chỉ chấp nhận URL bài viết Wikipedia, tải API Wikimedia với giới hạn dung lượng/timeout và kiểm tra redirect. Nội dung AI trả về phải qua schema; tọa độ chỉ lấy từ Wikipedia/Wikidata, thiếu thì NULL. Một tiến trình backend chỉ chạy một lượt AI cùng lúc; lượt khác trả 429. Các ngôn ngữ bắt buộc luôn được sinh cùng các ngôn ngữ tùy chọn đã chọn. Endpoint trạng thái `/api/v1/admin/ai/status` và sinh nội dung `/api/v1/admin/ai/wikipedia` yêu cầu tài khoản nhân viên.

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
- Trước khi nâng migration, dừng backend cũ và sao lưu. `0003` chuẩn hóa văn bản; `0004` thêm nguồn nhập Wikipedia. Giữ các release, media và audio lịch sử; sau đó khởi động backend mới.
- Nếu AI chưa sẵn sàng, mở Ollama và kiểm tra model đã cài. Lỗi 502/503/504 có thể do nguồn Wikipedia, model hoặc timeout; giảm số ngôn ngữ rồi thử lại. Ảnh Commons hiển thị qua URL nguồn, cần Internet và được ghi công ngay cạnh nguồn bài viết.
- Nếu thiếu giọng đọc, kiểm tra ngôn ngữ/giọng đã cài trong hệ điều hành hoặc thử trình duyệt khác. Danh sách ngôn ngữ trong DB không bảo đảm mọi thiết bị có đủ 15 giọng.

## Công việc còn lại trước production

Không seed tài khoản demo. Cần luồng tạo admin/đổi mật khẩu, quản trị tài khoản và phân quyền nhiều vai trò; HTTPS/secure cookies; reverse proxy và CSP; giới hạn body/timeouts phía proxy; rate limit chia sẻ; kiểm tra PostgreSQL/PostGIS; migration rehearsal; lưu trữ S3; backup/restore; giám sát và load test thực tế. Đây là công việc chưa hoàn thành, không phải bằng chứng hệ thống đã sẵn sàng public.
