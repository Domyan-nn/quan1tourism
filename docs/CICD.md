# CI/CD quan1tourism

Phạm vi: web/admin React + TypeScript, packages dùng chung, FastAPI/SQLAlchemy/Alembic,
PostgreSQL, Worker/Pages proxy, Ollama pull worker trên PC. CI kiểm tra typecheck/logic Expo;
không có pipeline EAS hoặc phát hành native lên store.
Đợt hoàn thiện này chỉ sửa repository và chạy QA cô lập; không deploy hoặc đổi cloud.
Audit ban đầu: [CICD-AUDIT.md](CICD-AUDIT.md). Bằng chứng chạy: [CICD-VERIFICATION.md](CICD-VERIFICATION.md).

```mermaid
flowchart TD
  PR[Push hoặc PR] --> BE[Ruff và pytest SQLite]
  PR --> FE[Typecheck web admin edge và proxy tests]
  PR --> PG[PostgreSQL 17 và 18 migration và API concurrency]
  PR --> DK[Docker build locked runtime và smoke]
  PR --> SEC[Gitleaks npm audit pip-audit]
  FE --> PK[Build frontend và Worker dry-run]
  PK --> E2E[Chromium desktop mobile trên artifact]
  BE --> G[Quality gate]
  PG --> G
  DK --> G
  SEC --> G
  E2E --> G
  G --> ART[Release bundle SHA và checksums]
  ART --> TRUST[Chỉ push nhánh mặc định cùng repository]
  TRUST --> ST[Environment staging và khóa migration]
  ST --> RD[Render commit cụ thể chờ live]
  RD --> CF[Worker và assets đã kiểm tra]
  CF --> SM[Smoke origin công khai]
  SM --> REC[Staging receipt]
  REC --> MAN[workflow_dispatch và production approval]
  MAN --> PROD[Cùng bundle qua quy trình release production]
```

## Required checks

Bật branch protection/ruleset cho nhánh mặc định: bắt buộc PR, review và **Quality gate**,
**Release bundle**. Các job thành phần: **Backend**, **Frontend and edge**, **PostgreSQL integration (17)**, **PostgreSQL integration (18)**,
**Built artifact E2E**, **Docker verification**, **Security**. Gate yêu cầu tất cả thành công;
failed/cancelled/skipped đều chặn. Không có `continue-on-error`. Không cho bypass không kiểm soát.
Không dùng `pull_request_target`. CI không nhận deploy secret.

CI chạy Ubuntu, Node 22, Python 3.12, uv 0.13.4; `npm ci`, `uv sync --frozen`.
`package.json` override Undici ở `7.30.1`, đồng bộ `package-lock.json`, để vá
GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472 và GHSA-xjj6-f33q-929c trong dependency
của Miniflare. Giữ Wrangler 4.152.0; không dùng `npm audit fix --force` để hạ Wrangler.
Khi nâng Wrangler/Miniflare, kiểm tra lại override và chỉ bỏ khi dependency upstream đã có bản vá.
uv.lock nâng Pillow lên 13.0.0 để sửa advisory phát hiện khi audit.
Security chạy `npm run audit:security`: npm audit thật và kiểm tra bản vá source
`node-forge@1.4.0` cho GHSA-86w9-cpqp-85rv chưa có release chính thức.
Chỉ advisory này và chuỗi Expo hiện có được chấp nhận khi version/SHA256/consumer
resolution và test RSA/Expo đều đạt; mọi high/critical khác tiếp tục chặn gate.
`npm ci` áp dụng backport qua postinstall, kể cả Docker build.
Xem [bản vá, điều kiện chặn và cách gỡ](../security/README.md).
Playwright cài Chromium bằng `npx playwright install --with-deps chromium`; không phụ thuộc Edge.
Playwright phục vụ `apps/web/dist` và `/admin/`, không dùng Vite dev server. HTTP ngoài loopback,
tile, ảnh và TTS được mock; backend tests cấm socket HTTP ngoài loopback.
Frontend and edge còn chạy `npm run test:narration`: chunk Unicode, voice/script, Haversine, dwell, hysteresis và cooldown.
E2E GPS/TTS/time được mock trên artifact; gồm tự phát bị chặn, tab ẩn, voice đến trễ, UI locale độc lập,
Unicode danh mục và duyệt supplement AI. Không cần model thật. Xem [NARRATION-VERIFICATION.md](NARRATION-VERIFICATION.md).

Cloud được đối chiếu READ ONLY ngày 2026-10-23: **17.11**, revision **0008**. CI matrix major **17** và **18**;
local đã chạy **18.6**, chưa chạy major 17 ở máy này vì không có binaries/container tương ứng.
GitHub Actions [run 40053038928](https://github.com/Domyan-nn/quan1tourism/actions/runs/40053038928)
trên commit `a5aa5b0618a92388ae1a878502c85ac683f7cff9` đã chạy thành công cả PostgreSQL
17/18, Docker và Built artifact E2E; run này bị chặn tại Security do Undici trước bản vá trên.
Owner xác minh lại version/extension trước khi bật CD; chưa kiểm tra PostGIS. CI không dùng DATABASE_URL cloud. `--postgres` chỉ chấp nhận
`TEST_POSTGRES_URL` loopback, database `quan1_ci`, mỗi test có schema UUID và cleanup riêng.
Test từ base/0007/0008 lên head 0009, chạy lặp, so dữ liệu accounts/sessions/POI/bản dịch/media/release/audit/
identity/AI job/lease/worker; kiểm tra RLS, schema và projection của revision trước.
Toàn bộ API suite, bao gồm cửa sổ 30 phút và concurrent upsert/increment, chạy thêm trên PostgreSQL.
Có thêm kiểm tra nhiều yêu cầu supplement đồng thời chỉ tạo một active job cùng POI/locale.
Nhánh PostGIS vẫn cần kiểm thử riêng nếu cloud có extension; image postgres:18 chuẩn không có PostGIS.

Docker production chạy `uv sync --frozen --no-dev --no-install-project`; không cài pip từ khoảng phiên bản.
CI build Docker rồi smoke với SQLite tạm chỉ trong container, kiểm tra package cài đúng uv.lock và không có pytest.
`CMD` không migrate. Các base image tag chưa được khóa digest; Render Git-backed rebuild đúng commit,
không được hiểu là chạy cùng Docker image digest của CI. Muốn bảo đảm byte-for-byte image cần quy trình registry
được phê duyệt riêng, không đổi runtime/service trong nhiệm vụ này.

## Artifact và nguồn release

`candidate-<sha>` chứa Worker bundle, static assets và manifest SHA256 từng file, schema revision và worker protocol.
`services/backend/app/release-metadata.json` là nguồn duy nhất của expected Alembic revision và protocol
cho API/readiness, `/release.json` và manifest. Backend test đối chiếu file với Alembic head duy nhất;
bundle verification từ chối metadata không khớp kể cả khi checksum từng file hợp lệ.
Sau tất cả gate, CI phát hành `release-<sha>`. Staging tải artifact đúng CI run; không build lại frontend lúc deploy.
Production chỉ nhận `staging_run_id` thành công và so cùng manifest digest **trước cloud write**.
Backend Render nhận `commitId` đầy đủ; script poll deploy ID tới `live`, kiểm tra commit rồi smoke version.
`/api/v1/version` lấy `RELEASE_SHA` hoặc `RENDER_GIT_COMMIT`; `/release.json` nằm trong frontend artifact.
Worker không cache release.json, API proxy luôn `no-store` và giữ cookie.
Build hỗ trợ cả `WORKERS_CI_COMMIT_SHA` và `CF_PAGES_COMMIT_SHA` từ tích hợp Cloudflare hiện có.
Khi không có runtime RELEASE_SHA, Worker lấy identity từ release.json của chính asset version đang phục vụ;
test trên bundle xác minh header và response body vẫn đọc được.
Public smoke kiểm tra thêm `X-Release-SHA` của Worker; cấu hình deploy yêu cầu routes JSON và workers.dev tường minh,
không suy giá trị mặc định có thể làm thay đổi domain đang dùng.

Staging workflow dùng `workflow_run` nhưng lọc success + push + nhánh mặc định + repository gốc,
và xác minh lại qua GitHub API. PR/fork và workflow khác không được dùng deployment credentials.
Receipt staging chỉ xuất sau smoke; production workflow_dispatch trên nhánh mặc định cần environment approval.
Workflow `deploy-environment.yml` dùng chung, không phải điểm chạy thủ công bỏ qua promotion.
Mỗi môi trường chỉ có một job deploy chạy, `cancel-in-progress: false`; không cancel migration đang chạy.
CI có thể cancel lượt CI cũ; concurrency CI và deployment tách nhau.

## Phân tách môi trường

| Môi trường | DB/media | HTTP/credentials | Ghi dữ liệu |
| --- | --- | --- | --- |
| Local | `.runtime/local.env`, dữ liệu của developer | loopback | chủ động theo README |
| Test | SQLite temp hoặc cluster/schema PostgreSQL temp; media temp | loopback, credential giả | fixture/test, không trỏ cloud |
| Staging | DB, media path/storage riêng | Render service, Worker/origin và credentials riêng | migration + fixture test được owner cấp |
| Production | tài nguyên hiện có, không đổi domain | environment production, quyền tối thiểu | chỉ release đã được phê duyệt; smoke chỉ đọc |

Preflight so fingerprint DB (host/port/database/**username**, không có mật khẩu), service ID, Worker name,
backend/public origin với inventory production. Staging trùng một tài nguyên production là lỗi.
Origin được chuẩn hóa host không phân biệt hoa/thường, dấu chấm cuối và port HTTPS mặc định;
DSN có query ghi đè target (`host`, `hostaddr`, `port`, `dbname`, `user`, `service`) bị từ chối.
Production phải khớp inventory. Fingerprint không chứng minh media tách riêng: owner kiểm tra disk/storage path
và bảo đảm không sao chép dữ liệu thật sang test. Không kết nối PC worker staging vào hàng đợi production.

## Secrets và variables

Workflow kiểm tra đủ tên biến/secret ngay sau checkout, trước khi cài dependencies hoặc tải artifact.
Khi thiếu cấu hình, log và GitHub job summary liệt kê đúng các **tên** còn thiếu, không in giá trị.
`.runtime/preflight.json` ghi trạng thái, mã lỗi an toàn và tên setting; workflow giữ file trong
artifact reconcile khi lỗi, kể cả khi chưa có file deploy hoặc chưa cài dependencies.
Kiểm tra hiện diện không thay thế kiểm tra isolation, backup/schema review và staging receipt phía sau.
Biến trong Render Environment không tự được cấp cho GitHub Actions; cần cấu hình tại
repository **Settings → Environments → staging → Variables / Secrets**.

Không đặt giá trị secret trong file, tham số CLI, artifact, job summary hoặc frontend VITE_*.
Secrets dưới đây tạo **riêng trong GitHub Environments staging và production**:

| Secret | Mục đích |
| --- | --- |
| `DATABASE_URL` | migration PostgreSQL owner, TLS; chỉ bước preflight/migration |
| `RENDER_API_KEY` | đọc service/deploy, deploy đúng existing service |
| `CLOUDFLARE_API_TOKEN` | deployment Worker và đọc deployment/version, giới hạn account/Worker |

Variables từng environment:

| Variable | Mục đích |
| --- | --- |
| `BACKEND_ORIGIN`, `PUBLIC_ORIGIN` | HTTPS origin đã được owner cấp |
| `RENDER_SERVICE_ID` | service hiện có, không tạo service qua workflow |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKER_NAME` | account/Worker hiện có |
| `CLOUDFLARE_CONFIG_REVIEWED` | `true` sau khi đối chiếu routes/settings |
| `CLOUDFLARE_ROUTES_JSON` | danh sách routes/custom domains đang có, đúng schema Wrangler, không thay domain |
| `CLOUDFLARE_WORKERS_DEV` | `true` hoặc `false`, giữ trạng thái đang dùng |
| `DATABASE_IDENTITY` | fingerprint DB đã rà soát |
| `EXPECTED_MEDIA_ROOT` | đường dẫn media bền vững đã đối chiếu trên đúng service |
| `MIGRATION_APPROVED` | `true` sau review backup + tương thích schema/release; không phải bằng chứng backup tự động |
| `BACKUP_REFERENCE` | staging: mã inventory backup đã xác minh, cập nhật cho lượt release; production nhận input |

Repository variables chỉ chứa inventory: `PRODUCTION_DATABASE_IDENTITY`, `PRODUCTION_RENDER_SERVICE_ID`,
`PRODUCTION_WORKER_NAME`, `PRODUCTION_BACKEND_ORIGIN`, `PRODUCTION_PUBLIC_ORIGIN`.
Render environment: `DATABASE_URL`, `APP_ENV=production`, `COOKIE_SECURE=true`, `AI_MODE=worker`,
`MEDIA_ROOT` bền vững riêng, `QUAN1_IGNORE_LOCAL_ENV=1`, `AI_WORKER_TOKEN` riêng nếu dùng token môi trường.
Không lưu `RELEASE_SHA` cố định trên Render vì có thể che `RENDER_GIT_COMMIT` của deploy mới.
Cloudflare origin là server-side variable, không phải mật khẩu. PC giữ `AI_SERVER_URL`, `AI_WORKER_TOKEN`,
`OLLAMA_BASE_URL` loopback và `OLLAMA_MODEL`; không có DB credential trên PC worker.

Tính fingerprint bằng `uv run --project services/backend --frozen python scripts/release_preflight.py --database-identity`
trong shell đã nạp DATABASE_URL qua secret manager; chỉ in hash. Không truyền DSN bằng tham số.

## Chính sách security gate và artifact

Gitleaks 8.24.3 quét Git history, redact kết quả; npm audit chặn mức high/critical (gồm dev dependency),
pip-audit 2.9.0 chặn mọi advisory production Python. Scanner lỗi/network lỗi cũng chặn release.
Ngoại lệ source backport node-forge được khóa chặt như mô tả ở trên; không có ignore cả package.
Ưu tiên nâng bản vá + lockfile + regression tests. Ngoại lệ mới cần PR có advisory ID,
lý do không áp dụng, owner và ngày hết hạn; không dùng ignore toàn bộ package hay continue-on-error.
Nếu phát hiện secret thật: thu hồi/rotate trước, kiểm tra lịch sử và artifact bằng kênh hạn chế; không chép secret vào issue.
Browser report/trace chỉ upload khi lỗi, chứa tài khoản/DB giả của test, giữ 7 ngày.
Release artifact giữ 30 ngày, receipt 90 ngày; owner lưu artifact trước khi hết hạn trong kho release hạn chế.
Không upload `.runtime/local.env`, DB dump, media thật, toàn bộ `.runtime`, config chứa credential hay response body cloud.

Các bước dashboard cụ thể: [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md).
Rollback/restore: [ROLLBACK-RUNBOOK.md](ROLLBACK-RUNBOOK.md).
