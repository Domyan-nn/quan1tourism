# Audit backend và admin · 25/10/2026

HEAD ban đầu: `95468e03cec87d56ccadc9ff7648998ffb7a6b51`; cây làm việc sạch. Không tìm thấy `AGENTS.md` trong workspace hoặc các thư mục cha được kiểm tra. Không deploy, push, seed hoặc sửa dữ liệu hiện có.

| Vấn đề | Bằng chứng trước sửa | Mức độ | Kết quả / cách sửa | Cách kiểm chứng |
| --- | --- | --- | --- | --- |
| Bản nháp ngôn ngữ bị tắt lọt vào release công khai | `mark_reviewed` bỏ qua ngôn ngữ tắt nhưng snapshot/public projection vẫn chứa toàn bộ `translations`. Regression `test_publishing_does_not_approve_hidden_language_content` thất bại tại assertion public không chứa `fr` trước sửa. | P0 | **Đã sửa**: snapshot mới ghi `published_language_codes` trong JSON hiện có; public chỉ trả giao của locale đã công bố và locale đang bật. Bật lại locale không tự công bố nháp. Raw snapshot vẫn giữ text để phục hồi có kiểm soát. `translation.published` cũng dựa vào danh sách đã công bố. | Test tắt FR → công bố VI/EN → public list/detail không có FR → bật FR vẫn chưa lộ → admin công bố lại mới có FR. |
| Ghi chú nội bộ người duyệt lộ sau công bố | `serialize` ghi `note` vào snapshot; `text_snapshot` trước đây giữ nguyên trường này. Test hành trình submit → reject kèm ghi chú → admin công bố bằng PUT thất bại trước sửa vì public detail chứa `note`. | P0 | **Đã sửa**: projection loại `note` khi đọc release, áp dụng cả snapshot legacy. Raw snapshot và API admin tiếp tục giữ ghi chú. | Regression kiểm tra anonymous list/detail không có trường hoặc nội dung ghi chú, admin vẫn đọc được; lặp với snapshot legacy không có marker locale. |
| Lưu thông tin thành công, ảnh lỗi chỉ hiện lỗi chung | `Editor.persist` lưu POI rồi upload; catch ngoài không phân biệt bước đã lưu. Retry lặp PUT thông tin. | P0 | **Đã sửa**: checkpoint sau mỗi bước, thông báo thông tin đã lưu/ảnh chưa tải lên hoặc chưa xác nhận; giữ form/ảnh và chỉ thử lại bước còn thiếu. | E2E `saving with an image retries the storage step…`, backend giả lập Supabase 503. |
| Ảnh lưu thành công nhưng cập nhật trạng thái cuối lỗi khiến retry upload lại | `setImageFile(null)` từng nằm sau PUT cuối cùng. Mất response upload cũng không có khóa nhận lại request. | P0 | **Đã sửa**: xóa ảnh chờ ngay sau upload thành công; giữ trạng thái hiển thị mong muốn. `upload_id` tùy chọn nhận lại upload đã commit, không thêm media/audit/revision; vẫn chặn khác checksum/địa điểm hoặc revision mới. | Hai backend regression idempotency; E2E mất response upload và PUT trạng thái 503 kiểm tra 1 POI, 1 upload audit, 1 ảnh sau reload. |
| Ngữ cảnh đã lưu/chưa lưu/bản du khách đang thấy | Trước đây notice bản công khai cũ chỉ hiện khi `saved.status !== published`, thiếu khi đang sửa form của bản published. | P1 | **Đã sửa**: notice luôn nêu saved revision hoặc thay đổi chưa lưu, tình trạng public và bước công bố; nháp mới giữ riêng. | E2E admin và screenshot lỗi ảnh desktop/mobile; kiểm tra DOM trong suite tổng hợp. |
| Duyệt theo hash, quyền, revision và public snapshot | `narration_review.py`, `Poi.__mapper_args__.version_id_col`, `StaleDataError` → HTTP409, quyền admin trên mutations, tests có sẵn. | P0 | **Đã có sẵn, giữ nguyên**. Validator/lưu AI vào nháp không tạo duyệt; nội dung cũ không được suy luận đã duyệt; draft không sửa release. | `test_narration_review.py`, `test_workflow.py`, `test_accounts.py`, `test_maps_statistics.py`, PostgreSQL suite. |
| AI nguồn/đích/revision, validation độc lập, không auto-publish | `translation_validation.py`, `narration_jobs.py`, `ai_jobs.py`, tests pipeline/worker/import. | P0 | **Đã có sẵn, giữ nguyên**. Worker và backend kiểm tra output riêng, mã lỗi an toàn, retry giới hạn. | Backend suite dùng corpus/mocks; model thật chưa được nghiệm thu trong nhiệm vụ này. |
| Tọa độ và cấu hình GPS draft/public | Pydantic kiểm tra cặp tọa độ/radius và không auto khi thiếu vị trí; release snapshot tách draft. | P0/P1 | **Đã có sẵn, giữ nguyên**; checkbox/hint thiếu tọa độ được cập nhật ở phần frontend dùng chung bởi agent chính. | `test_location_narration.py`, `test_maps_statistics.py`, E2E map/location. |
| Bảng ngôn ngữ responsive và dấu duyệt | Bảng fixed layout, wrap, container query chuyển thẻ ở 620px; suite viewport 1366/1440/1920/768/390 và chữ lớn đã có. | P2 | **Đã có sẵn, giữ nguyên**. | `narration-review.spec.ts`, axe trong `admin.spec.ts`; kết quả artifact của lần chạy tổng hợp nằm ở báo cáo chính. |
| Tương phản notice trạng thái mới | Axe E2E lần đầu chỉ ra `.notice > span`: màu chữ `#637b4c` trên `#f2f6ec` đạt 4,290:1, dưới chuẩn 4,5:1 cho chữ nhỏ. | P2 | **Đã sửa** `notice.info` thành `#536747`; đo bằng công thức luminance WCAG đạt **5,640:1**. | Không tắt Axe hoặc hạ assertion; rebuild và chạy lại accessibility desktop/mobile trong suite tổng hợp. |

## File và API

- `apps/admin/src/Editor.tsx`: checkpoint, retry đúng bước, upload ID, partial success và ngữ cảnh lưu/công khai.
- `apps/admin/src/styles.css`: tăng tương phản notice thông tin từ 4,290:1 lên 5,640:1 trên nền thực tế.
- `services/backend/app/main.py`: `POST /api/v1/admin/pois/{id}/upload` thêm query `upload_id` tùy chọn gồm 32 ký tự hex thường. Client cũ tiếp tục dùng được. Một retry chỉ được xác nhận nếu đúng POI, ảnh hiện tại, nội dung ảnh và revision ngay sau lần upload đó; không che thay đổi của phiên khác.
- `services/backend/app/content.py`: hàm tạo snapshot công bố chung và projection public. Field nội bộ `published_language_codes` không trả ra API công khai.
- `services/backend/tests/test_media_storage.py`, `test_narration_review.py`; `tests/e2e/admin.spec.ts`.
- `services/backend/tests/test_workflow.py`: ngăn ghi chú người duyệt lọt qua list/detail public, bao gồm release legacy.
- Không thêm migration, service hoặc dependency. Hai cột JSON hiện hữu và ID media hiện hữu đủ cho thay đổi này.

Release legacy không có danh sách locale vẫn giữ quy tắc snapshot cũ khi locale đang bật; không thể suy ra locale nào đã tắt tại thời điểm phát hành lịch sử. Khi đọc public vẫn loại locale hiện đang tắt. Không tự sửa lịch sử/production; cần audit chỉ đọc và admin xem lại rồi công bố lại nếu phát hiện legacy chưa được duyệt.

## Lệnh và kết quả thực tế

Chạy từ root với Node portable đã có trên PATH:

```powershell
$env:Path = "$PWD\.tools\node-v22.22.0-win-x64;" + $env:Path
npx.cmd tsc --noEmit -p apps/admin
services/backend/.venv/Scripts/python.exe -m ruff check services/backend/app services/backend/tests
services/backend/.venv/Scripts/python.exe -m pytest -q services/backend/tests
services/backend/.venv/Scripts/python.exe -m pytest -q services/backend/tests/test_narration_review.py services/backend/tests/test_languages.py services/backend/tests/test_media_storage.py
services/backend/.venv/Scripts/python.exe scripts/test_postgres.py
```

- Admin TypeScript: **đạt**. Workspace admin không có script `typecheck` riêng; lệnh workspace báo thiếu script, đã chạy đúng `tsc -p apps/admin` theo root gate.
- Ruff toàn bộ app/tests: **đạt**.
- Backend full trước bổ sung marker locale: **259 passed, 6 skipped** trong 108,52 giây. Sáu ca bỏ qua cần `--postgres`, không coi là đạt trên SQLite.
- Regression sau sửa marker locale và upload idempotency: **33 passed**, 23,09 giây. Hai cảnh báo thư viện hiện hữu: TestClient/httpx và SQLite datetime adapter.
- Sau sửa projection ghi chú nội bộ: `python -m pytest -q services/backend/tests/test_workflow.py services/backend/tests/test_narration_review.py services/backend/tests/test_maps_statistics.py` đạt **31 passed**, 28,04 giây; Ruff các file thay đổi đạt. Regression mới đã được thấy thất bại trước khi thêm bộ lọc. Thay đổi chỉ projection đọc, không đổi transaction/schema; không chạy lại PostgreSQL chỉ vì phép loại trường này.
- Lần đầu regression upload có một test thiếu import `PIL.Image`; đã sửa import, chạy lại đạt. Không hạ assertion.
- PostgreSQL trong sandbox bị `pg_ctl: could not create restricted token: error code 87`; đã chẩn đoán rồi xin escalation cho helper cluster loopback dùng thử, automatic review cho phép. Lần chạy thật trên **PostgreSQL 18.6: 267 passed**, 82,59 giây, một cảnh báo TestClient. Bao gồm migration `base/0007/0008/0009 → 0010`, idempotency/revision, validation, queue concurrency và thống kê đồng thời. Helper đã dừng cluster sau kiểm tra; không dùng database local/cloud đang có.
- E2E mới đã viết cho cả desktop và Pixel 7 mô phỏng. Agent chính chạy trên artifact build mới; không chạy server E2E song song để tránh tranh cổng. Ảnh lưu `.runtime/screenshots/admin-image-{storage,upload-response,visibility}-{desktop,mobile}.png` khi các ca đó thực thi.

## Giới hạn và vận hành

- Upload thành công nhưng response mất được khôi phục bằng cùng ID khi vẫn ở editor. Reload đóng editor sẽ bỏ file đang chọn theo cơ chế bảo mật của trình duyệt; dữ liệu đã lưu vẫn có thể mở lại, ảnh đã commit vẫn gắn đúng POI.
- Xung đột sau một cập nhật mới hơn vẫn trả 409, giữ form hiện tại; cần mở bản mới để đối chiếu trước khi lưu tiếp. Không tự ghi đè revision.
- Nếu acknowledgement của bước lưu thông tin/công bố bị mất, trạng thái vẫn là chưa xác nhận; không có cơ chế tự hợp nhất thay đổi của hai phiên. Nếu Storage đã nhận object nhưng DB chưa có row, không tự xóa/ghi đè object; cần kiểm tra orphan theo runbook media.
- Supabase test ở đây dùng mock transport; chưa chứng minh storage/cloud thật. Không có kiểm tra model, giọng thật hoặc điện thoại vật lý trong nhánh công việc này.
- Windows chạy web/admin/worker/Expo: [README](../README.md), [MOBILE-EXPO](MOBILE-EXPO.md), [CLOUD-DEPLOYMENT](CLOUD-DEPLOYMENT.md). Phát hành/staging/rollback: [DEPLOYMENT-RUNBOOK](DEPLOYMENT-RUNBOOK.md), [ROLLBACK-RUNBOOK](ROLLBACK-RUNBOOK.md), media: [SUPABASE-MEDIA](SUPABASE-MEDIA.md).
