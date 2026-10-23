# Báo cáo kiểm thử thực tế

## Cập nhật 23/10/2026: Supabase và Ollama qua hàng đợi HTTPS

- Backend: **60 kiểm thử đạt**, gồm job bền vững, quyền worker/admin, lease hết hạn, nhận lại việc,
  kết quả gửi lặp, thu hồi khóa ghép nối, chống trùng tên/Wikidata, ràng buộc identity trong DB,
  xác nhận duyệt bắt buộc và sửa nội dung sau duyệt phải duyệt lại.
- Typecheck, build artifact kết hợp `/` và `/admin/`, Ruff: đạt.
- Playwright: **22 kiểm thử hiện có đạt** và **2 kiểm thử mới đạt** (desktop/mobile), xác minh
  yêu cầu AI trên cloud tiếp tục sau khi tải lại trang, nhận bản nháp và không tự lưu/xuất bản.
  Lượt 22 ca chạy trong sandbox cần dừng đúng máy chủ tạm khi teardown Windows; exit code cuối 0.
  Hai ca mới chạy ngoài sandbox kết thúc bình thường, exit code 0.
- Proxy Cloudflare: kiểm tra giữ path/query, cookie, body, header CSRF, Set-Cookie và không cache API.
- Supabase thật: kết nối đúng project, sao lưu `public` bằng pg_dump và xác minh archive trước migration;
  migration `0007`; các bảng riêng bật RLS. Không seed địa điểm hoặc tài khoản demo.
- Tạo admin theo email người dùng cung cấp; đăng nhập và kiểm tra phiên trên Render đạt HTTP 200,
  rồi đăng xuất phiên kiểm thử. Mật khẩu/token/backup chỉ nằm trong `.runtime/` được gitignore.
- Ollama trên PC: `qwen3:4b` đã cài và phục vụ. Kiểm thử tự động dùng mock model/Wikimedia;
  không coi đó là bằng chứng chất lượng nội dung AI hoặc kết quả triển khai Cloudflare thực tế.

Hướng dẫn vận hành: [CLOUD-DEPLOYMENT.md](CLOUD-DEPLOYMENT.md).

## Cập nhật 23/10/2026: PostgreSQL và AI local nhập Wikipedia

| Kiểm tra | Kết quả |
| --- | --- |
| Khởi tạo PostgreSQL 18 | Database `quan1tourism`, đủ 9 bảng ứng dụng và `alembic_version`, migration `0004` |
| Chuyển SQLite sang PostgreSQL | 3 tài khoản, 3 phiên, 4 danh mục, 12 POI, 24 bản dịch, 15 ngôn ngữ, 12 audit; đã sao lưu SQLite |
| Chạy lại script khởi tạo | Thành công; không ghi đè hoặc nhân đôi dữ liệu hiện có |
| AI với URL Wikipedia thực tế | Ollama `qwen3:4b`; lần cuối 56,8 giây; có tên, địa chỉ, danh mục, Việt/Anh, tọa độ Wikidata và ảnh Commons có ghi công |
| Lưu POI mẫu vào PostgreSQL qua API | HTTP 201; Nhà Văn hóa Thanh niên ở trạng thái `draft`; đọc lại thành công; chưa xuất bản |
| Dữ liệu sau thêm mẫu | 13 POI, 26 bản thuyết minh, 0 release công khai |
| Backend `pytest -q` | **51 passed**, 31,08 giây; 1 cảnh báo Starlette/httpx |
| Ruff `app tests` và script khởi tạo | Thành công |
| Typecheck và build admin/web | Thành công |
| `npm run test:e2e` | **22 passed**, 1,1 phút, exit code 0; desktop và Pixel 7 mô phỏng |
| Ứng dụng đang chạy local | Admin 5173, web 5174, API ready 8000 đều HTTP 200 |
| Mở POI PostgreSQL trên giao diện thật | Đúng tên/địa chỉ/tọa độ; ảnh nguồn tải được và ghi công hiển thị; đăng xuất sau kiểm tra |

Backend kiểm tra quyền nhân viên/du khách trước khi truy cập nguồn, URL Wikipedia hợp lệ, chặn URL/redirect ngoài Wikimedia, ngôn ngữ bắt buộc và tùy chọn, kiểm tra JSON AI, không lưu khi AI lỗi hoặc trả thiếu, tọa độ thiếu giữ NULL, chuẩn hóa địa chỉ theo nguồn, phát hiện tên phường không thống nhất, ngăn tạo lại cùng bài viết và giữ nguồn qua snapshot xuất bản.

Các ca trình duyệt mới mô phỏng phản hồi AI để kiểm tra điền biểu mẫu, cảnh báo thông tin thiếu, tọa độ không bị thay bằng số mặc định, lưu và mở lại nguồn. Luồng Wikipedia/Ollama thật được kiểm tra riêng trên PostgreSQL; đã rà soát bản mẫu để bỏ tên phường mâu thuẫn trong bài giới thiệu. Các bài kiểm thử tự động dùng DB tạm riêng. Chạy Playwright ngoài sandbox Windows để hoàn tất việc dừng máy chủ thử nghiệm; không thay đổi cấu hình test để dùng database thật.

Ảnh và tọa độ có nguồn Wikimedia, không được model tự đoán. AI vẫn có thể suy diễn sai nên nội dung mới đi qua bản nháp và quy trình duyệt. Chưa kiểm thử PostGIS trên máy này. Ảnh chụp luồng nhập ở `.runtime/screenshots/wikipedia-import-desktop.png` và `wikipedia-import-mobile.png`; kết quả kiểm tra thực tế ở `.runtime/postgresql-ai-results.json`.

## Cập nhật 23/10/2026: đa ngôn ngữ và thuyết minh văn bản

| Kiểm tra | Kết quả |
| --- | --- |
| Typecheck admin + web | Thành công |
| Build admin + web | Thành công |
| Backend `pytest -q` | **33 passed**, 18,64 giây; 1 cảnh báo Starlette/httpx |
| Ruff `app tests migrations` | Thành công |
| Playwright desktop + Pixel 7 mô phỏng | **20 passed**, exit code 0; chạy CLI tương đương script npm |
| DB local sau migration `0003` | 3 tài khoản, 3 phiên, 12 địa điểm, 24 bản dịch văn bản, 15 ngôn ngữ |
| SQLite integrity / foreign keys | `ok` / không có lỗi |

Backend kiểm tra khởi tạo DB mới, nâng từ `0002`, giữ Unicode/tài khoản/phiên/ảnh/release, schema khớp model, migration chạy lặp, chuẩn hóa bản dịch, ngôn ngữ tùy chọn/bắt buộc, phân quyền thêm/sửa ngôn ngữ, bật/tắt giữ nội dung, không ghi tệp audio và không cho upload audio. Các ca tài khoản/phiên và luồng duyệt/xuất bản cũ vẫn qua.

Trình duyệt kiểm tra editor → reviewer → guest bằng văn bản, chọn ngôn ngữ/giọng/tốc độ, tạm dừng/tiếp tục/dừng, chia bài dài thành đoạn, lỗi phát, thiếu giọng, rời bài dừng đọc và thêm ngôn ngữ xuất hiện ở editor/visitor. TTS dùng mock Web Speech API để xác minh tham số và trạng thái, **không xác nhận chất lượng giọng thật hoặc khả năng offline trên thiết bị**. Trong sandbox Windows, các máy chủ tạm được dừng theo PID sau khi 20 ca hoàn tất để kết thúc bước teardown của Playwright.

DB local đã được sao lưu vào `.runtime/backups/quan1-before-0003-*.db` trước khi nâng cấp. Test backend/E2E dùng DB tạm riêng; kiểm tra DB local chỉ đọc sau migration. Các lựa chọn ngôn ngữ bổ sung chưa tự có bản dịch; giao diện quản trị/đăng nhập hỗ trợ Việt/Anh. PostgreSQL/PostGIS và giọng thật trên thiết bị chưa được xác minh trong lần cập nhật này.

## Báo cáo lịch sử trước khi chuyển audio sang TTS

Ngày: **22/10/2026**, múi giờ bàn giao Asia/Bangkok. Hệ điều hành Windows, Node 22.22.0 portable, Python 3.12.15 trong virtual environment, Edge Chromium đã cài trên máy. Đây là kiểm tra local, không phải load test hay chứng nhận khả năng tiếp cận.

## Kết quả

| Lệnh/kiểm tra | Kết quả thực tế |
| --- | --- |
| `npm run typecheck` | Thành công cho admin và web |
| `npm run build` | Thành công cho hai ứng dụng, Vite 7.3.7 |
| `python -m pytest -q` tại services/backend | **13 passed**, 6.80 giây; 1 cảnh báo deprecation của Starlette/httpx |
| `python -m ruff check app tests` | Thành công; đã kiểm tra thêm migrations và script E2E |
| `npm run test:e2e` | **10 passed**, 47.8 giây; desktop + Pixel 7 mô phỏng |
| Truy cập admin 5173, web 5174, API health 8000 | Cả ba HTTP **200** |
| Chạy `scripts/dev.mjs`, dừng bằng q | Thành công; xác nhận cổng 8000/5173/5174 đều đóng |
| Ảnh/scroll desktop và mobile | Kiểm tra trực quan; viewport 1440/393 px, document width bằng viewport |

Các lệnh Python thực tế trong phiên dùng `.venv/Scripts/python.exe` để không phụ thuộc alias hệ thống; lệnh `uv run ...` tương đương sau `uv sync --frozen`. Kiểm thử Playwright cần quyền tạo/dừng tiến trình trình duyệt và máy chủ; trong sandbox Windows đã chạy thành công ở môi trường được cấp quyền. Không có trình duyệt hiển thị hay máy chủ production được triển khai.

## Backend: 13 trường hợp

1. Guest không đọc admin, nội dung nháp hoặc URL media nháp; logout làm mất quyền đọc file riêng tư.
2. Editor nhập hai ngôn ngữ, upload WAV thật về định dạng, gửi duyệt; reviewer duyệt và xuất bản; guest nhận đúng từng nguồn audio, `Range` trả **206** và đúng 44 byte yêu cầu.
3. Thiếu ngôn ngữ/audio hoặc sửa văn bản sau upload bị chặn gửi duyệt.
4. Sửa nội dung đang xuất bản tạo draft, không thay đổi snapshot công khai hiện hành.
5. Revision cũ bị từ chối **409**, không ghi đè thay đổi mới.
6. Khóa sửa khi đang duyệt; editor không tự duyệt; từ chối bắt buộc có lý do và trả về draft.
7. Từ chối audio giả, MIME sai, SVG chứa script; chấp nhận PNG hợp lệ.
8. Logout thu hồi phiên; thao tác ghi thiếu header CSRF bị từ chối.
9. Lưu trữ ẩn nội dung công khai; khôi phục phiên bản thành draft mới, không tự xuất bản lại.
10. Tìm không dấu, kết quả rỗng, giới hạn page/page_size.
11. Chỉ admin xóa danh mục trống, không xóa danh mục đang được sử dụng.
12. Không được khôi phục release thuộc địa điểm khác.
13. Seed chạy lại không trùng 12 địa điểm và giữ thay đổi đã lưu của biên tập viên.

Mỗi test dùng SQLite và media tạm riêng, thực hiện migration Alembic thật. Không có test ghi vào `.runtime/quan1.db`.

## Trình duyệt: 5 trường hợp × 2 viewport

- Axe audit màn hình danh sách với các tag WCAG 2 A/AA và WCAG 2.1 AA: không có vi phạm được công cụ phát hiện.
- Axe audit đăng nhập và bước 1 trình biên tập: không có vi phạm được công cụ phát hiện. Đã sửa nhãn các nút bước khi chữ bị ẩn ở mobile và các nhãn tương phản thấp.
- Tìm không dấu, trạng thái rỗng, bỏ lọc, chuyển menu, không tràn ngang toàn trang, không có lỗi JavaScript trong ca này.
- Mở hướng dẫn, Escape đóng dialog; bật chữ lớn, đổi giao diện tiếng Anh, reload vẫn giữ lựa chọn.
- Luồng qua tài khoản editor → reviewer → guest: nhập hai ngôn ngữ, upload audio, gửi duyệt, duyệt, xuất bản; guest phát được audio (`currentTime > 0`), đổi ngôn ngữ nhận source khác và tải Range thành công.

Database/media của E2E tách riêng. WAV im lặng chỉ là **fixture codec** trong test, không phải bản ghi âm thuyết minh và không được seed vào nội dung mẫu local.

Ảnh kiểm tra tại `.runtime/screenshots/admin-local-desktop.png`, `admin-local-mobile.png`; ảnh luồng kiểm thử tại `admin-desktop.png`, `admin-mobile.png`, `editor-desktop.png`, `editor-mobile.png`. Báo cáo HTML tại `playwright-report/index.html`. Các artifact này được gitignore.

## Chưa xác minh/chưa triển khai

- Audit tự động không thay thế thử nghiệm với người dùng lớn tuổi, người dùng trình đọc màn hình hay kiểm thử mọi trạng thái/đường đi. Các bước 2–4 chưa được audit Axe riêng.
- Chưa thử Firefox, Safari, điện thoại thật, iOS/Android native, âm thanh thực tế, tai nghe, khóa màn hình hay cuộc gọi.
- Chưa có bản ghi âm thuyết minh mẫu được cấp quyền. Cần upload bản ghi âm thật và người duyệt nghe kiểm tra ngữ nghĩa; hệ thống chỉ xác thực định dạng và liên kết với văn bản.
- Chưa chạy nhánh PostgreSQL/PostGIS hoặc GitHub CI; chưa có load test, đo SLA, diễn tập backup/restore hay kho log tập trung.
- Tour, Expo, GPS, PWA/offline, QR scanner, đồng bộ nghe, worker, dịch/TTS tự động và S3 chưa triển khai. Dịch/TTS cần chọn nhà cung cấp và cấu hình credentials; luồng thủ công không bị chặn.
- Media đã từng phát hành giữ URL công khai để phục vụ các bản cũ. Lưu trữ địa điểm gỡ khỏi public API, không thu hồi tài sản đã công khai trước đó.

Xem README để chạy lại và CHECKLIST.md để tiếp tục công việc.
