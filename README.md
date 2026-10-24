# Saigon Stories · Quận 1 Tourism

Danh mục song ngữ Việt/Anh và migration `0010`: [mapping, kiểm thử và hướng dẫn chuyển đổi](docs/BILINGUAL-CATEGORIES.md).

Sửa độ tin cậy luồng dịch AI: [nguyên nhân, kiểm thử, audit và hướng dẫn vận hành](docs/AI-TRANSLATION-RELIABILITY.md). Bản vá đã được kiểm thử local; `qwen3:4b` chưa vượt pilot dịch, batch mặc định một ngôn ngữ.

Ảnh upload bền vững và nối lại file đang có trong bucket private: [Supabase Media](docs/SUPABASE-MEDIA.md).

Trang quản trị nội dung thuyết minh du lịch bằng **React + TypeScript**, kết nối **FastAPI + SQLAlchemy + Alembic**. Tiếng Việt mặc định, có giao diện tiếng Anh và cỡ chữ lớn. Có bản đồ du khách và thống kê lượt xem/lượt nghe. GPS foreground, bán kính theo địa điểm, UI VI/EN độc lập với ngôn ngữ bài và bổ sung bản dịch qua Ollama queue: [hướng dẫn](docs/NARRATION-GPS.md), [kiểm thử](docs/NARRATION-VERIFICATION.md). Các thay đổi mới chưa triển khai cloud.

## Chạy local

Triển khai Supabase + Render + Cloudflare và nhận việc bằng Ollama trên máy cá nhân:
xem [hướng dẫn triển khai cloud](docs/CLOUD-DEPLOYMENT.md).

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

## PostgreSQL và AI local

Backend tự đọc cấu hình trong `.runtime/local.env` (đã gitignore); biến môi trường của shell được ưu tiên. Đặt `DATABASE_URL=postgresql+psycopg://postgres:<password>@127.0.0.1:5432/quan1tourism` trong tệp này, thay `<password>` và mã hóa URL nếu mật khẩu chứa ký tự đặc biệt. Không đưa mật khẩu vào Git hoặc tham số dòng lệnh.

Từ thư mục gốc, chạy bằng Python của backend:

```powershell
services/backend/.venv/Scripts/python.exe scripts/setup_postgresql.py --database quan1tourism --import-sqlite
```

Script tạo database nếu chưa có, chạy toàn bộ migration, sao lưu SQLite rồi chuyển các tài khoản, phiên, danh mục, POI, bản dịch, media, release và lịch sử trong một transaction. Không ghi đè dữ liệu PostgreSQL đã có. PostGIS là tùy chọn; không cần cài extension để dùng quản trị nội dung. Khởi động lại backend sau khi đổi database.

Để thử AI, mở Ollama với model đã cài. Trong **Thêm địa điểm → Tạo địa điểm từ Wikipedia**, mặc định chỉ tạo bản VI để kiểm tra và lưu; sau đó chọn từng locale để dịch từ bài VI đã xác minh. Kết quả đủ điều kiện vẫn cần kiểm tra trước khi **Lưu nháp**. Luồng duyệt/xuất bản tiếp tục áp dụng. Model `qwen3:4b` trên máy kiểm chứng hiện vẫn chép nguồn khi dịch, nên chưa mở batch nhiều ngôn ngữ; xem báo cáo nêu trên.

Tên lấy từ Wikipedia; AI chọn danh mục và soạn thuyết minh; tọa độ lấy từ Wikipedia/Wikidata; ảnh và giấy phép lấy từ Wikimedia Commons. Thông tin thiếu được để trống, không dùng tọa độ giả. Nguồn, revision, model, cảnh báo và ghi công ảnh được lưu cùng POI và giữ trong snapshot đã xuất bản. Wikipedia cần Internet; bước AI chạy local. Thời gian chờ và xử lý được hiển thị riêng, không cam kết một thời lượng cố định trên CPU.

## Tài khoản demo local

Chỉ được tạo khi chủ động chạy seed với `--demo`. Đây là thông tin đăng nhập công khai cho môi trường phát triển, **không dùng để triển khai thật**.

| Vai trò | Email | Mật khẩu demo |
| --- | --- | --- |
| Quản trị viên | `admin@quan1.local` | `Quan1Demo!2026` |
| Biên tập viên | `editor@quan1.local` | `Quan1Demo!2026` |
| Người duyệt | `reviewer@quan1.local` | `Quan1Demo!2026` |

Nút “Trải nghiệm tài khoản demo” thực hiện đăng nhập thật bằng tài khoản admin local. Không có cơ chế bỏ qua đăng nhập. Phiên cookie HttpOnly hết hạn sau 8 giờ và được thu hồi khi đăng xuất.

## Tài khoản du khách

Trên trang du khách (`http://127.0.0.1:5174`), chọn **Đăng ký**, nhập họ tên, email và mật khẩu từ 8–200 ký tự, rồi nhập lại mật khẩu. Đăng ký thành công sẽ đăng nhập ngay. Có thể đăng xuất, đăng nhập lại và tải lại trang mà vẫn giữ phiên còn hạn. Giao diện hỗ trợ tiếng Việt/Anh và điện thoại.

Tài khoản tự đăng ký luôn có vai trò `visitor`, chỉ xem nội dung đã xuất bản; không truy cập quản trị, bản nháp hay tệp riêng. Khách chưa đăng nhập vẫn xem và nghe nội dung công khai. Mật khẩu được băm Argon2, phiên lưu bằng cookie HttpOnly, không lưu mật khẩu/token trong localStorage. Chưa có xác minh email hoặc quên/đặt lại mật khẩu.

Khi cập nhật từ bản cũ, dừng backend, sao lưu DB và chạy `uv run alembic upgrade head` trong `services/backend`, sau đó khởi động lại backend. Migration `0002` thêm vai trò du khách; `0003` chuẩn hóa văn bản đa ngôn ngữ; `0004` thêm nguồn Wikipedia và cho phép tọa độ chưa biết. Tài khoản, phiên, văn bản, ảnh và lịch sử đã xuất bản được giữ lại. Xem [cấu trúc DB](docs/DATABASE.md).

## Admin sử dụng thế nào?

1. **Địa điểm:** tìm bằng tên hoặc địa chỉ, có thể gõ không dấu; lọc danh mục/trạng thái; đổi danh sách/thẻ; phân trang.
2. **Thêm địa điểm:** nhập tên, danh mục, địa chỉ và ảnh. Tọa độ nằm trong phần nâng cao để biểu mẫu dễ đọc.
3. **Nội dung đa ngôn ngữ:** chọn tab ngôn ngữ, nhập tiêu đề và bài thuyết minh. Có số ký tự và thời gian đọc ước tính. Tiếng Việt/Anh mặc định bắt buộc; các ngôn ngữ khác có thể bổ sung sau.
4. **Nghe thử giọng đọc:** text-to-speech đọc trực tiếp văn bản bằng giọng trên thiết bị. Chọn giọng/tốc độ, tạm dừng, tiếp tục, dừng hoặc chọn vị trí đọc. Không tải lên hay lưu tệp audio mới.
5. **Kiểm tra & công bố:** chọn Nháp / Công bố / Ẩn rồi bấm **Lưu thay đổi**. Công bố yêu cầu đủ các bản dịch bắt buộc và các bản dịch tùy chọn đã bắt đầu nhập; không cần tệp audio.
6. **Vị trí:** mở **Chỉnh sửa nâng cao**, tìm địa chỉ, nhấp bản đồ, kéo ghim hoặc nhập tọa độ. Khôi phục dùng lần lưu gần nhất; Hủy bỏ thay đổi chưa lưu. Chuyển bước/chọn ảnh không tự lưu.
7. **Du khách:** đổi Danh sách/Bản đồ, chọn ghim để xem và nghe ngay trên bản đồ, hoặc mở trang chi tiết. Danh sách xếp theo lượt xem giảm dần; số lượt chỉ admin được xem.

Chỉ admin được thay đổi địa điểm, ảnh và trạng thái; editor/reviewer có thể đọc và xem trước. Backend kiểm tra quyền cho mọi thao tác. Lưu Nháp giữ bản công khai cũ nếu có; Ẩn gỡ công khai, giữ lịch sử và thống kê. Nhân sự xem/nghe thử không tăng lượt. Khi phát hành có thẩm quyền, chạy migration `0009` một lần qua release owner trước backend mới; không chạy lệnh local vào production. Xem [bản đồ và thống kê](docs/MAPS-STATISTICS.md).

Trong **Ngôn ngữ & thuyết minh**, quản trị viên thêm/sửa mã ngôn ngữ, tên bản địa, mã giọng đọc, thứ tự, hướng chữ, trạng thái bật và yêu cầu bắt buộc. Có sẵn 15 lựa chọn: Việt, Anh, Trung giản thể/phồn thể, Nhật, Hàn, Pháp, Đức, Tây Ban Nha, Ý, Bồ Đào Nha, Nga, Thái, Indonesia, Ả Rập. Thêm ngôn ngữ mới không cần sửa mã nguồn hay migration. Tắt ngôn ngữ giữ lại văn bản. Giao diện quản trị/đăng nhập vẫn có tiếng Việt và tiếng Anh; danh sách này là ngôn ngữ nội dung thuyết minh.

**Hướng dẫn sử dụng** luôn có trong menu và cuối trang. **Tùy chỉnh giao diện** cho phép dùng chữ lớn và đổi ngôn ngữ; lưu tùy chọn trên thiết bị. Dialog có quản lý focus, Escape và điều khiển bằng bàn phím. Khi đóng bản nháp chưa lưu, hệ thống yêu cầu xác nhận bỏ thay đổi.

## Dữ liệu và tệp

- Seed an toàn khi chạy lại: thêm bản ghi còn thiếu theo ID cố định, không ghi đè nội dung đã sửa.
- 12 địa điểm mẫu, 4 danh mục; tất cả ở trạng thái **bản nháp**, có văn bản mẫu Việt/Anh, chưa có bản dịch cho 13 lựa chọn bổ sung. Đây không phải dữ liệu du lịch được kiểm chứng. Nguồn/quyền sử dụng: [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).
- Có thể biên tập thủ công hoặc tạo bản nháp đa ngôn ngữ từ Wikipedia bằng Ollama local. Nội dung AI cần kiểm tra trước khi xuất bản. TTS dùng Web Speech API, không cần khóa API. Giọng đọc phụ thuộc trình duyệt/hệ điều hành, có thể cần mạng hoặc cài thêm giọng. Khi không có giọng phù hợp, giao diện thông báo và vẫn hiển thị văn bản; không dùng giọng sai ngôn ngữ. Tham khảo [SpeechSynthesis.getVoices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices).
- Tệp nháp nằm sau endpoint có xác thực. Tệp đã từng phát hành được giữ để bảo toàn URL của các phiên bản đã phát hành; lưu trữ địa điểm không thu hồi các URL media đã công khai trước đó.
- Lưu local mặc định ở `.runtime/` (đã gitignore). Không có khóa bí mật trong mã nguồn.
- `.env.example` là mẫu cấu hình; backend tự đọc `.runtime/local.env`, không tự đọc `.env`. Có thể ưu tiên biến shell bằng `$env:DATABASE_URL = '...'`. Đường dẫn tương đối trong biến môi trường được tính theo thư mục chạy backend.

## Kiểm tra lại

```powershell
# Từ thư mục gốc
npm run typecheck
npm run test:edge
npm run check:worker
npm run build:site
npx playwright install chromium
npm run test:e2e

# Từ services/backend
uv run pytest -q
uv run ruff check app tests
```

E2E dùng Chromium do Playwright cài, desktop và Pixel 7 mô phỏng; CI cài bằng `npx playwright install --with-deps chromium`.
Chạy build trước E2E: harness phục vụ **artifact đã build**, tự khởi động API tại 8010 và frontend tại 5183/5184,
database/media tạm, bỏ qua cấu hình local. TTS/tile/ảnh ngoài mạng được mock; chất lượng giọng thật cần nghe trên thiết bị.
Ảnh chụp ở `.runtime/screenshots`, báo cáo ở `playwright-report/`. Có thể dùng `E2E_PYTHON` để chọn venv QA riêng.

Kiểm tra PostgreSQL riêng trên Windows có PostgreSQL18: `services/backend/.venv/Scripts/python.exe scripts/test_postgres.py`.
Helper tạo cluster loopback tạm, không dùng DB local hiện có. CI có service PostgreSQL18 và chạy toàn bộ backend bằng `pytest --postgres`.
Quality gate, secrets/variables, staging promotion và production manual release:
[CI/CD](docs/CICD.md), [deployment runbook](docs/DEPLOYMENT-RUNBOOK.md), [rollback/restore](docs/ROLLBACK-RUNBOOK.md).
Docker dùng dependency từ uv.lock, startup không tự migrate. Chưa deploy production trong nhiệm vụ hoàn thiện CI/CD.

Xem [báo cáo kiểm thử](docs/TEST-REPORT.md), [kiến trúc/API](docs/ARCHITECTURE.md), [vận hành](docs/OPERATIONS.md) và [CHECKLIST.md](CHECKLIST.md) để biết phần đã xác minh và giới hạn còn lại.

## Giới hạn hiện tại

Luồng nội dung Giai đoạn 1 có backend thật và đã khởi tạo PostgreSQL 18 local. Chưa triển khai tour, Expo/mobile, quét QR, GPS, PWA/offline, đồng bộ tiến độ, worker Celery/Redis, S3 và quản trị tài khoản. PostGIS chỉ được thêm khi máy chủ có extension; nhánh PostGIS chưa kiểm thử trên máy này. AI có thể bỏ sót hoặc suy diễn sai nên chỉ tạo bản nháp để duyệt. Thông tin triển khai xem hướng dẫn cloud ở đầu tài liệu.
