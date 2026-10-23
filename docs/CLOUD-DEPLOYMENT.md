# Supabase, Render, Cloudflare và Ollama trên máy cá nhân

Backend: `https://quan1-tourism-api.onrender.com`. Supabase project: `nqsfgcisjackuhgiksmu`.
Các địa chỉ này không phải thông tin đăng nhập. Không đưa URL database có mật khẩu hoặc khóa worker vào Git.

## Database thật

Backend đọc `DATABASE_URL` trong môi trường Render; khi chạy trên máy, đọc `.runtime/local.env`.
Dùng PostgreSQL Session Pooler của Supabase (cổng 5432, hỗ trợ IPv4), thêm `sslmode=require`.
URI `postgres://` hoặc `postgresql://` được chuyển sang driver psycopg 3. Connection pool có kiểm tra
kết nối và vô hiệu hóa prepared statements để tương thích pooler. Không dùng khóa anon thay mật khẩu DB.

Trong production, `APP_ENV=production` bắt buộc PostgreSQL và TLS, không tự rơi về SQLite.
Kết nối với database owner (thông thường `postgres.<project-ref>` qua pooler). Migration `0006`
bật RLS trên các bảng riêng của ứng dụng; không thêm policy cho anon/authenticated. Frontend luôn gọi
FastAPI, không truy cập bảng tài khoản, phiên, bản nháp hoặc hàng đợi bằng Supabase Data API.

Kiểm tra chỉ đọc:

```powershell
services/backend/.venv/Scripts/python.exe scripts/check_connections.py
```

Sao lưu schema `public` bằng pg_dump, xác minh archive, rồi nâng migration:

```powershell
services/backend/.venv/Scripts/python.exe scripts/migrate_cloud.py --project nqsfgcisjackuhgiksmu
```

Script yêu cầu pg_dump/pg_restore (tự tìm PostgreSQL 18 trên Windows hoặc PATH). Backup nằm trong
`.runtime/backups/`, không lên Git. Đây là backup schema ứng dụng; không thay thế backup toàn project
Supabase (auth/storage). Migration giữ dữ liệu hiện có, không seed tài khoản hay địa điểm demo.

Tạo quản trị viên đầu tiên (chỉ khi chưa có admin):

```powershell
services/backend/.venv/Scripts/python.exe scripts/create_admin.py --email admin@example.com --generate-password
```

Mật khẩu ngẫu nhiên nằm trong `.runtime/initial-admin.json` trên máy, không in ra terminal và không lên Git.
Script không đổi mật khẩu hoặc ghi đè tài khoản đã có. Khi dùng mật khẩu tự chọn, bỏ `--generate-password`
để nhập bằng lời nhắc ẩn. Sau đăng nhập, có thể tạo danh mục ở màn hình Danh mục trước khi nhập địa điểm.

## Triển khai backend và giao diện

Repo có `Dockerfile` build hai giao diện và chạy FastAPI cùng origin:

- `/`: du khách.
- `/admin/`: quản trị; các màn hình dùng hash như `/admin/#places`.
- `/api/v1/...`: API; `/docs`: tài liệu.

Render dùng Dockerfile tại gốc repo. Lệnh khởi động nâng Alembic trước khi chạy Uvicorn trên `$PORT`.
`render.yaml` là cấu hình tham khảo để áp dụng cho service hiện có, không tạo database mới. File này
chọn gói Starter và disk trả phí cho ảnh upload; cần kiểm tra chi phí trước khi áp dụng Blueprint.
Nếu giữ runtime Python hiện tại, dùng root `services/backend`, build `uv sync --frozen --no-dev`,
start `uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`;
giao diện triển khai trên Cloudflare Pages như phần dưới.

Các biến Render:

| Biến | Giá trị |
|---|---|
| `APP_ENV` | `production` |
| `DATABASE_URL` | URI Supabase có mật khẩu và TLS, lưu dạng secret |
| `COOKIE_SECURE` | `true` |
| `AI_MODE` | `worker` |
| `AI_WORKER_TOKEN` | secret ngẫu nhiên giống trên máy chạy Ollama |
| `MEDIA_ROOT` | đường dẫn disk bền vững, ví dụ `/var/data/media` |

Với Docker, `STATIC_ROOT=/app/static` đã được thiết lập. Với Python riêng API, để trống `STATIC_ROOT`.
Service Render hiện có tự nhận `RENDER=true` để bật chế độ production/worker nếu chưa đặt `AI_MODE`.
`AI_WORKER_TOKEN` có thể bỏ trống khi dùng bước ghép nối admin bên dưới; khi đã đặt biến này,
khóa trong Environment có ưu tiên và không thể đổi bằng API ghép nối.
Ảnh Commons dùng URL gốc; ảnh upload cần disk bền vững để không mất khi deploy. Không dùng thư mục
filesystem tạm của Render cho ảnh cần giữ lâu dài. Sau deploy, kiểm tra `/api/v1/health/ready`.

Cloudflare Pages có thể dùng cùng artifact: build `npm ci && npm run build:site`, output
`apps/web/dist`, root repository. Đặt `NODE_VERSION=22` và biến server
`RENDER_API_ORIGIN=https://quan1-tourism-api.onrender.com` (proxy cũng dùng URL này làm mặc định). Pages Functions trong `functions/api/[[path]].ts`
proxy `/api/*` tới Render, giữ cookie đăng nhập trên cùng origin. Không cache API. Nếu đã có Pages
project, cập nhật project đó; không cần đổi domain hiện có hoặc mở cổng máy cá nhân.

## Nhận việc trên máy có Ollama

Luồng: trình duyệt → Render → hàng đợi Supabase → worker trên PC → Ollama → bản nháp trên Render
→ quản trị viên kiểm tra → lưu nháp → gửi duyệt → quản trị viên xác nhận → xuất bản.

Worker chỉ kết nối ra ngoài bằng HTTPS. Không cần Cloudflare Tunnel, public port 11434,
hay đưa mật khẩu database cho worker. Nó chỉ nhận bài Wikipedia, danh mục và ngôn ngữ cần tạo;
không có quyền tạo địa điểm, duyệt, xuất bản hoặc đọc tài khoản bằng khóa worker.

Chuẩn bị cấu hình một lần:

```powershell
services/backend/.venv/Scripts/python.exe scripts/configure_ai_worker.py --server https://quan1-tourism-api.onrender.com
```

Script lưu khóa ngẫu nhiên vào `.runtime/local.env` và không in khóa ra terminal. Sau khi deploy,
ghép nối bằng tài khoản admin đã tạo, sử dụng thông tin cục bộ trong `.runtime/initial-admin.json`:

```powershell
services/backend/.venv/Scripts/python.exe scripts/configure_ai_worker.py --server https://quan1-tourism-api.onrender.com --pair
```

API yêu cầu phiên admin và chỉ lưu SHA-256 của khóa. Ghép nối lại sẽ thu hồi khóa cũ; việc ghép nối
được ghi vào audit log. Không cần đưa mật khẩu database cho worker hoặc đặt thêm secret Render.
Nếu đã cấu hình `AI_WORKER_TOKEN` trong Render Environment, dùng cùng giá trị trong file local
thay vì `--pair`; không gửi khóa qua chat.
Giữ `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=qwen3:4b` hoặc model đã cài.

Mở Ollama rồi chạy:

```powershell
services/backend/.venv/Scripts/python.exe scripts/ollama_worker.py
```

Kiểm tra một lượt bằng `--once`. Giữ PC, Ollama và worker hoạt động khi muốn tạo địa điểm bằng AI.
Khi PC offline, trạng thái quản trị báo chưa kết nối; việc đã nhận có lease 15 phút, được nhận lại
tối đa ba lần nếu mất kết nối. Việc chờ hết hạn sau 24 giờ. Hàng đợi lưu trong DB nên không mất
khi Render khởi động lại. Trình duyệt nhớ ID yêu cầu để tiếp tục lấy kết quả sau khi tải lại trang.
Mỗi request HTTP lấy trạng thái/nhận việc ngắn, việc suy luận dài chạy trên PC.

## Kiểm tra trùng và duyệt lại

Trước khi gọi model, server chuẩn hóa URL, giải quyết Wikipedia redirect, kiểm tra tên và mã Wikidata.
Khi nhập thủ công, giao diện gợi ý địa điểm đã có; API kiểm tra lại khi tạo/cập nhật.
Tên được chuẩn hóa chữ hoa/thường, dấu tiếng Việt, dấu câu và khoảng trắng. Cùng tên được xem là
cần dùng lại địa điểm hiện có; nếu hai chi nhánh thực sự khác nhau, đặt tên phân biệt chi nhánh.
Mã Wikidata giúp nhận diện bài viết khác ngôn ngữ. Bảng identity có khóa duy nhất để chặn hai yêu cầu
lưu đồng thời. Kiểm tra gồm cả bản nháp và địa điểm đã lưu trữ.

Migration không xóa/gộp địa điểm trùng lịch sử: giữ bản ghi và dành khóa cho bản đầu tiên; các bản trùng
cần được quản trị viên xử lý. Đổi tên trùng hoặc sửa vào bản hiện có thay vì tạo thêm.

AI không lưu POI hoặc tự xuất bản. Bản nháp có nguồn, model, cảnh báo và thông tin còn thiếu.
Biên tập viên gửi duyệt; reviewer có thể yêu cầu sửa; chỉ admin được duyệt/xuất bản. Khi duyệt,
admin phải tick xác nhận đã kiểm tra địa điểm trùng, tên, địa chỉ, tọa độ, nguồn và thuyết minh.
API bắt buộc xác nhận này và lưu vào lịch sử. Sửa nội dung sau duyệt trả về nháp, cần duyệt lại.

Tham khảo chính thức: [Supabase Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Render deploys](https://render.com/docs/deploys), [Render disks](https://render.com/docs/disks),
[Cloudflare Requests](https://developers.cloudflare.com/workers/runtime-apis/request/).
