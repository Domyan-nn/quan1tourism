# Chẩn đoán staging deployment — 24/10/2026

Lần lỗi: [Deploy staging 40107265455](https://github.com/Domyan-nn/quan1tourism/actions/runs/40107265455), commit `d33e7aa7de6409704d3ef154a97f06b66312be06`.
Quality checks của commit này thành công. Job provenance thành công; deploy dừng tại
**Verify environment isolation and promotion evidence**, trước migration và trước bước gọi Render/Cloudflare.

Đọc GitHub API xác nhận Environment `staging` không có Variables hoặc Secrets; repository cũng không có
Actions Variables/Secrets để kế thừa. Environment `production` có ba biến URL/Worker nhưng không cấp chúng
cho staging. Cấu hình Supabase Storage vừa nhập trên Render phục vụ ảnh của backend, không cung cấp ba
credential triển khai cho GitHub Actions.

## Bản sửa workflow

`release_preflight.py --configuration-only` chỉ dùng thư viện chuẩn, chạy ngay sau checkout và trước npm/uv.
Thiếu cấu hình thì báo đầy đủ tên biến/secret và nơi nhập trong GitHub Settings; không in DSN, token hoặc
giá trị API key. Log annotation và job summary có cùng chẩn đoán. Lỗi cấu hình DB, identity, backup/schema
hoặc staging receipt được phân loại bằng thông báo cố định, không in exception nhạy cảm.

Giữ nguyên các điều kiện: staging phải khác production về DB identity, Render service, Worker và origins;
backup/schema review phải có thật; production chỉ promote receipt của cùng artifact. Không bỏ gate, dùng
`continue-on-error`, hoặc biến một deployment chưa chạy thành deployment thành công.

Kiểm chứng local: 23 kiểm thử release-control/preflight qua, gồm chạy precheck bằng Python `-S` không có
SQLAlchemy, thiếu cấu hình đầy đủ, không lộ secret trong log/summary và staging trùng production bị từ chối.
Toàn bộ backend trên SQLite: 220 kiểm thử qua, 6 kiểm thử PostgreSQL bỏ qua. Actionlint và Ruff qua.
Chưa có bằng chứng staging deploy thành công vì tài nguyên/configuration còn thiếu.

## Cấu hình cần có để chạy staging

Trước tiên cần Render service, database/project và Cloudflare Worker/origin dành riêng cho staging.
Không dùng các URL production hiện tại làm URL staging. Sau đó đặt tại **GitHub repository → Settings →
Environments → staging**:

| Loại | Tên |
| --- | --- |
| Secrets | `DATABASE_URL`, `RENDER_API_KEY`, `CLOUDFLARE_API_TOKEN` |
| Variables | `BACKEND_ORIGIN`, `PUBLIC_ORIGIN`, `RENDER_SERVICE_ID`, `CLOUDFLARE_WORKER_NAME`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_CONFIG_REVIEWED`, `CLOUDFLARE_ROUTES_JSON`, `CLOUDFLARE_WORKERS_DEV`, `DATABASE_IDENTITY`, `EXPECTED_MEDIA_ROOT`, `MIGRATION_APPROVED`, `BACKUP_REFERENCE` |
| Inventory production, repository Variables hoặc environment Variables | `PRODUCTION_DATABASE_IDENTITY`, `PRODUCTION_RENDER_SERVICE_ID`, `PRODUCTION_WORKER_NAME`, `PRODUCTION_BACKEND_ORIGIN`, `PRODUCTION_PUBLIC_ORIGIN` |

Ý nghĩa từng biến và hướng dẫn fingerprint nằm ở [CICD.md](CICD.md#secrets-và-variables), quy trình triển khai
ở [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md). `SUPABASE_SECRET_KEY` là key đọc/ghi object Storage cho backend;
nó không cấp quyền triển khai Render hoặc Cloudflare. Không đặt cờ review hoặc mã backup giả để qua preflight.
