# Ảnh bền vững trên Supabase Storage

Điều tra 24/10/2026 trên bản `f2f7c0a`: cả ba ảnh upload trả 404 “Tệp hiện không có sẵn.” từ backend, dù metadata còn và bucket private `place-images` có ba object. Code cũ chỉ ghi/đọc `MEDIA_ROOT`; tên object upload thủ công khác tên UUID trong metadata. Dữ liệu filesystem ngoài persistent disk của Render mất sau restart/deploy ([Render](https://render.com/docs/disks)). Báo cáo riêng ở `.runtime/media-diagnosis.json`, không đưa credential/ảnh nghiệp vụ vào Git.

## Bản vá

- Upload vẫn kiểm tra ảnh thật JPG/PNG/WebP, MIME, 10MB và 20 triệu pixel. Production mặc định yêu cầu Supabase; cấu hình thiếu hoặc upload lỗi trả lỗi, không báo đã lưu rồi rơi về filesystem tạm.
- `Media.filename` là locator nội bộ: basename local cũ hoặc `supabase://bucket/object-key`, nằm trong giới hạn VARCHAR(120) hiện có. Không cần migration; không đổi `image_id`, URL frontend, POI hay release snapshot. Object mới dùng UUID riêng, `x-upsert:false`, không ghi đè ảnh cũ.
- `/api/v1/media/{id}` kiểm tra quyền hiện hữu trước, rồi backend đọc private object và xác minh size/SHA-256. Browser không nhận key hoặc URL ký hết hạn; restart backend không mất locator đã lưu trong PostgreSQL. Ảnh local cũ còn file vẫn đọc được.
- Lỗi trước commit dọn object mới khi có thể. Nếu mất xác nhận COMMIT, giữ object vì transaction có thể đã thành công; không xóa nhầm file đang được tham chiếu. Orphan có thể được kiểm tra riêng sau này, không tự xóa ảnh cũ/lịch sử.

## Cấu hình backend Render

```dotenv
MEDIA_STORAGE_DRIVER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_STORAGE_BUCKET=place-images
SUPABASE_SECRET_KEY=<server-secret-key>
```

Giữ bucket private. Ưu tiên key backend `sb_secret_...`; cũng hỗ trợ biến `SUPABASE_SERVICE_ROLE_KEY` cho service_role JWT cũ nếu chưa chuyển key. Key mới dùng header `apikey`, key JWT cũ dùng thêm Bearer theo [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys). Key chỉ đặt ở backend/secret manager hoặc `.runtime/local.env` đã gitignore, không đặt trong biến `VITE_*`. Không tự đổi bucket thành public.

`render.yaml` có cấu hình tương ứng; file YAML trong repo không chứng minh Environment của service có đủ giá trị. Cần cấu hình biến trên service đang dùng và deploy/restart bản vá để áp dụng. Local có thể giữ `MEDIA_STORAGE_DRIVER=local`; muốn thử Supabase local đặt cùng các biến trên. `MEDIA_ROOT` chỉ còn cần cho file legacy hoặc lựa chọn local rõ ràng trên disk bền vững.

Storage dùng API authenticated download ([hướng dẫn](https://supabase.com/docs/guides/storage/serving/downloads)), không phụ thuộc signed URL được lưu lâu dài. Không cần thêm SDK, database hoặc dịch vụ mới.

## Nối lại các ảnh đã có

Không tự ghép tên/dung lượng: tên “City Hall” có thể không tương ứng tên POI; phải so SHA-256 với metadata của ảnh đã upload. Khớp hash chứng minh đúng byte của ảnh đã upload, không chứng minh ảnh đúng địa điểm. Công cụ chỉ thay locator của media sau khi xác minh bytes khớp, giữ nguyên nội dung/ID/trạng thái công khai.

1. Cấp `MEDIA_AUDIT_DATABASE_URL` riêng qua môi trường rồi xuất inventory chỉ đọc. Không tự dùng DATABASE_URL của app:

```powershell
services/backend/.venv/Scripts/python.exe scripts/audit_media_storage.py --allow-remote-read --output .runtime/media-storage-snapshot.json
```

2. Với cấu hình Storage backend có sẵn, chạy dry-run. Chỉ GET object để kiểm tra hash; không upload, xóa file hoặc sửa DB:

```powershell
services/backend/.venv/Scripts/python.exe scripts/link_supabase_media.py --snapshot .runtime/media-storage-snapshot.json --plan .runtime/media-link-plan.json
```

3. Review `matched/unmatched`, các locator trước/sau và xác minh đúng môi trường. Backup metadata trước khi áp dụng. Cấp `MEDIA_REPAIR_DATABASE_URL` riêng, triển khai backend hỗ trợ locator trước, rồi mới chạy:

```powershell
services/backend/.venv/Scripts/python.exe scripts/link_supabase_media.py --apply --allow-remote-write --plan .runtime/media-link-plan.json
```

Script kiểm tra lại object bytes, khóa/CAS metadata và POI đang tham chiếu, ghi audit `media_storage_link` trong cùng transaction. Kế hoạch cũ hoặc object đổi bytes bị từ chối; lỗi rollback toàn bộ. Không tự sửa nội dung ảnh hoặc công bố lại POI. Chưa chạy apply lên production trong quá trình viết bản vá.

## Kiểm chứng và rollback

Kết quả local của bản vá: 222 pytest trên PostgreSQL 18.6; 216 pytest SQLite qua, 6 ca chỉ dành cho PostgreSQL được bỏ qua; riêng 19 ca media/recovery qua. Ruff, typecheck admin/web/edge, build site và 14 ca Playwright quản trị desktop/mobile qua. Quét mã nguồn mới không phát hiện secret. Có warning TestClient/httpx và datetime adapter SQLite; không ảnh hưởng kết quả các ca kiểm thử.

Pytest bao phủ upload/private/public, filesystem mới rỗng, lỗi Storage không thay ảnh cũ, lỗi trước commit, mất xác nhận commit, sai hash/thiếu object, credentials không ra browser/redirect, cấu hình production, Unicode object key và recovery chỉ thay locator có audit. Transport Storage trong test là mock; kiểm chứng cloud thật cần key của project, không coi mock là đã khôi phục ba ảnh thật.

Giữ metadata trước/sau trong kế hoạch và backup; không xóa object để rollback. Binary cũ không hiểu locator Supabase, nên rollback code cần giữ một backend có reader tương thích hoặc kế hoạch phục hồi local từ byte đã kiểm chứng. Backup PostgreSQL không chứa bytes Storage; cần backup object riêng. Không gỡ persistent disk cũ nếu vẫn chứa ảnh legacy cần giữ.
