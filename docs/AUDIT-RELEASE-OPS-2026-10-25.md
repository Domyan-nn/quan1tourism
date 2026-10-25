# Bàn giao CI/CD và vận hành — 25/10/2026

Audit tại HEAD `95468e03cec87d56ccadc9ff7648998ffb7a6b51`, working tree ban đầu sạch.
Đã đọc bốn workflow, Dockerfile, cấu hình Render/Worker, release/preflight/migration/smoke,
tests release và tài liệu storage/deploy/rollback. Chỉ sửa repository và chạy kiểm tra cô lập;
không deploy, push, merge, sửa production, tạo tài nguyên hoặc bật billing.

## Vấn đề và bằng chứng

| Vấn đề | Bằng chứng trước sửa | Mức độ | Trạng thái / thay đổi | Kiểm chứng |
| --- | --- | --- | --- | --- |
| Staging có thể dùng origin production với cách viết tương đương | So sánh chuỗi `https://PROD.test`, `https://prod.test:443/` khác `https://prod.test` | P0 | Đã sửa: chuẩn hóa hostname, dấu chấm cuối và HTTPS port | Ba biến thể cùng origin bị từ chối; production inventory tương đương được chấp nhận |
| Fingerprint DB không phản ánh query ghi đè target libpq | `postgresql://ci@stage/db?host=production` trước đây băm `stage`, kết nối có thể dùng host query | P0 | Đã sửa: từ chối query target `host/hostaddr/port/dbname/user/service/servicefile`; không in DSN | Sáu biến thể override bị từ chối bằng mã `database_target_ambiguous` |
| Expected Alembic revision lặp ở API, readiness và bundle | Literal `0010` lặp trong `main.py` và `release-bundle.mjs` | P0 | Đã sửa: `app/release-metadata.json` dùng chung; Docker copy file cho frontend stage | Test so với Alembic head duy nhất, readiness sai revision trả 503; bundle từ chối metadata sai |
| Smoke thất bại ngay khi network/503 hoặc release đang lan truyền | `smoke.py` chỉ đọc mỗi URL một lần | P1 | Đã sửa: tối đa 5 GET, cách 2 giây; chỉ retry lỗi mạng/status tạm thời hoặc identity chưa đúng | Regression transport, 503, stale API SHA, Worker header SHA; quá budget vẫn fail; 403 không retry |
| Bằng chứng lỗi preflight không có file độc lập khi chưa deploy | Đã có log/summary, artifact chỉ chọn các file tạo sau preflight | P1 | Đã sửa: `.runtime/preflight.json` có status/code/keys; reconcile artifact giữ file từ precheck trước dependency install | Subprocess Python `-S`, cwd tạm, không có deploy file vẫn có report; test không lộ secret |
| Isolation, migration owner và promotion gate | Workflow kiểm chứng CI/staging receipt, fingerprint, resource IDs; `release_migrate.py` advisory lock; startup không migrate | P0 | Đã có sẵn, giữ nguyên | Release tests từ chối CI sai nhánh/fork/workflow/failure; giữ các checks bắt buộc |
| Trigger Render không đồng nghĩa live | `render_deploy` ghi deploy ID, poll trạng thái/commit, timeout giữ evidence | P0 | Đã có sẵn, giữ nguyên | Live đúng commit mới qua; build failed/canceled/wrong commit/timeout bị từ chối |
| Smoke có thể làm tăng thống kê | Đã dùng detail `?track_view=false`, chỉ GET | P0 | Đã có sẵn, giữ nguyên khi retry | Regression backend xác nhận counters không tăng; smoke tests kiểm tra mọi request là GET |
| Fixture staging cần chuẩn bị riêng | Runbook yêu cầu fixture công khai qua admin; chưa có mẫu nội dung riêng | P1 | Đã bổ sung `docs/fixtures/staging-place.json`, bản nháp ghi rõ dữ liệu giả, GPS tắt | Pydantic PoiInput validate thành công; không chạy seed hoặc tạo bản ghi cloud |
| Supabase/media legacy và disk | `media_storage.py` private Storage, UUID/no upsert, locator/hash; YAML còn disk 1GB | P0 | Đã có sẵn; sửa Operations để phân biệt ảnh mới Storage và legacy local | Chưa đọc inventory cloud trong phiên này; giữ disk, chưa kết luận có thể gỡ |
| CI/Actions mới nhất và trạng thái staging | Không có `gh`; public GitHub API không truy cập được từ môi trường hiện tại | P0 | Chưa xác minh live, không suy kết quả từ code local | Cần xem Actions run mới bằng tài khoản owner; bằng chứng lịch sử ở các tài liệu CI dưới đây |
| Chi phí và build trùng | Repo có GitHub deploy cùng Wrangler build command; không đọc được dashboard/billing | P1 | Chưa xác minh usage thật | Owner kiểm tra Builds/auto-deploy và invoice; không thay đổi plan/tài nguyên |

Fingerprint vẫn là inventory cần owner rà soát: alias DNS, hai role cùng database hoặc cấu hình
pooler khác nhau có thể trỏ cùng dữ liệu. Hash khác nhau không tự chứng minh hai môi trường độc lập.
Không thay fingerprint bằng giá trị giả để làm gate xanh; xác minh project/database thực tế trước CD.

## File, API và migration

- Mới: `services/backend/app/release-metadata.json`, `app/release.py`;
  `test_release_metadata.py`, `test_smoke_retries.py`, `tests/release-bundle.test.mjs`;
  fixture staging nêu trên và báo cáo này.
- Sửa: `scripts/release_preflight.py`, `scripts/smoke.py`, `scripts/release-bundle.mjs`,
  `scripts/build-site.mjs`, `services/backend/tests/test_release_control.py`,
  `main.py` ở import/version/readiness, `Dockerfile`, hai workflow checks/deploy;
  `CICD.md`, `DEPLOYMENT-RUNBOOK.md`, `OPERATIONS.md`.
- Không có migration mới; expected revision vẫn `0010`, worker protocol vẫn `3`.
  `/api/v1/version` giữ contract hiện có; `/release.json` bổ sung `schema_revision`.
  Immutable manifest, frontend và backend dùng cùng metadata.

## Kiểm tra thực tế trên Windows

| Lệnh / kiểm tra | Kết quả trong phiên này |
| --- | --- |
| `services/backend/.venv/Scripts/python.exe -m pytest -q services/backend/tests/test_release_control.py services/backend/tests/test_release_metadata.py services/backend/tests/test_smoke_retries.py services/backend/tests/test_readonly_smoke.py` | **43 passed**, 1 warning Starlette/TestClient hiện hữu |
| `services/backend/.venv/Scripts/ruff.exe check --config services/backend/pyproject.toml services/backend/app/release.py services/backend/app/main.py scripts/release_preflight.py scripts/smoke.py services/backend/tests/test_release_control.py services/backend/tests/test_release_metadata.py services/backend/tests/test_smoke_retries.py` | Đạt |
| `.tools/node-v22.22.0-win-x64/node.exe --test tests/release-bundle.test.mjs` | **1 passed** |
| `.runtime/qa-tools/actionlint/actionlint.exe -color` | Exit 0, cả workflow hiện tại hợp lệ |
| Python stdin/here-string: `PoiInput.model_validate_json(Path('docs/fixtures/staging-place.json').read_text(encoding='utf-8'))` | Đạt; draft, không có tọa độ, GPS tắt |
| `git diff --check` | Đạt; chỉ có thông báo Git chuẩn hóa LF/CRLF |
| Public read-only GitHub Actions API | Không truy cập được; không lấy được run mới |
| Docker local | Không có lệnh Docker trên PATH; chưa chạy build container trong phiên này |

Retry HTTP trong regression được mock, không phải smoke deployment cloud thật.
Build/typecheck/E2E và toàn bộ backend được tổng hợp trong báo cáo nghiệm thu chung;
bảng này chỉ ghi các lệnh do nhánh công việc CI/CD thực sự chạy.

## Windows: chạy các thành phần

Từ repo, khi dùng bản Node portable hiện có:

```powershell
$env:Path = "$PWD\.tools\node-v22.22.0-win-x64;" + $env:Path
npm.cmd ci
```

Backend (terminal riêng): `cd services/backend`, `uv sync --frozen`,
`uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000`.
Nếu database local cần nâng schema, backup trước rồi chủ động chạy
`uv run --frozen alembic upgrade head` trên **đúng local database**. Không chạy seed đè dữ liệu.
Web và admin từ root, hai terminal: `npm.cmd run dev:web` và `npm.cmd run dev`;
lần lượt mở `http://127.0.0.1:5174` và `http://127.0.0.1:5173`.

Worker dùng `.runtime/local.env` đã gitignore với `AI_SERVER_URL`, `AI_WORKER_TOKEN`,
`OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL` đã cài. Không chép token vào CLI/report.
Mở Ollama local rồi chạy từ root:

```powershell
services/backend/.venv/Scripts/python.exe scripts/ollama_worker.py
```

Expo dùng `apps/mobile/.env` (chỉ tạo từ `.env.example` khi file chưa tồn tại),
`EXPO_PUBLIC_API_ORIGIN` là HTTPS backend thử nghiệm có mã native auth tương thích.
LAN: `npm.cmd run mobile:lan`; khác mạng/4G: `npm.cmd run mobile:tunnel`.
Chép đúng `exp://`/`exps://` URL CLI đang chạy vào `VITE_EXPO_GO_URL`, bật
`VITE_EXPO_QR_ENABLED=true`, restart/build lại web. Máy Expo phải hoạt động;
không mở cổng PostgreSQL/Ollama. Chi tiết SDK, tài khoản, TTS/GPS và giới hạn thiết bị:
[MOBILE-EXPO.md](MOBILE-EXPO.md). Không có kiểm tra thiết bị/model thật trong nhánh CI/CD này.

## Staging, release và rollback

Runbook đã cập nhật: [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md),
[CICD.md](CICD.md), [ROLLBACK-RUNBOOK.md](ROLLBACK-RUNBOOK.md).

1. Owner xác nhận DB/project, Storage/media, Render service, Worker và origins staging độc lập;
   cấp đúng variables/secrets GitHub Environments. Chưa có bằng chứng tài nguyên này sẵn sàng.
2. Tắt auto deploy trên Render, Workers Builds/Pages và webhook cũ; đối chiếu routes/runtime;
   giữ một migration owner. Không Apply Blueprint để tạo service mới.
3. Xác minh backup DB + object media cùng mốc và diễn tập restore riêng; review migration/schema,
   chuẩn bị fixture staging bằng admin. Không dùng DB production để vượt preflight.
4. CI đầy đủ phải thành công; staging dùng immutable bundle của đúng run, migration advisory lock,
   Render poll `live` + SHA, Worker deploy rồi smoke read-only; chỉ sau smoke mới có receipt.
5. Production là thao tác chủ động của owner qua workflow có reviewer và staging receipt.
   Không chạy trong nhiệm vụ này. Lỗi preflight có JSON/reconcile ngay khi chưa deploy.
6. Khi lỗi: đối soát deploy ID/migration revision/lock trước retry. Rollback ứng dụng chỉ khi
   binary trước tương thích schema và locator media hiện tại. Giữ DB/schema/object/disk;
   không tự downgrade, restore hoặc xóa object khi smoke lỗi.

Bằng chứng Actions lịch sử đã có trong repo:
[CI-FAILURES-2026-10-25.md](CI-FAILURES-2026-10-25.md) mô tả run `40171020073`
(E2E qua, Security lỗi trước backport HEAD), và
[STAGING-DEPLOYMENT-DIAGNOSIS.md](STAGING-DEPLOYMENT-DIAGNOSIS.md) mô tả run `40107265455`
dừng vì thiếu cấu hình, trước migration/deploy. Đây không phải kết quả Actions mới của phiên hiện tại.

## Inventory chi phí và bước dashboard còn thiếu

| Hạng mục | Điều xác minh được từ repo | Điều chưa xác minh / owner cần xem |
| --- | --- | --- |
| Render | `render.yaml`: service tên `quan1-tourism-api`, `plan: starter`, disk `quan1-media` 1GB tại `/var/data`, AutoDeploy off trong YAML | Runtime/plan/disk đang dùng, giờ instance/disk và hóa đơn thực tế. YAML không chứng minh resource đang được tính phí |
| Supabase | Backend dùng private Storage `place-images`, yêu cầu server key và project URL; PostgreSQL qua DATABASE_URL | Project/plan thật, dung lượng object/legacy, egress, database usage, backup/PITR. Không xóa disk trước inventory/hash/media restore |
| Cloudflare | Worker `quan1tourism`, assets + tile/API proxy; Wrangler có build command; GitHub có deploy workflow | Plan/CPU/request/build usage, Git integration có đang auto build/deploy trùng Actions; tắt pipeline trùng bằng owner sau rà soát |
| GitHub | Có CI push/PR, artifact candidate 14 ngày, release 30 ngày, receipt 90 ngày, browser failure 7 ngày | Plan, phút runner/storage còn lại và hóa đơn; chưa có số usage live |
| Ollama/TTS | Ollama trên PC, TTS giọng nền tảng; không thêm AI/TTS trả phí | Chất lượng model/giọng/thiết bị thực tế cần nghiệm thu riêng |

Ảnh upload đã giới hạn MIME, 10MB/20 triệu pixel; có thể chuẩn bị ảnh WebP vừa kích thước trước upload
để giảm storage/egress. Giữ đường dẫn backend có xác thực; media nháp `private, no-store`, media từng công bố
cache public có thời hạn theo chính sách hiện hữu. Không cache API/private media ở Worker và không đổi bucket public
để tối ưu phí. Không báo con số giá hoặc chi phí thực tế khi chưa đọc billing dashboard.

Mức sẵn sàng: logic release/preflight/smoke đã kiểm chứng local; workflow qua actionlint.
Container/Linux CI, Actions run mới, staging/cloud settings, bill/usage, backup restore và live release vẫn
chưa nghiệm thu trong phiên này. Không gán trạng thái production ready chỉ từ kết quả local.
