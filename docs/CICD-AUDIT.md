# Audit CI/CD — 23/10/2026

Đã đọc source hiện tại, git status ban đầu sạch; không tìm thấy AGENTS.md ở repo/cha hoặc cây source.
Đã đọc `.github/workflows/checks.yml`, package.json/package-lock.json, pyproject.toml/uv.lock,
playwright.config.mjs, Dockerfile/render.yaml/wrangler.jsonc, e2e_backend.py, toàn bộ nhóm tests,
CLOUD-DEPLOYMENT.md/OPERATIONS.md/MAPS-STATISTICS.md và các module/migration liên quan.
Những nhận định cloud trong tài liệu cũ chỉ là cấu hình/ghi chép, chưa phải trạng thái đã xác minh dashboard.

| Hạng mục | Bằng chứng đã đọc | Đã có ban đầu | Thiếu ban đầu | Ưu tiên | Cách sửa trong repo |
| --- | --- | --- | --- | --- | --- |
| Kiến trúc | apps/web, apps/admin, packages, services/backend, cloudflare, functions | React/TS, FastAPI/SQLAlchemy/Alembic; pull worker PC | không có native app | P2 | giữ phạm vi hiện tại, không thêm Expo |
| Lockfile | npm lock v3; uv.lock và Dockerfile | npm ci, uv sync trong CI | Docker pip cài từ khoảng version | P0 | uv frozen production trong Docker |
| Quality gate | checks.yml chỉ một job Windows | Ruff/pytest/typecheck/build/E2E | timeout riêng, dependency graph/CI tổng | P0 | jobs độc lập + Quality gate, timeout/concurrency |
| PostgreSQL | tests/conftest.py cố định SQLite | tests thống kê/permission SQLite | PostgreSQL migration/race/30 phút | P0 | service PG18, loopback guard, schema từng test, full API suite |
| Migration | migrations 0001..0008; test_migration.py | SQLite unicode preservation | PG base/previous/data/RLS; lock release | P0 | PG tests; advisory lock; bỏ startup Alembic |
| Phiên PostgreSQL | auth.optional_user dùng replace(tzinfo) | expiry test SQLite | offset PG có thể kéo dài phiên | P0 | giữ timezone aware + regression offsets/PG |
| Bản đồ/statistics | engagement.py, maps-statistics tests/E2E | popularity+id, no public counters; admin only; atomic upsert | chưa chứng minh trên PG | P0 | chạy các invariants trên PG; giữ UI/TTS/coordinates |
| Tile/proxy | tests/cloudflare-map-tiles.test.mjs, Worker/Pages | tile 200/502 validation test | không gọi CI, thiếu typecheck/proxy cookie tests | P0 | node --test CI, edge tsc, proxy mocks/errors/timeouts |
| Browser/artifact | Playwright channel msedge, Vite servers | desktop/mobile, speech mock | browser cài rõ; artifact routes; external mocks | P0 | Chromium managed, built server, offline fixture, smoke compiled site |
| Worker packaging | wrangler.jsonc build-site | source deploy command | dry-run gate, hashed release asset | P1 | dry-run bundle + manifest SHA256 |
| Docker verification | Dockerfile, .dockerignore | multi-stage frontend/backend | build/runtime check; production lock | P0 | CI docker build, ephemeral smoke, dependency version verification |
| Dependency/secret | lockfiles | không có scanner | advisory gate/history scan | P0 | Gitleaks redact, npm high, pip-audit; vá Pillow13 |
| Staging | CLOUD-DEPLOYMENT.md | origin Render/Worker mô tả | isolated inventory, gated deployment, migration owner, smoke | P0 | staging workflow + reusable release, identity preflight |
| Production | chưa có release workflow | existing resources được mô tả | manual staging promotion/environment/receipt | P0 | workflow_dispatch, same bundle, environment concurrency false |
| Deploy identity | health live/ready | process + users table | commit/asset identity; poll Render | P0 | version endpoint, release.json, deploy ID polling+smoke; readiness revision |
| Auto-deploy | docs nói Workers Builds liên kết GitHub | cấu hình độc lập | có thể vượt CI | P0 | render.yaml off; dashboard checklist tắt auto builds/webhooks; API preflight |
| Smoke/read-only | GET detail ghi view | stats dedup/privacy tests | smoke production làm tăng view | P0 | track_view=false có regression, no writes smoke |
| Rollback/backup | migrate_cloud.py, OPERATIONS.md | backup trước cloud migration có trong tool cũ | app rollback, independent restore drill, compatibility | P0 | runbook backup/restore/rollback, receipt previous IDs |
| PC worker | ollama_worker.py, ai_jobs tests | auth, lease, durable queue; outbound HTTPS | client mock retry/timeout/results tests; protocol release | P1 | test_ollama_worker, retry budget/TTL, protocol1 docs; readiness tách worker |
| Tài liệu | OPERATIONS.md có nhiều đoạn lạc hậu | hướng dẫn local/cloud/maps | authoritative CI/CD/runbook/verification | P1 | tài liệu mới + sửa hướng dẫn cũ |

**Phân biệt bằng chứng:** bảng này là audit cấu hình/source. Lệnh thực sự chạy và kết quả cuối ở
[CICD-VERIFICATION.md](CICD-VERIFICATION.md). Dashboard GitHub/Render/Cloudflare/Supabase, secret, major cloud,
disk/media isolation, backup thật và live deployment chưa có quyền/bằng chứng kiểm tra; workflow không chứng minh chúng đã tồn tại.
