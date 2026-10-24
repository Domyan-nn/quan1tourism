# Danh mục Việt/Anh

Thay đổi từ HEAD `0055e9d243f9540b97b41d3d2747bc5008451d7c`.
Nhiệm vụ này chỉ sửa repository và chạy kiểm thử cô lập, không migrate,
deploy hoặc chuyển đổi danh mục production.

`categories.name` là tên chuẩn tiếng Anh, `categories.name_vi` là tên tiếng Việt.
Hai trường tối đa 100 ký tự, trim và chuẩn hóa Unicode NFC; API yêu cầu cả hai
khi tạo hoặc sửa, từ chối tên rỗng, ký tự điều khiển, `?` và U+FFFD.
Không ép ASCII hoặc tự suy luận ngôn ngữ từ ký tự: quản trị viên xác minh ý nghĩa.
Chỉ `name` có unique constraint; bản dịch trùng nhau không tạo danh mục mới.

Migration mới `0010_bilingual_categories.py`, sau `0009`, chỉ thêm
`name_vi VARCHAR(100) NULL`. Không đổi tên hiện có, ID, màu hoặc `Poi.category_id`.
Mọi bản ghi cũ được giữ nguyên tên, `name_vi = NULL` cho đến khi có mapping đã duyệt.
Không mặc định tên cũ là tiếng Anh. Nếu chưa chuyển đổi, English UI vẫn có thể
hiển thị tên cũ tiếng Việt; đây là dữ liệu chờ xác minh, không tự dịch khi render.

API public và admin trả `id, name, name_vi, color`; admin GET/POST giữ `count`
như trước, PUT giữ cấu trúc không có `count`. Public không có `count`, chỉ lấy
danh mục thuộc release đang công khai của POI không archived. Bản nháp mới vẫn
giữ danh mục của snapshot công khai trước đó. Quyền endpoint giữ nguyên: các
vai trò biên tập được xem/tạo, chỉ admin được đổi tên/xóa.

`getCategoryLabel` trong `packages/contracts/src/index.ts` dùng ngôn ngữ giao diện:
`en` chọn `name`, `vi` chọn `name_vi`, thiếu bản dịch thì fallback `name`.
Admin có hai trường nhập, nhắc bổ sung bản dịch bị thiếu. Đổi UI giữ form chưa lưu,
bộ lọc bằng ID, category_id, địa điểm đang chọn và player. Ngôn ngữ bài không
quyết định nhãn danh mục. AI vẫn nhận `id` và `name`, chọn theo ID hợp lệ; không
thêm trường bắt buộc vào payload job đã xếp hàng, không tự tạo danh mục.

## Mapping đã xác minh và dữ liệu chưa xử lý

Mapping nằm trong `DEMO_MAPPING` của `scripts/repair_categories.py`, căn cứ tên
và ID trong seed gốc cùng yêu cầu song ngữ đã được cung cấp:

| ID | Giá trị name cũ phải khớp chính xác | name mới | name_vi mới |
| --- | --- | --- | --- |
| heritage | Di tích lịch sử | Historical Sites | Di tích lịch sử |
| architecture | Kiến trúc | Architecture | Kiến trúc |
| culture | Văn hóa & đời sống | Culture & Lifestyle | Văn hóa & đời sống |
| nature | Không gian xanh | Green Spaces | Không gian xanh |

Cả bốn yêu cầu `expected_name_vi = null`. Không áp mapping chỉ dựa vào tên,
không áp cho ID khác. Thiếu ID, tên hoặc bản dịch đã được sửa sẽ dừng toàn bộ;
không ghi đè chỉnh sửa của người dùng. Kiểm tra trùng name trong trạng thái cuối
và xung đột với unique constraint trước khi UPDATE; không hỗ trợ hoán đổi tên
đang được ID khác giữ. UPDATE kiểm tra cả expected_name và expected_name_vi;
PostgreSQL khóa hàng, lỗi hoặc chỉnh sửa đồng thời rollback toàn transaction.

Seed chỉ tạo bản ghi thiếu với hai tên mới, không cập nhật bản ghi đã tồn tại.
Không dùng seed để chuyển đổi database có sẵn.

Bản ghi chưa xử lý gồm mọi ID ngoài mapping, dữ liệu có `?`/U+FFFD/mojibake,
ID demo đã đổi tên/bản dịch và bản ghi chưa xác minh ngôn ngữ. Không sửa dữ liệu
hỏng bằng cách đoán. Script xuất `unresolved` kèm ID, tên và lý do. Đây là báo cáo
trên database restore được chỉ định, không phải kiểm kê production hiện tại.
Không có mapping nào được áp lên production trong nhiệm vụ này.

## Diễn tập trên bản restore local

1. Sao lưu database, kiểm tra archive và restore vào SQLite local hoặc PostgreSQL
   loopback riêng. Giữ nguyên bản backup; không dùng database đang chạy ứng dụng.
2. Với shell chỉ dành cho bản restore, đặt `QUAN1_IGNORE_LOCAL_ENV=1`,
   `APP_ENV=development`, `DATABASE_URL` trỏ chính xác bản restore local;
   bỏ `RENDER` nếu biến này có mặt. Kiểm tra target trước khi chạy Alembic.
3. Trong `services/backend`, chạy `uv run --frozen alembic upgrade 0010`.
   Migration không tự chuyển tên; chạy lại không tạo thêm cột hoặc danh mục.
4. Tại gốc repo, đặt `CATEGORY_REPAIR_DATABASE_URL` trỏ bản restore đó
   (PostgreSQL dùng driver `postgresql+psycopg`). Script cố ý bỏ qua `DATABASE_URL`
   và `.runtime/local.env`, từ chối APP_ENV=production và mọi database remote.

```powershell
# Chỉ sau khi đã cấu hình target restore local ở bước trên.
services/backend/.venv/Scripts/python.exe scripts/repair_categories.py
services/backend/.venv/Scripts/python.exe scripts/repair_categories.py --demo-mapping
# Đọc và duyệt danh sách changes trước khi áp dụng:
services/backend/.venv/Scripts/python.exe scripts/repair_categories.py --demo-mapping --apply
```

Với tên khác, lập JSON UTF-8 gồm `id, expected_name, expected_name_vi, name,
name_vi, evidence`; evidence dẫn tới nguồn đã kiểm chứng, không để lời nhắc
`REQUIRES ADMIN REVIEW`. Dùng `--repairs <file>` thay `--demo-mapping`.
Hai chế độ mặc định dry-run, chỉ ghi khi thêm `--apply`. Đối với schema cũ chưa
có name_vi, công cụ vẫn hỗ trợ định dạng sửa Unicode cũ gồm bốn trường;
schema 0010 yêu cầu đủ hai tên và cả hai expected values.

## Các bước production còn lại

- Duyệt code/migration và kết quả thử nghiệm; xác minh ID, tên gốc, mapping,
  unique conflict trên một restore gần nhất, bao gồm các bản ghi unresolved.
- Sao lưu DB/media và xác minh trước release. Dùng một migration owner có khóa;
  chạy migration 0010 trước backend mới vì ORM/readiness mới yêu cầu schema 0010.
- Deploy backend/frontend cùng bản đã kiểm thử. Không chạy seed hoặc
  repair_categories.py vào production; công cụ sửa dữ liệu cố ý chặn remote.
- Người quản trị nhập cặp tên đã duyệt qua form/API admin cho đúng từng ID;
  kiểm tra lại category_id của POI và snapshot/public visibility. Không áp demo
  mapping cho những ID cloud khác ID seed, không tự phục hồi tên hỏng từ dấu hỏi.
- Xác minh readiness, hai API danh mục, admin/visitor/map, đổi UI khi đang nghe,
  worker và các job AI cũ. Không cần model AI hoạt động để hiện tên đã lưu.
- Không downgrade xóa name_vi; rollback binary giữ schema mở rộng và dữ liệu.

## Kiểm thử

Các lệnh chạy được trong repo (Windows dùng npm.cmd khi npm.ps1 bị chặn):

```text
services/backend/.venv/Scripts/python.exe -m pytest services/backend/tests -q
services/backend/.venv/Scripts/python.exe scripts/test_postgres.py
npm run typecheck
npm run test:categories
npm run build:site
npx playwright test tests/e2e/categories.spec.ts tests/e2e/narration-location.spec.ts tests/e2e/maps-statistics.spec.ts
```

Pytest dùng database tạm và chặn HTTP ngoài loopback; PostgreSQL runner tạo
cluster riêng, không đọc target cloud. E2E dùng artifact đã build và backend tạm,
mock tile/speech/AI, không cần Internet hoặc Ollama thật. Kết quả thực tế của lượt
thực hiện ngày 2026-10-24:

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ backend, SQLite | 127 passed, 6 skipped (các test cần PostgreSQL) |
| Toàn bộ backend, PostgreSQL 18.6 cô lập | 133 passed, gồm base/0007/0008/0009 lên 0010 và chạy lặp |
| Backend danh mục/repair sau điều chỉnh cuối | 25 passed |
| Ruff app/tests/migrations/scripts | Passed |
| Typecheck admin/web/edge | Passed |
| Helper nhãn, `npm run test:categories` | 1 passed |
| `npm run build:site` | Passed, build admin và web |
| E2E categories/narration-location/maps-statistics | 38 passed, Chromium desktop và Pixel 7 |
| `git diff --check` | Passed |

Lần thử PostgreSQL trong sandbox không khởi tạo được cluster; chạy lại với quyền
khởi tạo tiến trình local đã thành công. Playwright chạy xong 38 ca nhưng Windows
giữ server kiểm thử; đã xác minh và dừng đúng các PID backend/preview tạm,
runner thoát exit 0 và báo 38 passed. Không dừng worker AI của ứng dụng.

Chưa chạy PostgreSQL 17/PostGIS, trình duyệt hoặc giọng đọc thiết bị thật,
AI model thật và production migration/deploy. Test script repair xác minh
dry-run không ghi, mapping xung đột/dữ liệu cũ đổi bị từ chối, giữ category_id,
Unicode, thiếu dịch và chặn remote/production. API tests giữ quyền và lọc release;
E2E xác minh tạo/sửa song ngữ, form chưa lưu, fallback, nhãn trong Editor/map,
lọc bằng ID và phát âm thanh không reset khi đổi UI.

## File thay đổi

- Database/API: `services/backend/app/models.py`, `schemas.py`, `main.py`,
  `seed.py`, migration `services/backend/migrations/versions/0010_bilingual_categories.py`.
- Contract/helper: `packages/contracts/src/index.ts`.
- Admin: `apps/admin/src/App.tsx`, `Editor.tsx`, `i18n.ts`.
- Du khách: `apps/web/src/main.tsx`, `MapExplorer.tsx`.
- Chuyển dữ liệu: `scripts/repair_categories.py`; manifest schema:
  `scripts/release-bundle.mjs`.
- Kiểm thử: `services/backend/tests/test_categories.py`, `test_category_repair.py`,
  `test_location_narration.py`, `test_workflow.py`, `test_accounts.py`,
  `test_ai_jobs.py`, `test_postgres.py`, `test_readonly_smoke.py`;
  `tests/category-label.test.mjs`, `tests/e2e/categories.spec.ts`,
  `tests/e2e/narration-location.spec.ts`.
- Chạy helper trong CI: `package.json`, `.github/workflows/checks.yml`.
- Bàn giao: tài liệu này và liên kết trong `README.md`.
