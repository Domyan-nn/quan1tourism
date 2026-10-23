# Bàn giao CI/CD — 23/10/2026

## 1. Thay đổi và lý do

- Tách CI thành Backend, Frontend/edge, PostgreSQL integration, Built artifact E2E, Docker, Security và gate tổng.
  Release bundle chỉ có sau gate; giữ lockfile install, Ruff/pytest/typecheck/build/E2E hiện có.
- Thêm staging nhận trusted successful CI; production workflow_dispatch nhận staging receipt cùng manifest digest.
  Một deployment đang chạy mỗi môi trường, không cancel migration; Render poll đúng deploy ID/commit và public smoke.
- Migration owner là release job với PostgreSQL advisory lock; startup Docker/native không migrate.
  Lưu backup inventory ID, revision trước/sau, backend/Worker versions trước/sau. Không downgrade/restore tự động.
- Thêm identity backend/frontend, readiness revision, smoke read-only chi tiết bằng track_view=false;
  giữ bản đồ/TTS/admin coordinates/public privacy/order và counters hiện có.
- PostgreSQL thực phát hiện lỗi expires_at: replace timezone thành UTC làm phiên hết hạn vẫn hợp lệ.
  Đã sửa giữ aware offset, regression UTC/UTC+7/UTC-7 và API suite PostgreSQL qua.
- pip-audit phát hiện 35 advisory Pillow12.3.0; nâng pyproject/uv.lock lên13.0.0 rồi test lại ảnh/upload/E2E và audit sạch.
  Package-lock npm không thay đổi. Tham khảo [Pillow13 release notes](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html).
- Hoàn thiện audit, CI/CD, deployment, rollback/restore và operations runbook; không chạy cloud deploy hay thay domain/service.

## 2. Danh sách file thay đổi

<!-- changed-files -->

- `.dockerignore`
- `.github/workflows/checks.yml`
- `.github/workflows/deploy-environment.yml`
- `.github/workflows/production.yml`
- `.github/workflows/staging.yml`
- `.gitignore`
- `Dockerfile`
- `README.md`
- `cloudflare/map-tiles.ts`
- `cloudflare/worker.ts`
- `docs/CICD-AUDIT.md`
- `docs/CICD-VERIFICATION.md`
- `docs/CICD.md`
- `docs/CLOUD-DEPLOYMENT.md`
- `docs/DEPLOYMENT-RUNBOOK.md`
- `docs/OPERATIONS.md`
- `docs/ROLLBACK-RUNBOOK.md`
- `functions/api/[[path]].ts`
- `package.json`
- `playwright.config.mjs`
- `render.yaml`
- `scripts/build-site.mjs`
- `scripts/e2e_backend.py`
- `scripts/release-bundle.mjs`
- `scripts/release_control.py`
- `scripts/release_migrate.py`
- `scripts/release_preflight.py`
- `scripts/serve-built.mjs`
- `scripts/setup_postgresql.py`
- `scripts/smoke.py`
- `scripts/test_postgres.py`
- `services/backend/app/auth.py`
- `services/backend/app/config.py`
- `services/backend/app/main.py`
- `services/backend/migrations/env.py`
- `services/backend/pyproject.toml`
- `services/backend/tests/conftest.py`
- `services/backend/tests/test_accounts.py`
- `services/backend/tests/test_ai_jobs.py`
- `services/backend/tests/test_ollama_worker.py`
- `services/backend/tests/test_postgres.py`
- `services/backend/tests/test_readonly_smoke.py`
- `services/backend/tests/test_release_control.py`
- `services/backend/uv.lock`
- `tests/cloudflare-proxy.test.mjs`
- `tests/cloudflare-worker.test.mjs`
- `tests/e2e/admin.spec.ts`
- `tests/e2e/built-artifact.spec.ts`
- `tests/e2e/fixtures.ts`
- `tests/e2e/maps-statistics.spec.ts`
- `tests/e2e/multilingual.spec.ts`
- `tests/e2e/setup.mjs`
- `tests/e2e/visitor-auth.spec.ts`
- `tsconfig.edge.json`
- `wrangler.jsonc`

<!-- end-changed-files -->

## 3. Lệnh thực sự đã chạy

Máy Windows, Node22.22.0, uv0.13.4, Python3.12.15, PostgreSQL18.6.
QA source snapshot ở `.runtime/qa` chỉ sao chép file source Git theo trạng thái làm việc, không sao chép local.env/DB/media.
Lệnh cuối chạy source gốc bằng Python venv QA để dùng đúng Pillow13; không sử dụng DB local hoặc cloud.
Các SHA trong artifact local là metadata mô phỏng từ HEAD cùng working-tree changes, **không phải release đã được CI phê duyệt**.

| Lệnh / nhóm lệnh | Kết quả thực tế |
| --- | --- |
| `npm ci` trong QA checkout, dùng npm cache riêng | thành công, 117 packages; root lần đầu bị esbuild đang dùng khóa, đã khôi phục node_modules không dừng tiến trình người dùng |
| `uv sync --frozen` backend ban đầu, sau đó trong venv QA với uv.lock mới | thành công; QA Pillow13.0.0 |
| `ruff check --config services/backend/pyproject.toml services/backend/app services/backend/tests services/backend/migrations scripts` | passed |
| `pytest -c services/backend/pyproject.toml services/backend/tests -q --tb=short` bằng QA Python, basetemp/cache riêng | **97 passed, 3 skipped**, 39.57s; 3 test yêu cầu PostgreSQL được chạy ở lượt dưới |
| `QA-PYTHON scripts/test_postgres.py` trên source gốc | **100 passed**, PostgreSQL18.6, 36.28s; helper tự khởi tạo/dừng/xóa cluster loopback, test base/0007 →0008, lock/idempotency/RLS/data preservation, full API suite/concurrency/dedup |
| `npm run typecheck` trên source gốc | passed admin/web/Worker/Pages proxy |
| `node --test tests/cloudflare-map-tiles.test.mjs tests/cloudflare-proxy.test.mjs` | **4 passed**; tile success/upstream503→502, validation, cookie/no-store, invalid origin/network failure |
| `node --test tests/cloudflare-worker.test.mjs` sau dry-run | **2 passed**, chạy bundle Worker thật: release identity/no-store và asset/admin routing |
| `npm run build:site -- --cloudflare` trong QA | passed, build cả admin/web |
| `npm run check:worker` | dry-run thành công trong QA và trên source gốc; không deploy |
| `node scripts/release-bundle.mjs pack` và `verify` | manifest SHA256 từng file tạo/kiểm tra cả QA/source gốc; digest `cee860400ef35183568866ad6a5aeb0abc8a21d88a19fa2a2577903b9f036b21`; không publish |
| `node scripts/release-bundle.mjs config` với origin/Worker giả | cấu hình local được tạo và kiểm tra assets/routes/vars/identity; không gọi cloud |
| `npx playwright install chromium` rồi `npm run test:e2e` trên build với QA Python | **32 passed**, desktop/mobile, 1.7phút; có built-artifact read-only smoke; Chromium được cài riêng, không Edge |
| `npm audit --audit-level=high` | `found 0 vulnerabilities` |
| `uv export --frozen --no-dev --no-emit-project` và `uvx --from pip-audit==2.9.0 pip-audit --require-hashes --disable-pip --no-deps -r ...` | sau vá Pillow: `No known vulnerabilities found` |
| `gitleaks git . --redact --no-banner` | 10 commits, no leaks found |
| `gitleaks dir .runtime/security-source --redact --no-banner` | source-only snapshot hiện tại, no leaks found |
| `actionlint`1.7.7 và `git diff --check` | passed |

Một warning còn lại: Starlette deprecates httpx TestClient, gợi ý httpx2. Test vẫn qua; chưa đổi transport stack/lock ngoài Pillow.
Quét dependency phản ánh advisory database tại thời điểm chạy, không bảo đảm không có lỗ hổng chưa công bố.

Các lỗi trung gian đã được xử lý: browser sandbox launch timeout, test đổi trang trước khi login hoàn tất,
PostgreSQL pg_ctl giữ pipe Windows, pytest Temp ACL giữa tài khoản, và session timezone PostgreSQL.
Các lượt cuối trên đây thành công. Chỉ dừng process tree Playwright QA do nhiệm vụ tạo, không dừng backend/Vite có sẵn.

## 4. Chưa chạy và lý do

- **Docker build/runtime:** máy không có Docker CLI/daemon. CI có job build, smoke container SQLite tạm và kiểm tra installed package vs uv.lock;
  chưa có bằng chứng job đó chạy trên GitHub. Không tuyên bố toàn bộ CI xanh.
- **GitHub Actions thực tế / staging deploy / production release:** không push/dispatch, không dùng credential cloud;
  nhiệm vụ cấm production deploy/thay cloud configuration. Render polling/promotion/preflight được test bằng mock, chưa phải live cloud evidence.
- **Restore backup production / binary production trước / PostGIS:** cần backup/quyền/môi trường rehearsal riêng và xác nhận major/extensions.
- **Ollama/model/giọng TTS thật:** test dùng mock như yêu cầu; không tải model hay mở public port PC.

## 5. Cấu hình cloud chưa xác minh

Chưa đọc dashboard/state tài khoản GitHub/Render/Cloudflare/Supabase: branch protection/environments/secret scopes,
service runtime/root/build/start/predeploy, auto-deploy/webhook/Blueprint sync/Workers Builds/Pages,
major PostgreSQL/PostGIS/pooler role/TLS/RLS thực tế, staging resource isolation, disk/media/backup,
current live commit, current Worker version/routes/domain/retention và khả năng rollback thực tế.
Đã đọc tài liệu public chính thức để xây dựng workflow; không xem đó là xác minh tài khoản.

## 6. Thao tác dashboard/secret còn thiếu

Owner thực hiện checklist [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md):

1. Bật required checks/review và environments tách staging/production; production cần approval.
2. Cấp existing staging DB/service/media/origin/Worker riêng; không tạo mới production/domain.
3. Nạp 3 secret mỗi môi trường: DATABASE_URL, RENDER_API_KEY, CLOUDFLARE_API_TOKEN; điền variables/inventory trong [CICD.md](CICD.md).
4. Tắt Render auto-deploy/Blueprint sync/webhook và Workers Builds/Pages deploy độc lập; loại migration khỏi startup/predeploy.
5. Xác minh actual DB fingerprint Render trùng migration target, media path, major/extensions, TLS, route/worker settings.
6. Xác minh backup DB+media/restore drill, fixture staging, review compatibility trước đặt migration approval.
7. Chạy CI/staging thật, đọc receipt/smoke rồi mới cân nhắc workflow production ở nhiệm vụ được giao quyền riêng.

## 7. Rủi ro còn lại và khôi phục

- Không có live cloud/Docker evidence: giữ các gate và chưa bật CD đến khi owner hoàn tất checklist.
- Venv local chính đang có Pillow12.3.0 bị một tiến trình có sẵn khóa binary; lần sync bị chặn đã được khôi phục từ cache có SHA256 binary trùng.
  Không để venv hỏng. Owner cần dừng/restart backend local vào thời điểm phù hợp rồi `uv sync --frozen` để dùng Pillow13.
  Test và audit cuối dùng venv QA13, không dùng venv local cũ. Không thay runtime production trong nhiệm vụ này.
- Render Git-backed build đúng commit nhưng base image tag còn mutable; không tuyên bố cùng Docker digest với CI.
  Artifact Worker/frontend có checksum và được dùng nguyên từ staging sang production.
- Inventory/backup approval là attestation của owner, không tự chứng minh backup đã restore được; phải diễn tập theo runbook.
- Giữ schema mở rộng, rollback backend/Worker từ previous IDs/artifact khi đã xác minh compatibility; không tự downgrade/restore DB.
  Quy trình phục hồi dữ liệu riêng bảo toàn POI/media/statistics/sessions/releases/audit/AI queue/lease: [ROLLBACK-RUNBOOK.md](ROLLBACK-RUNBOOK.md).
