# Saigon Stories · Quận 1 Tourism

Trang quản trị nội dung thuyết minh du lịch bằng **React + TypeScript**, kết nối **FastAPI + SQLAlchemy + Alembic**. Tiếng Việt mặc định, có giao diện tiếng Anh và cỡ chữ lớn. Bản triển khai này tập trung vào Giai đoạn 0–1 và yêu cầu **admin dễ dùng với mọi người**.

## Chạy local

Cần Node.js **22.12 trở lên**, Python **3.12** và [uv](https://docs.astral.sh/uv/). Không cần Docker. Trong phiên triển khai đã tải Node portable vào `.tools/node-v22.22.0-win-x64`; thư mục này không đưa vào Git.

Mở PowerShell tại thư mục dự án. Nếu chưa có Node trên PATH nhưng đã có bản portable:

```powershell
$env:Path = "$PWD\.tools\node-v22.22.0-win-x64;" + $env:Path
```

Cài frontend một lần:

```powershell
npm ci
```

Terminal 1 — backend:

```powershell
cd services/backend
uv sync --frozen
uv run alembic upgrade head
uv run python -m app.seed --demo
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2 — admin, từ thư mục gốc:

```powershell
npm run dev
```

Terminal 3 — trang du khách, từ thư mục gốc:

```powershell
npm run dev:web
```

- Admin: <http://127.0.0.1:5173>
- Du khách: <http://127.0.0.1:5174>
- API/OpenAPI: <http://127.0.0.1:8000/docs>

Hoặc sau khi cài dependencies và chạy migration/seed, từ thư mục gốc chạy **`npm.cmd run start:local`** để mở cả ba máy chủ trong một terminal. Dừng bằng **Ctrl+C** hoặc phím **q**. Trên Linux/macOS dùng `npm run start:local`. Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` cho các lệnh npm ở trên; không cần thay đổi chính sách thực thi của máy.

## Tài khoản demo local

Chỉ được tạo khi chủ động chạy seed với `--demo`. Đây là thông tin đăng nhập công khai cho môi trường phát triển, **không dùng để triển khai thật**.

| Vai trò | Email | Mật khẩu demo |
| --- | --- | --- |
| Quản trị viên | `admin@quan1.local` | `Quan1Demo!2026` |
| Biên tập viên | `editor@quan1.local` | `Quan1Demo!2026` |
| Người duyệt | `reviewer@quan1.local` | `Quan1Demo!2026` |

Nút “Trải nghiệm tài khoản demo” thực hiện đăng nhập thật bằng tài khoản admin local. Không có cơ chế bỏ qua đăng nhập. Phiên cookie HttpOnly hết hạn sau 8 giờ và được thu hồi khi đăng xuất.

## Admin sử dụng thế nào?

1. **Địa điểm:** tìm bằng tên hoặc địa chỉ, có thể gõ không dấu; lọc danh mục/trạng thái; đổi danh sách/thẻ; phân trang.
2. **Thêm địa điểm:** nhập tên, danh mục, địa chỉ và ảnh. Tọa độ nằm trong phần nâng cao để biểu mẫu dễ đọc.
3. **Nội dung đa ngôn ngữ:** nhập tiêu đề và bài thuyết minh ở hai tab Tiếng Việt/English. Có số ký tự và thời gian đọc ước tính.
4. **Bản ghi âm:** tải audio riêng cho mỗi ngôn ngữ và nghe thử. Tệp được kiểm tra nội dung thực tế, định dạng, kích thước, thời lượng.
5. **Kiểm tra & gửi duyệt:** checklist chỉ ra phần còn thiếu. Lưu nháp bất cứ lúc nào; chỉ gửi duyệt khi đủ hai ngôn ngữ và audio hợp lệ.
6. **Người duyệt:** mở nội dung chờ duyệt, nghe thử, yêu cầu sửa kèm lý do hoặc duyệt; sau đó xuất bản.
7. **Du khách:** chỉ nhận bản đã xuất bản; đổi ngôn ngữ, nghe, tua, đổi tốc độ và đọc bài thuyết minh.

Biên tập viên không thể tự duyệt/xuất bản; backend kiểm tra quyền cho mọi thao tác. Khi sửa địa điểm đã xuất bản, du khách tiếp tục nhận phiên bản cũ. Đổi văn bản làm audio cũ hết hiệu lực cho bản nháp và phải tải bản ghi âm phù hợp. Lưu trữ ẩn địa điểm; có thể mở lại thành nháp. Khôi phục phiên bản cũ tạo bản nháp mới và phải đi qua quy trình duyệt lại.

**Hướng dẫn sử dụng** luôn có trong menu và cuối trang. **Tùy chỉnh giao diện** cho phép dùng chữ lớn và đổi ngôn ngữ; lưu tùy chọn trên thiết bị. Dialog có quản lý focus, Escape và điều khiển bằng bàn phím. Khi đóng bản nháp chưa lưu, hệ thống yêu cầu xác nhận bỏ thay đổi.

## Dữ liệu và tệp

- Seed an toàn khi chạy lại: thêm bản ghi còn thiếu theo ID cố định, không ghi đè nội dung đã sửa.
- 12 địa điểm mẫu, 4 danh mục; tất cả ở trạng thái **bản nháp**, chưa có audio thuyết minh. Đây không phải dữ liệu du lịch được kiểm chứng. Nguồn/quyền sử dụng: [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).
- Không tạo giọng đọc giả, không báo dịch/TTS thành công. Nhập bản dịch và upload audio thủ công hoạt động mà không cần khóa API.
- Tệp nháp nằm sau endpoint có xác thực. Tệp đã từng phát hành được giữ để bảo toàn URL của các phiên bản đã phát hành; lưu trữ địa điểm không thu hồi các URL media đã công khai trước đó.
- Lưu local mặc định ở `.runtime/` (đã gitignore). Không có khóa bí mật trong mã nguồn.
- `.env.example` là tài liệu biến môi trường, ứng dụng không tự đọc `.env`. Thiết lập biến bằng `$env:DATABASE_URL = '...'`. Đường dẫn tương đối trong biến môi trường được tính theo thư mục chạy backend; mặc định không cần thiết lập biến nào.

## Kiểm tra lại

```powershell
# Từ thư mục gốc
npm run typecheck
npm run build
npm run test:e2e

# Từ services/backend
uv run pytest -q
uv run ruff check app tests
```

E2E mặc định dùng Edge đã cài trên Windows, hai viewport desktop và Pixel 7 mô phỏng. Trên máy khác, cài Edge hoặc đổi `channel` trong `playwright.config.mjs` và cài trình duyệt tương ứng. E2E tự khởi động API tại 8010 và frontend tại 5183/5184, dùng database và media tạm riêng, không ghi vào dữ liệu local. Tệp WAV im lặng trong tests chỉ là fixture kiểm tra codec/luồng phát, không phải audio thuyết minh mẫu. Ảnh chụp ở `.runtime/screenshots`, báo cáo ở `playwright-report/`.

Xem [báo cáo kiểm thử](docs/TEST-REPORT.md), [kiến trúc/API](docs/ARCHITECTURE.md), [vận hành](docs/OPERATIONS.md) và [CHECKLIST.md](CHECKLIST.md) để biết phần đã xác minh và giới hạn còn lại.

## Giới hạn hiện tại

Luồng nội dung Giai đoạn 1 có backend thật. Chưa triển khai tour, Expo/mobile, quét QR, GPS, PWA/offline, đồng bộ tiến độ, worker Celery/Redis, S3, thống kê nghe và quản trị tài khoản. PostgreSQL/PostGIS có cấu hình driver và migration nhánh riêng nhưng chưa được kiểm thử với máy chủ PostgreSQL trong phiên này. Không tuyên bố sẵn sàng production; chưa triển khai ra bên ngoài.
