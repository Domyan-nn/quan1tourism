# Bàn giao QA: Unicode, TTS, GPS và đa ngôn ngữ

Đây là báo cáo lịch sử ngày 23/10. Bản vá dịch, protocol 3 và kết quả kiểm chứng mới ngày 24/10 nằm tại [AI-TRANSLATION-RELIABILITY.md](AI-TRANSLATION-RELIABILITY.md).

Ngày đối chiếu: 2026-10-23. Làm việc trên mã hiện tại, không có AGENTS.md trong các thư mục mã nguồn đã tìm. Trước thay đổi working tree sạch, base `2377721d696f782fdd657380a45dec34a7043a5d` trên main. Thay đổi mới chưa commit/push/deploy. Artifact local có release `local`, không phải release production được phép promote.

## Thay đổi và lý do

- Danh mục: NFC, chặn ký tự hỏng, sửa theo ID, công cụ dry-run/transaction trên restore local, public category API không count và hiển thị trên thẻ du khách.
- TTS: chia đầy đủ Unicode, giữ utterance, native pause/resume, vô hiệu callback cũ, lỗi rõ, giọng đến trễ, kiểm tra language/script, onstart một lần mỗi bài. Giữ Web Speech, không thêm dịch vụ trả phí.
- GPS: migration 0009 thêm bán kính/công tắc opt-in và metadata bản dịch riêng; circle preview theo form, save/cancel/restore. Dwell/hysteresis/cooldown trên thiết bị, một watcher, không lưu/gửi lịch sử GPS và không ghi view khi tự phát.
- VI/EN: UI độc lập ngôn ngữ bài, có toggle trong editor và hộp đăng nhập du khách; giữ dữ liệu chưa lưu và playback. Thông báo đang chờ được hiển thị phù hợp UI sau khi đổi ngôn ngữ. Ngôn ngữ bài lấy từ backend.
- AI: supplement mỗi locale qua durable AiJob, protocol 2, dedup PostgreSQL, xác nhận nguồn/ghi đè/duyệt, kiểm tra đầu ra, hash nguồn/đích và optimistic revision, stale khi nguồn đổi, giữ kết quả thành công riêng. Không tự tạo POI hoặc công bố.
- Snapshot: lưu nháp không thay bản công khai trước đó; Ẩn gỡ công khai. Public loại bộ đếm và metadata riêng. Trạng thái bản dịch quản trị phân biệt published/saved draft/queued/running/review/failed/missing.
- CI: thêm kiểm thử logic narration bắt buộc, PostgreSQL matrix 17/18 sau khi xác minh cloud 17.11; giữ toàn bộ gate hiện có. Release metadata dùng schema 0009/protocol 2.

Giải thích nguyên nhân, cách sử dụng, constants và rollback: [NARRATION-GPS.md](NARRATION-GPS.md).

## Lệnh đã thực sự chạy

Python QA: `.runtime/qa/services/backend/.venv/Scripts/python.exe`; cùng dependency lock của backend, môi trường riêng tránh tiến trình local của người dùng đang khóa venv thường. Không đổi dependency hoặc lockfile trong đợt tính năng này. Ruff dùng executable cùng QA venv. Node portable 22.22.0, Playwright Chromium đã cài riêng trong `.runtime/pw-browsers`.

| Lệnh / phạm vi | Kết quả thực tế |
| --- | --- |
| `ruff check --config pyproject.toml app tests migrations ../../scripts` từ backend | Passed |
| `python -m pytest -q` từ backend, cache/basetemp riêng trong runtime | 103 passed, 5 skipped; 5 ca yêu cầu PostgreSQL thật |
| `python -m pytest -q tests/test_location_narration.py tests/test_category_repair.py` sau kiểm tra hash cả tiêu đề nguồn | 6 passed, 1 skipped (khóa hàng PostgreSQL) |
| `python scripts/test_postgres.py` | 108 passed trên PostgreSQL 18.6 tạm, loopback/cổng ngẫu nhiên; tự dừng/xóa cluster |
| Migration PostgreSQL | base → 0009, 0007 → 0009, 0008 → 0009, chạy head lặp; dữ liệu trước giữ nguyên; so metadata/RLS/projection cũ |
| PostgreSQL đồng thời | Cửa sổ 30 phút/upsert/increment hiện có; thêm 8 yêu cầu supplement song song chỉ có một active job |
| `npm run typecheck` | Passed admin/web/Worker/proxy |
| `npm run test:narration` | 15 passed: Unicode VI/EN/CJK/Arabic/Korean/Thai/emoji, script voices, Haversine/dwell/accuracy/stale/overlap/hysteresis/cooldown |
| `npm run build:site` | Passed, artifact kết hợp `/`, `/admin/` và release.json |
| `npm run test:edge` | 4 passed, gồm `tests/cloudflare-map-tiles.test.mjs` và proxy/cookie/cache/upstream lỗi |
| `npm run check:worker` | Passed dry-run; không deploy |
| `node --test tests/cloudflare-worker.test.mjs` | 3 passed trên bundle |
| `npm run test:e2e` | 54 passed (2.0 phút), desktop/mobile, trên chính artifact vừa đóng gói Worker; chạy tuần tự sau dry-run |
| `actionlint.exe -color` | Passed, kể cả PostgreSQL matrix 17/18 |
| Gitleaks `dir <source-only-copy> --redact --no-banner` | Passed, không tìm thấy secret; chỉ copy file nguồn Git, không runtime/credential/data thật |
| `python scripts/repair_categories.py` | dry-run SQLite cũ: changes=[], unresolved=[]; không apply |
| Đối chiếu database từ xa | Chỉ SELECT/SHOW; lượt xác minh cuối ép SET TRANSACTION READ ONLY và xác nhận on. Cloud 17.11, schema 0008, UTF8/UTF8, 4 tên lưu `?` |
| `git diff --check` | Passed; chỉ có thông báo chuẩn hóa LF/CRLF của Git |

Pytest có một warning Starlette/httpx deprecation, không làm fail. Không dùng continue-on-error để bỏ lỗi.

E2E dùng E2E_PYTHON QA và PLAYWRIGHT_BROWSERS_PATH nói trên. Harness đặt IGNORE_LOCAL_ENV=1, APP_ENV=test, DB/media tạm; không dùng database cấu hình thường. Backend chặn mạng ngoài loopback trong pytest. Browser mock tile/ảnh/Internet, GPS, thời gian, TTS; test AI dùng worker credential giả chỉ tồn tại trong harness và kết quả model giả.

Các ca E2E bao gồm mọi ngôn ngữ enabled trong registry với giọng mock tương ứng, ghép chính xác toàn bài tới câu cuối; pause/resume/stop và callback cũ; UI đổi mà không mất form/audio; Unicode admin → API → visitor; tọa độ/radius restore/cancel/save; GPS opt-in, accuracy/dwell/stale/tab ẩn, watcher cleanup; autoplay chặn không ghi listen; manual audio không bị GPS ngắt; AI review/save/reopen giữ đúng bản dịch, không đổi bản công khai. Có axe accessibility và smoke routes/assets trên artifact đã build.

Lỗi phát hiện trong quá trình chạy đã được xử lý: alt rỗng cho minh họa địa điểm mới; test cũ gắn UI với ngôn ngữ bài; selector marker Leaflet; callback utterance cũ; auto request đợi voice sau khi tắt GPS; nút Hủy tràn viewport mobile; danh sách admin chưa refresh sau apply AI. Có một lượt smoke lỗi do đóng gói Worker chạy lại build song song E2E; các bước được chạy tuần tự lại, không che lỗi hoặc coi lượt đó là passed.

## Chưa chạy / chưa xác minh

- PostgreSQL major 17 tại local/CI cho thay đổi mới: máy chỉ có binaries 18.6, không Docker và chưa push nên chưa có runner 17. Matrix 17 là gate bắt buộc trước release, không được coi là đã passed.
- Docker build tại máy này: không có Docker CLI/daemon. Job Docker verification hiện có được giữ; chưa chạy lại GitHub CI cho working tree chưa push.
- Không cài lại npm ci/uv sync hoặc chạy lại dependency audit mạng trong đợt này vì dependency/lockfile không đổi; pipeline bắt buộc vẫn dùng npm ci, uv sync --frozen, npm audit và pip-audit theo policy hiện hữu.
- Chưa nghe giọng thật trên Android/iOS/Safari/Chrome thiết bị thật; chưa đi thực địa đo GPS, permission/autoplay/pause đặc thù OS. Mobile E2E là giả lập viewport/thiết bị Chromium.
- Chưa chạy model Ollama thật, chưa cập nhật/restart PC. Test queue/lease/auth/retry/completion và generation protocol dùng mock, không đánh giá bản dịch model thực tế.
- Chưa deploy staging/production, migration cloud, backup/restore cloud, sửa tên production hoặc diễn tập binary rollback trên restore cloud. Chưa đối chiếu giao diện admin production bằng credential thật.

## Cloud và thao tác còn lại

Đã đọc: version PostgreSQL 17.11, Alembic 0008, encoding và bốn bản ghi danh mục. Chưa xác minh lại dashboard Render/Cloudflare/GitHub environments, bảo vệ main, deployment settings, extension/PostGIS, backup hoặc secrets. Không thay dashboard, domain, service, DB hoặc credential cloud.

Không cần secret mới để GPS/TTS/i18n hoạt động. Supplement dùng AI_WORKER_TOKEN/pairing hiện có; CATEGORY_REPAIR_DATABASE_URL chỉ dùng cho restore/local và không đưa giá trị vào Git/log. Trước phát hành có thẩm quyền: chạy đủ CI 17/18, backup DB/media, một migration owner nâng 0009, release đúng SHA/artifact, restart PC worker protocol 2, smoke staging và thiết bị thật. CD environments/secrets/auto-deploy vẫn cần owner kiểm tra theo [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md).

Bốn danh mục từ xa vẫn chưa sửa. File local `.runtime/category-repair-review.json` liệt kê ID/tên đang hỏng và tên đề nghị từ seed/SQLite cũ; nguồn còn cần admin đối chiếu vì ID khác. Script từ chối apply nếu evidence vẫn ghi REQUIRES ADMIN REVIEW, từ chối database remote/production, kiểm tra expected_name và rollback cả transaction nếu lệch. Không seed đè hoặc tạo ID khác. Không đưa danh sách dữ liệu thật này vào Git hoặc artifact CI.

## Rủi ro và phục hồi

Giọng thiếu/OS chặn tự phát/GPS không chính xác: vẫn xem bản đồ, đọc và bấm nghe thủ công. Nội dung AI luôn cần con người xác minh ngôn ngữ và sự thật; bộ lọc script/độ dài không thay đánh giá bản dịch. Job offline chờ tới giới hạn hết hạn 24 giờ, không ảnh hưởng readiness công khai.

Chưa phát hành nên không có cloud deployment cần rollback. Trên release sau này, giữ schema 0009 khi rollback frontend. Binary backend 0008 có readiness kiểm tra revision cứng, chưa được phép coi tương thích trực tiếp 0009; chuẩn bị bản tương thích và diễn tập trước. Không downgrade/restore đè DB; restore vào môi trường riêng, giữ POI/bản dịch/media/thống kê/AI queue/leases. Xem [ROLLBACK-RUNBOOK.md](ROLLBACK-RUNBOOK.md).

## Danh sách file thay đổi

```text
.github/workflows/checks.yml
README.md
apps/admin/src/App.tsx
apps/admin/src/Editor.tsx
apps/admin/src/Languages.tsx
apps/admin/src/NarrationTranslations.tsx (mới)
apps/admin/src/WikipediaImport.tsx
apps/admin/src/components.tsx
apps/admin/src/styles.css
apps/web/src/Auth.tsx
apps/web/src/MapExplorer.tsx
apps/web/src/geofencing.ts (mới)
apps/web/src/main.tsx
apps/web/src/styles.css
apps/web/src/useLocation.ts (mới)
packages/api-client/src/PlaceMap.tsx
packages/api-client/src/SpeechPlayer.tsx
packages/api-client/src/index.ts
packages/api-client/src/speech-chunks.ts (mới)
packages/contracts/src/index.ts
package.json
scripts/build-site.mjs
scripts/ollama_worker.py
scripts/repair_categories.py (mới)
scripts/release-bundle.mjs
services/backend/app/ai_jobs.py
services/backend/app/content.py
services/backend/app/main.py
services/backend/app/models.py
services/backend/app/narration_generation.py (mới)
services/backend/app/narration_jobs.py (mới)
services/backend/app/schemas.py
services/backend/migrations/versions/0009_location_narration.py (mới)
services/backend/tests/test_category_repair.py (mới)
services/backend/tests/test_location_narration.py (mới)
services/backend/tests/test_postgres.py
services/backend/tests/test_readonly_smoke.py
services/backend/tests/test_workflow.py
tests/e2e/admin.spec.ts
tests/e2e/narration-location.spec.ts (mới)
tests/e2e/speech.ts
tests/e2e/visitor-auth.spec.ts
tests/narration-logic.test.mjs (mới)
docs/CICD.md
docs/DEPLOYMENT-RUNBOOK.md
docs/MAPS-STATISTICS.md
docs/NARRATION-GPS.md (mới)
docs/NARRATION-VERIFICATION.md (mới)
docs/OPERATIONS.md
docs/ROLLBACK-RUNBOOK.md
```

Không thay package-lock.json/uv.lock, không tạo display_order, pipeline native hoặc dịch vụ trả phí. File review danh mục và report/browser artifacts chỉ ở runtime bị ignore. Mã nguồn đang là working tree để review; không push main vì có thể kích hoạt deployment trái phạm vi nhiệm vụ mới.
