# Runbook staging và production

Các workflow đã được chuẩn bị trong repo; chưa thực thi trên cloud trong nhiệm vụ này.
Chỉ người phụ trách có quyền mới bật cấu hình dưới đây. Không tạo DB/service production mới, không đổi domain.

Mã mới dùng schema `0009`, PC worker protocol `2`; chưa áp dụng lên cloud trong đợt GPS/TTS/bản dịch này.
Backup DB/media và đối chiếu source trước migration; cập nhật/restart PC bằng thao tác riêng của owner.
Không tự phục hồi tên danh mục production từ dấu hỏi: danh sách ID/nguồn đối chiếu nằm local trong `.runtime/category-repair-review.json` và còn chờ xác minh.
Xem [NARRATION-GPS.md](NARRATION-GPS.md) cho cách dùng, sửa danh mục trên restore và giới hạn rollback binary 0008.

## Một lần trước khi bật CD

1. GitHub Settings → Rules → ruleset nhánh mặc định: bật required checks trong [CICD.md](CICD.md), review PR,
   hạn chế người sửa workflow/protection. Settings → Environments: staging/production, secrets riêng,
   deployment branches chỉ nhánh mặc định, production required reviewer và prevent self-review nếu gói hỗ trợ.
2. Kiểm tra service Render đang dùng là Git-backed Docker hay native Python; giữ service ID/domain.
   Settings → Build & Deploy → Auto-Deploy **Off**. `render.yaml` chỉ là tham khảo, không Apply Blueprint tạo tài nguyên.
   Tắt Blueprint auto-sync nếu nó có thể ghi đè setting này. Thu hồi/ngừng webhook, pipeline cũ và lịch deploy độc lập.
3. Docker: root repo, Dockerfile `Dockerfile`, context `.`, Docker Command trống để dùng CMD.
   Native Python: Root Directory `services/backend`, Build Command **`uv sync --frozen --no-dev`**,
   Start Command **`uv run --frozen --no-dev uvicorn app.main:app --host 0.0.0.0 --port $PORT`**.
   Xóa migration khỏi startup và **Pre-Deploy Command**. Workflow sở hữu migration; không cấu hình migration ở hai nơi.
   Script preflight từ chối runtime/command không khớp thay vì tự sửa service.
4. Nếu service hiện đang chạy release cũ có `alembic upgrade` lúc startup, lên lịch chuyển giao migration owner:
   dừng mọi deploy/restart tự động, kiểm tra không có migration đang chạy, backup rồi mới bật luồng mới.
   Không để bản cũ restart trong lúc release migration chạy. Không đổi runtime bằng cách tạo service thay thế tự động.
5. Render environment: kiểm tra PostgreSQL TLS, migration owner, DB thật, MEDIA_ROOT và disk bền vững hiện có.
   Staging cần DB/media/origin/service/credential riêng do owner cấp; nếu chưa có thì workflow dừng ở preflight.
   Không tự mua plan/disk hoặc tạo cloud service trong nhiệm vụ này. Kiểm tra major PostgreSQL cloud bằng `SHOW server_version`;
   Cloud đã đọc phiên bản 17.11, revision 0008; CI chuẩn bị matrix 17/18, local có bằng chứng chạy 18.6.
   Kiểm tra PostGIS, quyền extension và kết quả cả hai major trong CI trước release.
6. Cloudflare → Workers & Pages → chọn Worker hiện có → Settings → Builds: ngắt Git integration hoặc tắt automatic builds/deploys
   cho production và staging. Tắt Pages auto deployment nếu vẫn còn project phụ cùng domain.
   Chỉ đổi deploy command thành `versions upload` chưa đủ để có một nguồn release duy nhất; ưu tiên ngắt auto-deploy.
   Đối chiếu Domains & Routes, workers.dev và vars. Lưu đúng routes JSON hiện có vào environment variable, không thay domain.
7. Cấp token Cloudflare tối thiểu Worker Scripts write/read và Assets upload, account read cần thiết;
   token Render hạn chế workspace. Kiểm tra API có thể đọc service/deploy/version; không dùng deploy hook thay polling.
   Nạp secrets/variables theo [CICD.md](CICD.md), đối chiếu fingerprint staging khác production.
   Render preflight cần quyền đọc env-vars: chỉ xử lý trong RAM, đối chiếu fingerprint DATABASE_URL thực tế của Render
   với migration target, APP_ENV/COOKIE_SECURE/AI_MODE/IGNORE_LOCAL_ENV và EXPECTED_MEDIA_ROOT; không log/lưu API body.
   Nếu env-vars API không trả đủ cấu hình (ví dụ cấu hình nhóm chưa được hỗ trợ), dừng và rà soát bằng owner, không bỏ gate.
8. Tạo fixture công khai **riêng staging** qua admin và kiểm tra nội dung/ảnh/TTS. Không seed demo trên production.
   Public smoke yêu cầu có ít nhất một POI đã xuất bản. DB rỗng chỉ được bỏ qua trong Docker CI tạm.

Ghi ngày, người kiểm tra, existing resource IDs, major DB, disk/media và trạng thái auto-deploy vào inventory hạn chế.
Repo không chứng minh settings dashboard đã được áp dụng. Đừng đặt `CLOUDFLARE_CONFIG_REVIEWED=true` trước bước 6.

## Mỗi staging release

1. Có backup DB + media đã kiểm tra/checksum và biên nhận restore gần đây; cập nhật `BACKUP_REFERENCE` staging.
   Review migration diff, thời gian khóa, cách bản trước chạy trên schema mở rộng; đặt `MIGRATION_APPROVED=true` cho lượt đã review.
   Thay đổi phá tương thích cần expand/contract nhiều release và maintenance có kiểm soát; không dùng luồng này để xóa cột/dữ liệu.
2. Merge/push vào nhánh mặc định. Quality checks chạy toàn bộ; workflow staging chỉ nhận run success của cùng repo/nhánh/event push.
3. Environment lock giữ suốt migration → deploy backend → Worker → smoke. Không bấm Cancel giữa migration.
   Runner kiểm tra isolation/artifact, Render autoDeploy off và không có deploy khác; lưu phiên bản trước của Render/Worker.
4. `release_migrate.py` khóa session advisory PostgreSQL, đặt lock timeout 15 giây/statement timeout 10 phút,
   ghi revision trước, `alembic upgrade head` một lần, revision sau và backup ID. Không seed, downgrade hay restore.
   Startup/predeploy của Render không chạy Alembic. Session lock tự nhả khi mất kết nối; phải đối soát sau runner interruption.
5. Render API nhận full commitId. Script ghi deploy ID ngay khi trigger và poll tối đa 30 phút; HTTP 201 chưa phải hoàn tất.
   Chỉ `live` + commit khớp mới đi tiếp. API smoke đọc `/api/v1/version` qua HTTPS origin backend để phát hiện health của bản cũ.
6. Wrangler deploy bundle/asset đã checksum từ CI, config môi trường đã review, không build lại frontend.
   Smoke origin công khai dùng `--worker`, kiểm tra `/`, `/admin/`, JS/CSS sau build, live/ready, API/frontend/Worker release,
   danh sách/chi tiết public không lộ thống kê, khách bị từ chối admin, cookie/no-store, tile PNG và tọa độ sai 404.
   Upstream tile/API lỗi được kiểm thử bằng mock trong CI; không cố tình làm hỏng upstream cloud để tạo lỗi.
7. Chỉ sau smoke mới có `staging-receipt`. Receipt ghi SHA, CI run, manifest digest, revision trước/sau,
   backup inventory ID, Render trước/sau, Worker deployment/version trước/sau và worker protocol.
   Owner kiểm tra readiness khi PC worker offline vẫn thành công. AI generation không nằm trong public readiness.

## Production release chủ động — không chạy trong nhiệm vụ hiện tại

1. Kiểm tra staging receipt, functional QA và compatibility với bản production đang chạy; không chỉ dựa vào revision `0007` fixture.
   Giữ artifact/Worker version/backend commit trước. Backup bao gồm DB/schema + media + AI queue/leases/statistics cùng thời điểm.
   Xác minh backup inventory/restore drill trước khi cấp approval; mã backup không phải signed URL hoặc credential.
2. GitHub Actions → **Release production** → Run workflow trên nhánh mặc định, nhập successful `staging_run_id`
   và `backup_reference`. Không nhận SHA tùy ý. Reviewer kiểm tra fingerprint/resource inventory, revision,
   backup, downtime dự kiến (disk Render có thể làm mất zero downtime) và approve environment production.
3. Workflow xác minh lại staging/CI, tải **cùng** immutable artifact và so manifest digest trước cloud write,
   rồi thực hiện các bước migration/deploy/poll/smoke như staging với secret production riêng.
4. Smoke mặc định chỉ đọc. Chi tiết dùng `?track_view=false`, không POST events, đăng nhập, tạo POI hay gọi model.
   Không làm tăng lượt xem/lượt nghe giả. Không cần tài khoản production cho smoke. Các thao tác ghi chỉ thuộc test/staging được cấp riêng.
5. Lưu production receipt và release artifact vào kho vận hành trước khi GitHub retention hết hạn.
   Theo dõi error rate/latency, login, media, queue lease và Worker rollback window.

## Khi lỗi hoặc runner bị ngắt

Không trigger lại Render một cách mù quáng. Tải artifact `*-reconcile-*`, lấy deploy ID và migration progress,
đối chiếu Render dashboard + `alembic_version` + advisory lock bằng công cụ hạn chế.
Nếu poll timeout mà Render vẫn deploy, chờ trạng thái cuối; không suy từ timeout rằng deploy đã hủy.
Nếu migration đã thành công còn deploy lỗi, giữ schema mở rộng và rollback ứng dụng theo runbook.
Nếu cần chạy lại cùng release, xem Render live ID trước, không tự động retry cả release với backup cũ.
GitHub concurrency chỉ điều phối GitHub; việc tắt deploy/dashboard/webhook khác và advisory lock DB vẫn bắt buộc.
GitHub có thể thay lượt pending khi có nhiều commit: chỉ một job đang chạy; receipt xác định release thực tế.

Tài liệu nền: [Render Trigger Deploy](https://api-docs.render.com/reference/create-deploy),
[Render deploy lifecycle](https://render.com/docs/deploys),
[Render Docker build arguments](https://render.com/docs/docker),
[Cloudflare versions/deployments](https://developers.cloudflare.com/workers/versions-and-deployments/).
