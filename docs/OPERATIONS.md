# Vận hành quan1tourism

Tài liệu hiện hành: [CI/CD](CICD.md), [deploy](DEPLOYMENT-RUNBOOK.md), [rollback/restore](ROLLBACK-RUNBOOK.md).
Kết quả kiểm thử thực tế và phần chưa xác minh: [CICD-VERIFICATION.md](CICD-VERIFICATION.md).
Không dùng hướng dẫn cũ để suy ra trạng thái dashboard hoặc migration cloud hiện tại.

## Local và test

Backend đọc `.runtime/local.env` nếu không có `QUAN1_IGNORE_LOCAL_ENV=1`; shell có ưu tiên.
Không tự đọc `.env`. Development có thể dùng PostgreSQL local hoặc SQLite `.runtime/quan1.db`, media `.runtime/media`.
Migration local chạy chủ động trước backend bằng `uv run --frozen alembic upgrade head` trong services/backend.
Demo seed chỉ dành local/test; không seed cloud. Không chạy setup_postgresql/import-sqlite lên production.

CI và browser harness đặt IGNORE_LOCAL_ENV, APP_ENV=test, database/media tạm; không kế thừa file cấu hình local.
PostgreSQL integration chỉ nhận loopback database quan1_ci, schema riêng từng test.
Có thể chạy `services/backend/.venv/Scripts/python.exe scripts/test_postgres.py` trên Windows có PostgreSQL18 binaries,
hoặc dùng TEST_POSTGRES_URL loopback và `uv run --frozen pytest --postgres -q -s` trong backend.
Cluster helper khởi tạo trust auth chỉ loopback trên cổng ngẫu nhiên và tự dừng/xóa đúng cluster tạm, không đụng service có sẵn.
Dùng trong máy/runner QA riêng; không dùng trust cluster này làm DB public.

Frontend development vẫn dùng Vite proxy local; artifact build dùng cùng origin `/`, `/admin/`, `/api/v1/...`.
Worker/Pages proxy đặt API no-store và giữ cookie HttpOnly/SameSite/Secure; tile proxy dùng upstream cố định.
Không cache API hoặc đưa secret vào VITE_*. Các domain/service thật giữ nguyên, owner kiểm tra dashboard theo runbook.

## Migration và sức khỏe

Release workflow là migration owner duy nhất: advisory lock PG, backup inventory và revision trước/sau.
Docker CMD và native start command không migrate. Không dùng đồng thời startup migration, Render predeploy và release job.
Không create_all lúc startup, không downgrade/restore tự động. Revision ứng dụng hiện tại 0008; readiness kiểm tra revision.
Rollback ứng dụng chỉ khi binary trước tương thích schema đang có; dữ liệu không tự hạ theo binary.

- `/api/v1/health/live`: process hoạt động.
- `/api/v1/health/ready`: DB truy cập được users và Alembic revision đúng 0008; không phụ thuộc Ollama/Internet.
- `/api/v1/version`: release SHA và worker protocol. Render dùng RENDER_GIT_COMMIT; không đặt RELEASE_SHA cố định gây che bản mới.
- `/release.json`: identity frontend đã build; Worker trả no-store.
- `X-Request-ID`: đối chiếu request; không log cookie/password/worker token/DSN/request body.

Smoke mặc định chỉ GET: chi tiết dùng `?track_view=false`, không ghi lượt nghe/xem; normal visitor vẫn đếm theo hành vi hiện có.
Chỉ admin nhận thống kê; public snapshot bỏ counters, nháp/ẩn không public, nhân sự preview không tăng lượt.
Danh sách public vẫn view_count DESC, id ASC; không có display_order hay thao tác lưu thứ tự.

## Backup, media và sự cố

Trước release: ghi backup DB/schema + media đồng bộ, revision, SHA/Worker version và checksum vào inventory hạn chế.
Không upload dump/media/secret vào GitHub artifact. pg_dump phải phù hợp major server; xác minh pg_restore list và restore thử
vào DB/storage khác. Public schema backup không thay Supabase auth/storage/global objects backup nếu có dùng.
Bảo toàn accounts/sessions, bản dịch/nguồn, releases/audit, media, thống kê/dedup và AI queue/lease/worker pairing.
Hướng dẫn cụ thể và cách giữ dữ liệu phát sinh sau backup nằm ở ROLLBACK-RUNBOOK.

Nếu migration/deploy/poll lỗi: giữ evidence reconcile, kiểm tra deploy ID/revision/lock trước khi retry.
Không bấm Cancel giữa migration; không suy health thành công là commit mới. Khi cần rollback, dừng release mới và theo runbook.
Ảnh upload cần disk bền vững riêng mỗi môi trường; snapshot media và lịch sử audio nếu có không bị xóa khi deploy.
Giới hạn/cache/rate-limit trong bộ nhớ process chưa thay thành dịch vụ trả phí hay distributed service.

## Ollama worker trên PC

Protocol hiện tại **1**: heartbeat/claim/complete qua `/api/v1/worker`, Bearer token riêng; request timeout30s,
heartbeat20s, lease15phút, tối đa3 claim, queue hết hạn24giờ; completion cùng lease có thể retry3lần.
Release API và manifest ghi worker_protocol=1. Client scripts/ollama_worker.py hiện tương thích v1;
server vẫn chấp nhận client v1 cũ, chưa có cơ chế thương lượng version qua header.
Trước thay contract phải giữ tương thích hoặc triển khai quy trình nâng worker thủ công với owner PC.
Cloud pipeline không SSH/cập nhật PC, không mở public port11434 và không cấp credential DB cho PC.

PC chỉ kết nối HTTPS ra backend (HTTP loopback chỉ local). Ollama giữ loopback, TTS vẫn Web Speech API hiện có,
không chuyển sang dịch vụ trả phí. Worker offline chỉ làm admin AI chưa sẵn sàng; public readiness/nội dung vẫn chạy.
Test CI mock inference, HTTP transport, auth, lease, retry, timeout và completion; không tải/chạy model thật.
Khóa worker trong environment có ưu tiên so với pairing hash DB; rotate qua kênh hạn chế, không đưa token vào báo cáo.

## Công việc bên ngoài repo

Owner còn phải áp dụng branch/environment protection, cấp tài nguyên staging riêng, nạp secret,
tắt Render/Workers Builds/Pages/webhook deploy độc lập, kiểm tra runtime/commands/major DB/PostGIS,
routes/domain, media isolation, backup/restore drill và chạy staging thật.
Nhiệm vụ hoàn thiện repo không phải bằng chứng production đã sẵn sàng hoặc được deploy.
