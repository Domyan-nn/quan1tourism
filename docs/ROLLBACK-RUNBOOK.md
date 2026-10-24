# Rollback ứng dụng và phục hồi dữ liệu

Không tự `alembic downgrade`, không restore đè DB đang chạy. Rollback ứng dụng và khôi phục dữ liệu là hai quy trình riêng.
Nhiệm vụ này không deploy/rollback cloud hoặc ghi dữ liệu production. Đối chiếu tên danh mục từ xa chỉ dùng SELECT, lượt xác minh cuối trong transaction READ ONLY.

## Rollback ứng dụng

1. Dừng nhận release mới ở môi trường cần xử lý; không cancel migration đang chạy. Incident owner đối soát migration/deploy ID,
   revision hiện tại, previous backend SHA/Render deploy ID, Worker versions và manifest trong receipt/reconcile artifact.
   Giữ DB, media, thống kê, sessions, lịch sử và AI jobs/leases đang có; không chạy seed.
2. Kiểm tra tương thích schema với **đúng bản trước**: cột được thêm có default, không có rename/drop hay thay ý nghĩa;
   binary trước đọc/ghi được schema hiện tại. Test CI kiểm tra projection `0007`/`0008` trên schema `0009` và dữ liệu giữ nguyên,
   không thay thế chạy binary production trước trong staging. Dùng staging DB/media riêng phục hồi từ backup được phép,
   chạy app trước và test login/POI/draft/ảnh/text/counters/AI queue; không gửi email/worker job ra production.
   Nếu chưa chứng minh tương thích, chọn hotfix forward hoặc maintenance; không tự hạ schema.
   Backend 0008 kiểm tra readiness revision cứng, nên không rollback binary đó trực tiếp lên 0009. Chuẩn bị bản tương thích và diễn tập trước; xem [NARRATION-GPS.md](NARRATION-GPS.md).
3. Backend: trên existing Render service, dùng Dashboard Manual Deploy → Deploy a specific commit của previous SHA
   hoặc rollback existing successful deployment đã ghi. Giữ Auto-Deploy Off, không thay env/domain/disk.
   Nếu binary trước còn migration startup thì owner phải kiểm tra tương thích/head và loại bỏ startup migration theo quy trình
   maintenance trước khi chạy; không cho binary đó tự mutate schema. Poll đúng deploy ID tới `live`, xác minh commit/version.
   Bản trước chưa có version endpoint cần bằng chứng commit từ Render API và probe riêng qua origin; không kết luận từ health xanh.
4. Frontend/Worker: trong chính Worker hiện có, dùng Cloudflare Deployments → Roll back tới previous version ID từ receipt,
   hoặc `npx wrangler rollback <previous-version-id> --name <existing-worker-name>` với credential môi trường qua secret manager.
   Đối chiếu bundled assets/config/origin của phiên bản đó; không đổi routes/domain. Nếu version không còn khả dụng,
   dùng release bundle trước đã lưu, xác minh SHA256 và deploy với cấu hình môi trường đã rà soát.
   Không build lại từ nhánh latest. Tránh frontend gọi API không tương thích trong khoảng rollback; owner chọn thứ tự theo contract.
5. Chạy smoke read-only qua origin công khai với expected previous SHA; so API release và `/release.json`, `/admin/`, assets,
   privacy/auth/cookie/cache. Bản trước chưa hỗ trợ `track_view=false` không được gọi GET detail nếu chưa đăng nhập tài khoản
   nhân sự được phép; dùng list + kiểm tra detail qua môi trường rehearsal để tránh làm tăng thống kê production.
6. Ghi incident, backend/Worker IDs mới và schema được giữ, kết quả smoke, dữ liệu/queue/media vẫn đủ.
   Mở lại release khi đã có quyết định owner. Không tự động rollback database khi smoke lỗi.

## Backup trước release

Backup inventory phải chỉ ra timestamp, PostgreSQL major, Alembic revision, backend SHA, Worker version,
checksum/archive index, media snapshot ID và mã hóa/retention/access control. Không đưa dump/media/DSN vào GitHub artifact.
Với PostgreSQL dùng pg_dump custom-format đúng major hoặc mới hơn server; kiểm tra `pg_restore --list` và SHA256.
Đưa credential qua secret manager/PGPASSFILE hạn chế quyền, không URL có mật khẩu trên command line hoặc log.
App public schema gồm users/sessions, POI/bản dịch/nguồn, media metadata, releases/audit, statistics/engagements,
identity và AI jobs/workers/lease/token hash; giữ đủ, không chỉ dump POI.
Supabase auth/storage/role/extension/global objects cần backup riêng nếu đang dùng; dump public không thay thế backup toàn project.
Sao lưu toàn bộ media bền vững cùng mốc dữ liệu; nếu không có snapshot đồng bộ, ngừng API/admin/worker ghi theo maintenance window.

## Diễn tập restore vào môi trường riêng

1. Owner cấp DB/credentials/storage và origin rehearsal riêng, xác minh fingerprint khác production/staging;
   không tự tạo tài nguyên production hoặc tự nối rehearsal vào PC worker thật. Dùng bộ dữ liệu giả khi có thể;
   backup thật chỉ ở môi trường có quyền bảo vệ dữ liệu, không trong CI bắt buộc.
2. Kiểm tra archive SHA256 và pg_restore list; restore vào **DB trống riêng** bằng pg_restore có `--exit-on-error`,
   mapping owner/role phù hợp RLS. Không dùng `--clean` lên DB đang phục vụ. Khôi phục media vào thư mục/bucket riêng,
   giữ filenames/checksums, metadata và các URL media lịch sử.
3. Ghi revision gốc, số bản ghi từng nhóm và checksum dữ liệu quan trọng trước/sau; xác minh accounts/sessions,
   unicode translations/source, draft/published/hidden, historical release/audit, statistics/dedup rows,
   queued/running/completed AI jobs và lease/worker pairing. Không bật queue consumer thật: lease hết hạn có thể làm job chạy lại.
4. Chạy binary trước trên schema restore, rồi nâng schema mới trong rehearsal nếu muốn thử forward recovery.
   Chạy readiness, login với tài khoản test riêng, list/detail, private/public media, admin preview không tăng lượt,
   counters/concurrency trên bản sao và mocked worker protocol. Đo RTO/RPO, lưu bằng chứng không có dữ liệu cá nhân trong báo cáo.
5. Nếu production cần restore thực tế, owner phải có quyết định incident riêng, maintenance/write freeze,
   kế hoạch bảo toàn dữ liệu phát sinh sau backup, cutover có thể quay lại và kiểm tra toàn bộ media/AI queue.
   Runbook này **không** cho phép tự restore/downgrade production.

Giới hạn: CI đã có rehearsal migration/data preservation, không phải bằng chứng restore backup production.
Version/retention Cloudflare và khả năng rollback Render phải kiểm tra trong dashboard trước release.
