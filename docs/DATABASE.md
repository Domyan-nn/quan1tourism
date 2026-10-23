# Cơ sở dữ liệu thuyết minh đa ngôn ngữ

Schema được tạo đầy đủ bằng Alembic (`0001` → `0002` → `0003`), không dùng dữ liệu giả trong localStorage. SQLite mặc định ở `.runtime/quan1.db`; có driver/migration cho PostgreSQL + PostGIS nhưng chưa kiểm thử với máy chủ PostgreSQL thật.

| Bảng | Nội dung và ràng buộc |
| --- | --- |
| `users` | Email duy nhất, tên, mật khẩu Argon2; vai trò visitor/editor/reviewer/admin |
| `sessions` | Hash token, khóa ngoại tài khoản, hạn phiên; cookie HttpOnly |
| `categories` | Tên danh mục duy nhất, màu hiển thị |
| `pois` | Tên/địa chỉ, danh mục, tọa độ hợp lệ, trạng thái, revision, ảnh, ghi chú |
| `languages` | Mã ngôn ngữ duy nhất (tối đa 35 ký tự), tên quốc tế/bản địa, mã giọng BCP 47, bật/tắt, bắt buộc, thứ tự, hướng chữ |
| `poi_translations` | Khóa chính `(poi_id, locale)`, khóa ngoại địa điểm/ngôn ngữ; tiêu đề tối đa 180 ký tự, văn bản tối đa 30.000 ký tự |
| `media_assets` | Ảnh được kiểm tra nội dung/MIME, checksum, quyền công khai; giữ các cột/tệp audio lịch sử để tương thích dữ liệu cũ |
| `content_releases` | Snapshot đã duyệt bất biến, revision duy nhất trong mỗi địa điểm, con trỏ phiên bản hiện hành |
| `audit_logs` | Người thực hiện, thao tác, thời gian, địa điểm hoặc thay đổi cấu hình ngôn ngữ |

## Khởi tạo hoặc nâng cấp

Trong `services/backend`, chạy:

```powershell
uv sync --frozen
uv run alembic upgrade head
# Tùy chọn: tài khoản và 12 địa điểm mẫu chỉ cho local
uv run python -m app.seed --demo
```

Migration tự thêm 15 lựa chọn ngôn ngữ, kể cả khi không chạy demo seed. Migration `0003` chuyển bản dịch JSON cũ sang các dòng văn bản, giữ tài khoản, phiên, ảnh và snapshot đã xuất bản. Với DB cũ, sao lưu và dừng backend trước khi nâng cấp. Không hỗ trợ downgrade phá hủy dữ liệu; dùng bản sao lưu đã xác minh khi cần quay lại.

## Thêm ngôn ngữ

Đăng nhập admin → **Ngôn ngữ & thuyết minh** → **Thêm ngôn ngữ**. Ví dụ mã `ms`, tên `Malay`, tên bản địa `Bahasa Melayu`, mã giọng `ms-MY`. Có thể dùng mã vùng/script như `zh-TW` hoặc `sr-Latn`. Thêm lựa chọn là thao tác DB, không cần thay code, thêm cột hay migration.

Tiếng Việt luôn bật và bắt buộc. Tiếng Anh bắt buộc mặc định; admin có thể đổi. Các ngôn ngữ mới mặc định tùy chọn. Khi một bản dịch tùy chọn đã có tiêu đề hoặc văn bản, cần hoàn thiện cả hai trước khi gửi duyệt. Bản dịch chưa nhập không chặn xuất bản. Đánh dấu bắt buộc chỉ áp dụng lần gửi duyệt/duyệt/xuất bản tiếp theo, không sửa snapshot đang công khai. Tắt ngôn ngữ ẩn lựa chọn du khách, giữ bản dịch để bật lại.

`GET /api/v1/languages` trả các lựa chọn đang bật. API quản trị trả cả lựa chọn đã tắt. `POST /api/v1/admin/languages` và `PUT /api/v1/admin/languages/{code}` chỉ dành cho admin. Mã không tồn tại, đổi mã của bản ghi đã tạo, cấu hình bắt buộc nhưng tắt hoặc mã giọng sai định dạng đều bị từ chối. Không có endpoint xóa ngôn ngữ để tránh mất liên kết bản dịch.

## Văn bản và giọng đọc

Văn bản là dữ liệu gốc. API nội dung trả `title`, `text`, `tts_ready`; chỉ công khai phiên bản đã xuất bản có đủ văn bản ở ngôn ngữ được chọn. Gửi một số ngôn ngữ khi cập nhật giữ nguyên các bản dịch khác; gửi cặp chuỗi rỗng để xóa nội dung một bản dịch trong nháp.

Trình duyệt dùng `SpeechSynthesis` đọc văn bản, chọn giọng theo `speech_locale`, điều chỉnh tốc độ và vị trí đọc. Không có tệp giọng đọc mới lưu vào DB, ổ đĩa hay object storage. `tts_ready` chỉ xác nhận đủ văn bản, không chứng nhận thiết bị có giọng phù hợp. Giọng có sẵn và khả năng cần mạng phụ thuộc thiết bị/trình duyệt. Không có bản dịch tự động; cần biên tập nội dung cho ngôn ngữ mới.
