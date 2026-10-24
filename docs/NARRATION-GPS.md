# Thuyết minh, vị trí và bản dịch

Thay đổi này được chuẩn bị và kiểm thử tại máy; chưa triển khai hoặc cập nhật dữ liệu production. Migration mới: `0009_location_narration.py`. Không sửa migration đã áp dụng.
Đối chiếu READ ONLY: cloud PostgreSQL 17.11, Alembic 0008; local QA PostgreSQL 18.6. CI có matrix 17/18, major 17 còn chờ runner thực thi.

## Điều tra nguyên nhân

| Vấn đề | Bằng chứng | Kết luận và xử lý |
| --- | --- | --- |
| Danh mục có `?` | SELECT trên database cấu hình hiện có: 4/4 tên có dấu hỏi ASCII, không có U+FFFD; server/client UTF8. Lượt đối chiếu thứ hai xác nhận transaction_read_only=on. | Ký tự đã mất trong dữ liệu, không phải font. Chưa xác định được lệnh nhập lịch sử làm mất ký tự. |
| Nguồn tên gốc | SQLite cũ `.runtime/quan1.db` và `app/seed.py` giữ đúng bốn tên; ID SQLite và database từ xa khác nhau. | Chỉ dùng đối chiếu cho quản trị viên, chưa coi là backup cùng dòng dữ liệu. Không tự ghép ID hoặc sửa production. |
| Đường nhập hiện tại | Pydantic → SQLAlchemy Unicode → JSON; seed UTF-8; copy SQLite không chuyển ASCII; HTML có charset UTF-8. | Không tìm thấy chuyển đổi lossy trong mã hiện hành. Thêm NFC, từ chối `?`, U+FFFD, ký tự điều khiển và cho sửa tên theo ID. Không khẳng định đã chứng minh nguồn nhập lịch sử. |
| TTS dừng sớm | Mã cũ bỏ qua lỗi interrupted/canceled còn hiệu lực, chuyển idle; pause dùng cancel rồi dựa boundary để phát lại. Callback cũ cùng lượt chưa kiểm tra đúng utterance hiện tại. | Hiện lỗi rõ; pause/resume cùng utterance; kiểm tra generation và đối tượng utterance. Chưa tái hiện engine cụ thể trên điện thoại thật. |
| Văn bản | API/snapshot giữ toàn bài đến 30.000 ký tự, chỉ mô tả ngắn trên thẻ dùng slice. | Player nhận narration.text đầy đủ; test ghép các đoạn khớp nguyên văn tới câu cuối. |
| Locale | Du khách dùng chung locale cho UI và bài. | Tách hai lựa chọn; đổi UI không đổi bài, tháo player hoặc mất dữ liệu form. |
| Lưu nháp | Trước đây gỡ release và public API lọc trạng thái bản đang biên tập. | Nháp giữ snapshot công khai trước đó; chỉ công bố chủ động đưa sửa đổi ra công khai. Ẩn vẫn gỡ công khai. |

Danh sách bốn ID chưa sửa cùng tên hiện tại và nguồn đề nghị đối chiếu: file local bị Git ignore `.runtime/category-repair-review.json`. Tên đề nghị chưa được coi là phục hồi đã xác minh vì ID nguồn khác nhau. Không có credential thật trong report/trace CI.

## Quản trị

Mở **Chỉnh sửa nâng cao**, bật **Cho phép thuyết minh theo vị trí**, nhập bán kính 20–1.000 m, kéo ghim/nhấp bản đồ hoặc nhập tọa độ. Vòng tròn đi theo form, địa chỉ không tự đổi. Bật tự phát cần đủ cặp tọa độ hợp lệ. Địa điểm cũ mặc định 100 m, tắt.

**Khôi phục vị trí** lấy lại tọa độ, bán kính và công tắc ở lần lưu gần nhất. **Hủy** bỏ thay đổi chưa lưu; chỉ **Lưu thay đổi** ghi dữ liệu. Chọn Nháp khi chuẩn bị thay đổi: snapshot công khai cũ tiếp tục phục vụ. Chọn Công bố chủ động sau khi kiểm tra; muốn gỡ khỏi công khai, chọn **Ẩn** và lưu. Địa điểm chưa từng công bố không xuất hiện công khai.

## Du khách và GPS

Trong **Bản đồ**, **Vị trí của tôi** lấy vị trí một lần; **Bật thuyết minh theo vị trí** lấy mẫu ban đầu và tạo một watcher. Chỉ xin quyền sau thao tác bấm. Marker xanh, vòng sai số và khoảng cách trên thẻ giúp đối chiếu. Chỉ bấm Vị trí của tôi mới đưa bản đồ về người dùng; mẫu tiếp theo không giành thao tác kéo bản đồ.

| Quy tắc | Giá trị |
| --- | --- |
| Dwell | ≥5 giây qua nhiều mẫu timestamp tăng, không dựa timer đơn lẻ |
| Mẫu cũ/khoảng mẫu tối đa | 15 giây |
| Sai số | ≤50 m và ≤1/2 bán kính POI |
| Vùng thoát | Bán kính + max(20 m, 20% bán kính) |
| Phát lại cùng POI | Chờ 10 phút sau onstart, đồng thời phải ra ngoài vùng thoát rồi quay lại |
| Vùng chồng nhau | POI hợp lệ gần nhất; ID làm thứ tự ổn định khi khoảng cách bằng nhau |

Chỉ xét POI đã công bố, bật auto và có bài hợp lệ trong ngôn ngữ đã chọn. GPS kém, hết hạn hoặc tab ẩn không kích hoạt mới. Tab hiện lại phải có mẫu mới. Không ngắt bài đang phát/tạm dừng, kể cả bài thủ công. Tắt chế độ dọn watcher và ứng viên, chỉ dừng bài nguồn GPS; cooldown trong phiên vẫn giữ qua tắt/bật. Đổi ngôn ngữ bài xóa ứng viên. Không gửi/lưu tọa độ hoặc lịch sử di chuyển vào server/localStorage.

Có thông báo riêng cho thiếu hỗ trợ, HTTPS, từ chối quyền, unavailable, timeout, stale và accuracy. Thử lại khi đang bật dọn watcher cũ trước khi tạo mới. Rời bản đồ dọn watcher. Map và nghe thủ công vẫn dùng được khi GPS lỗi. Không có offline, app đóng hoặc dịch vụ nền.

Autoplay bị chặn: hiện **Chạm Nghe thuyết minh để bắt đầu**; không coi là phát thành công. GPS mở thẻ không ghi lượt xem. Chỉ onstart đầu tiên của bài gửi listen; chuyển đoạn/resume không gửi lại. Backend giữ dedup 30 phút, nhân sự không tăng thống kê; API công khai không có bộ đếm.

## Giao diện và TTS

UI VI/EN lưu riêng trên thiết bị và cập nhật document.lang. Ngôn ngữ bài luôn từ backend `/languages`, có lang/dir cho nội dung và RTL. Không dịch tên riêng hoặc dữ liệu nhập. Admin có nút đổi UI ngay trong dialog, giữ form.

Giữ Web Speech hiện tại, không thêm dịch vụ trả phí hoặc tệp audio. Chia câu/đoạn ≤180 UTF-16 code units; câu dài có fallback, không cắt surrogate pair. Giữ tham chiếu utterance; chỉ onend của utterance hiện tại mới nối đoạn. Stop, đổi bài và lỗi vô hiệu callback cũ. Trạng thái ready/playing/paused/stopped/error. Tiến độ theo ký tự/đoạn, không phải giây thực. Pause/resume giữ engine; đổi giọng/tốc độ hoặc seek dừng lượt hiện tại trước khi phát tiếp.

Voiceschanged cập nhật giọng đến trễ; chỉ cùng ngôn ngữ, ưu tiên locale chính xác. Không dùng khác script như zh-CN cho zh-TW hoặc sr-Cyrl cho sr-Latn. Có thể dùng khu vực khác trong cùng ngôn ngữ/script, tên giọng luôn hiển thị. Thiếu giọng báo theo UI, giữ văn bản và tắt nghe. Utterance không bắt đầu sau 5 giây hiện lỗi/chạm để nghe, không ghi listen. Lỗi còn hiệu lực không được coi là đọc xong.

Không cam kết mọi máy có đủ giọng. Chất lượng, pause và autoplay tùy OS/browser. Mock không chứng minh đã nghe hết bằng giọng thật trên Android/iOS; không cam kết định vị nền.

## Bổ sung bản dịch địa điểm đã có

Hướng dẫn mới, benchmark và giới hạn model: [AI-TRANSLATION-RELIABILITY.md](AI-TRANSLATION-RELIABILITY.md).

Admin mở bước **Nội dung đa ngôn ngữ** → bảng **Thuyết minh đa ngôn ngữ**. Lưu nguồn VI đã xác minh, xác nhận nguồn rồi chủ động chọn locale; mặc định chưa chọn đích. Batch mặc định 1, muốn nhiều hơn phải cấu hình phạm vi đã kiểm chứng trên backend. Có thử lại riêng locale thất bại và xác nhận khi tạo lại bản có sẵn. Không tạo POI hoặc thay ID.

Mỗi locale là một AiJob trong queue hiện có, HTTP 202. Payload `supplement` dùng bài VI đã lưu và source locale/revision/hash, không gọi Internet đoán dữ kiện. Prompt chỉ yêu cầu dịch đủ ý, không sáng tác thêm để đủ thời lượng. Timeout suy luận mặc định 120s, lease 900s; thời gian chờ queue được tính riêng.

Validator chung kiểm tra schema, Unicode, lặp, sao chép nguồn, ngôn ngữ bằng detector offline và tỷ lệ hệ chữ. Không còn ngưỡng 240 ký tự cố định. Kết quả `uncertain` hoặc bị từ chối không được review/lưu qua nhánh AI. Mọi kết quả qua kiểm tra vẫn **chờ duyệt**, không tự ghi POI/công bố. Thành công locale khác được giữ khi một locale lỗi; có thể nhập tay hoặc tạo lại.

**Xem & chỉnh bản AI** cho sửa/nghe thử. Xác nhận sự thật/ngôn ngữ rồi **Lưu bản dịch vào nháp**. Lưu source locale/revision/hash, model, thời gian tạo/duyệt và stale trong narration_meta, loại khỏi API công khai. Source/target hash và optimistic revision ngăn job cũ ghi đè: nguồn hoặc đích thay đổi trả 409. Sửa nguồn đánh dấu bản dịch cũ stale, không xóa. PostgreSQL khóa POI khi tạo/áp dụng, gộp job đang active cùng POI/locale.

PC worker cần **protocol 3**, script `scripts/ollama_worker.py`; worker protocol cũ không nhận job validation contract mới. Người phụ trách cập nhật dependency/restart PC; cloud không tự cập nhật. Worker chỉ HTTPS ra ngoài, không mở Ollama Internet. Offline giữ job chờ với giới hạn hết hạn 24 giờ; readiness công khai không phụ thuộc worker.

## Danh mục và sửa dữ liệu

Admin có nút sửa tên danh mục sau phát hành; PUT chỉ đổi name/color, giữ ID/liên kết. `/categories` công khai chỉ trả id/name/color của danh mục có snapshot công khai, không có count. Du khách thấy tên từ API này trên thẻ và chi tiết.

`scripts/repair_categories.py` mặc định dry-run; bỏ qua DATABASE_URL/local.env, chỉ nhận SQLite local hoặc PostgreSQL loopback qua CATEGORY_REPAIR_DATABASE_URL. Từ chối production/remote. Chỉ chạy trên bản restore/local đã backup. Repairs JSON UTF-8 gồm id, expected_name, name, evidence. evidence phải là nguồn đã được con người xác minh; công cụ không tự xác minh nguồn.

```powershell
# Chỉ kiểm tra SQLite cũ, không ghi:
services/backend/.venv/Scripts/python.exe scripts/repair_categories.py
# Chỉ trên bản restore/local riêng, sau xác minh nguồn:
services/backend/.venv/Scripts/python.exe scripts/repair_categories.py --repairs .runtime/verified-category-repairs.json
services/backend/.venv/Scripts/python.exe scripts/repair_categories.py --repairs .runtime/verified-category-repairs.json --apply
```

Cấu hình kết nối chỉ trong biến môi trường, không đưa credential vào lệnh/report. Tất cả sửa trong một transaction; expected_name sai, ID thiếu, trùng tên hoặc xung đột làm rollback toàn bộ. Không đoán từ `?`, seed đè, đổi ID, reset DB hoặc ghép danh mục. Với transaction pooler, không chỉ dựa startup options: SET TRANSACTION READ ONLY rồi SHOW transaction_read_only trước SELECT.

## Migration và rollback

Trước phát hành sau này: backup DB/media, migration một lần qua release owner theo [runbook](DEPLOYMENT-RUNBOOK.md), cập nhật backend, frontend/Worker và PC worker tương thích. Migration chỉ thêm cột, giữ bản dịch, thống kê, media, phiên, release cũ và queue. Snapshot cũ thiếu GPS dùng mặc định 100 m/tắt.

Rollback frontend có thể giữ schema. Backend 0008 kiểm tra readiness revision cứng, nên **không coi binary cũ chạy ngay trên 0009**. Test kiểm tra projection cũ và dữ liệu trên schema mới; rollback binary đầy đủ cần bản tương thích readiness và diễn tập trên restore riêng. Không downgrade schema/restore đè production. Muốn tắt auto cho POI sau phát hành, người phụ trách tắt cấu hình và công bố chủ động; nhiệm vụ này không làm thao tác đó.

Bằng chứng: [NARRATION-VERIFICATION.md](NARRATION-VERIFICATION.md).
