# Bản đồ, vị trí và thống kê địa điểm

Chạy migration `0008` trước khi khởi động backend mới. Nếu dùng Supabase/cloud, dùng quy trình sao lưu và nâng cấp trong [CLOUD-DEPLOYMENT.md](CLOUD-DEPLOYMENT.md); lệnh dưới đây dành cho database phát triển đã sao lưu:

```powershell
cd services/backend
uv run alembic upgrade head
```

## Du khách

Chuyển **Danh sách / Bản đồ** ở danh sách địa điểm. Hai chế độ chỉ nhận địa điểm công bố và sắp xếp `view_count DESC, id ASC`; không có `display_order`. Địa điểm chưa có tọa độ vẫn có trong danh sách. Đổi ngôn ngữ không làm mất địa điểm nếu bản dịch đó chưa có; thẻ bản đồ cho chọn những ngôn ngữ thực sự có thuyết minh.

Chọn ghim mở thẻ ngay trên bản đồ, gồm ảnh, tên, địa chỉ, mô tả ngắn, ngôn ngữ và trình phát giọng đọc trình duyệt hiện có. Nút **Xem chi tiết** mở nội dung đầy đủ. Khi đổi địa điểm, ngôn ngữ hoặc đóng thẻ, bản đang đọc dừng lại. Cần giọng phù hợp trên thiết bị; không tạo tệp audio mới.

## Quản trị

Chỉ admin được thêm/sửa địa điểm, ảnh, tọa độ và trạng thái. Editor/reviewer vẫn đọc được nội dung quản trị và xem trước, không nhận thống kê truy cập.

Biểu mẫu có tên, danh mục, địa chỉ bắt buộc, mô tả ngắn và ảnh xem trước. Các tab thuyết minh giữ nguyên danh sách ngôn ngữ của dự án. **Trạng thái hiển thị** gồm Nháp / Công bố / Ẩn; công bố yêu cầu đủ các bản dịch bắt buộc và không có bản dịch nhập dở. Lịch sử và API duyệt nội dung cũ được giữ, chỉ admin thực hiện thay đổi trạng thái.

**Chỉnh sửa nâng cao** mặc định đóng. Mở phần này để tìm theo tên/địa chỉ, chọn kết quả, kéo ghim, nhấp bản đồ hoặc nhập tọa độ. Tọa độ dùng chung các trường `latitude`/`longitude`, không cập nhật địa chỉ văn bản. **Khôi phục vị trí** dùng tọa độ ở lần lưu gần nhất; **Hủy** bỏ các thay đổi chưa lưu. Chuyển bước và chọn ảnh không tự ghi dữ liệu; **Lưu thay đổi** mới gửi dữ liệu. Dự án chưa có GPS tự phát nên không thêm bán kính kích hoạt.

Admin thấy hai bộ đếm chỉ đọc trong danh sách và biểu mẫu; có nút xem trước ngay từ danh sách. Nháp/Ẩn không công khai; chuyển trạng thái giữ thống kê, bản dịch, ảnh và lịch sử. Chỉnh nội dung về nháp gỡ khỏi công khai cho tới lần công bố tiếp theo.

## Quy tắc đếm và API

| Hành động | Kết quả |
| --- | --- |
| `GET /api/v1/pois` / tải ghim | Không ghi lượt |
| Mở thẻ ghim → `POST /api/v1/pois/{id}/events/view` | Ghi lượt xem |
| `GET /api/v1/pois/{id}` / mở chi tiết từ danh sách | Ghi lượt xem |
| `SpeechSynthesisUtterance.onstart` → `POST /api/v1/pois/{id}/events/listen` | Ghi lượt bắt đầu nghe |
| Bấm phát nhưng giọng đọc không khởi động / nghe thử admin | Không ghi lượt nghe |
| Xem trước hoặc dùng tài khoản nhân sự | Không ghi lượt |

Cookie phiên trình duyệt `quan1_visit` là ngẫu nhiên, HttpOnly, SameSite Strict, Secure khi triển khai HTTPS. DB chỉ lưu SHA-256 của cookie. Khóa chính `poi_engagements(session_hash, poi_id, kind)` giữ dấu ghi nhận gần nhất; lượt xem và lượt nghe có cửa sổ độc lập 30 phút. Mở thẻ rồi vào chi tiết, phát nhiều ngôn ngữ và tạm dừng/tiếp tục đều được chống lặp. Xóa cookie tạo phiên mới.

Upsert có điều kiện thời gian và phép tăng `counter = counter + 1` nằm cùng transaction trên SQLite/PostgreSQL, không sửa revision nội dung. API công khai loại bỏ bộ đếm cả trong snapshot lịch sử. API ghi nhận trả 204, không trả số tổng. Input thêm/sửa từ chối `view_count`, `listen_count`, `display_order` và trường ngoài schema.

## Dịch vụ bản đồ và tìm kiếm

Bản đồ dùng [Leaflet 1.9.4](https://leafletjs.com/reference.html) và nền OpenStreetMap với ghi công trên bản đồ. Khi không tải được nền, giao diện báo trạng thái và vẫn cho nhập tọa độ/chọn ghim.

Tìm kiếm admin gọi `GET /api/v1/admin/map-search?q=...`. Backend mặc định dùng [Photon của Komoot](https://github.com/komoot/photon#demo-server), chỉ gửi khi người dùng nhấn tìm; tối đa một yêu cầu/giây mỗi process và cache 200 truy vấn trong 24 giờ. Dịch vụ demo giới hạn sử dụng và không cam kết khả dụng. Có thể đặt `GEOCODING_URL` trong `.runtime/local.env` hoặc môi trường máy chủ để dùng Photon riêng. Khi chạy nhiều process hoặc cần lưu lượng cao, dùng dịch vụ riêng; giới hạn/cache mặc định nằm trong bộ nhớ một process.

## Kiểm tra

Backend kiểm tra cửa sổ 30 phút, phiên/ngôn ngữ, truy cập đồng thời, thứ tự ổn định, phân quyền, tọa độ và snapshot không lộ số liệu. E2E desktop/mobile kiểm tra nhấp/kéo ghim, tìm kiếm, khôi phục/hủy, lưu rồi mở lại, xem trước, nghe trên bản đồ và đi tới chi tiết. Giọng đọc được mock để kiểm tra sự kiện thành công, không đánh giá chất lượng giọng thật. Tìm kiếm E2E dùng kết quả giả lập; độ phủ dữ liệu Photon phụ thuộc dịch vụ bên ngoài.
