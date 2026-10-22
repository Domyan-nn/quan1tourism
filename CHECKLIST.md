# Trạng thái bàn giao

Các trạng thái: **chưa làm**, **đang làm**, **đã làm chưa kiểm thử**, **đã kiểm thử**, **bị chặn**.

| Mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Giai đoạn 0: kiểm tra repo và runtime | đã kiểm thử | Repo ban đầu trống, ghi tại docs/ARCHITECTURE.md |
| Admin tiếng Việt/Anh, responsive, chữ lớn | đã kiểm thử | Desktop/Pixel 7 mô phỏng, lưu lựa chọn sau reload |
| Danh sách, tìm kiếm không dấu, bộ lọc, phân trang | đã kiểm thử | Backend + thao tác tìm kiếm/empty/filter trên trình duyệt |
| Tạo/sửa địa điểm, bản dịch, upload ảnh/audio | đã kiểm thử | 13 tests backend; UI song ngữ/audio có E2E |
| Gửi duyệt, duyệt, từ chối, xuất bản, lưu trữ | đã kiểm thử | Vai trò kiểm tra tại server |
| Snapshot bất biến, sửa nháp giữ bản công khai | đã kiểm thử | Backend regression tests |
| Lịch sử, khôi phục thành draft mới | đã kiểm thử | Không sửa snapshot phát hành |
| Trang du khách và hai nguồn audio | đã kiểm thử | Guest thực sự phát audio, đổi ngôn ngữ, nhận Range 206 |
| Alembic SQLite và seed 12 mẫu | đã kiểm thử | 13 tests gồm seed lặp, giữ thay đổi của biên tập viên |
| Khả năng tiếp cận admin | đã kiểm thử | Axe WCAG 2 A/AA + 2.1 AA: login, danh sách, bước 1 editor; không phải chứng nhận toàn bộ sản phẩm |
| Lệnh chạy local một terminal | đã kiểm thử | Ba URL trả 200; phím q dừng, xác nhận cả ba cổng đóng |
| PostgreSQL/PostGIS | đã làm chưa kiểm thử | Driver + nhánh migration; chưa có kết nối được cấu hình |
| Bản ghi âm thuyết minh mẫu có quyền | chưa làm | Không phát hành fixture âm thanh làm nội dung du lịch |
| Danh mục: tạo/xem/xóa trống | đã kiểm thử | Backend phân quyền admin khi xóa; chưa có đổi tên |
| Tour và sắp xếp điểm | chưa làm | Giai đoạn 2 |
| Expo/mobile và AudioController chung | chưa làm | Giai đoạn 2 |
| GPS engine/mô phỏng, geofence | chưa làm | Giai đoạn 3 |
| PWA/offline và đồng bộ | chưa làm | Giai đoạn 3 |
| Dịch/TTS tự động | bị chặn | Chưa cấu hình nhà cung cấp/credentials; nhập/upload thủ công dùng được |
| Worker Celery/Redis, S3 | chưa làm | Giai đoạn 4 |
| Quản trị tài khoản/đa vai trò | chưa làm | Hiện chỉ có phiên đăng nhập và 3 vai trò nội dung |
| Thống kê nghe và chống trùng events | chưa làm | Không hiển thị số lượt nghe giả |
| GPS nền/khóa màn hình/cuộc gọi trên thiết bị | chưa làm | Chưa có ứng dụng mobile và thiết bị kiểm thử |
| CI build/typecheck/tests | đã làm chưa kiểm thử | Có GitHub workflow Windows; lệnh tương ứng đã qua local, chưa chạy GitHub |
| Diễn tập backup/restore và load test | chưa làm | Có hướng dẫn, chưa đo khả năng phục vụ |
| Production deployment | chưa làm | Không tự triển khai khi chưa có yêu cầu |
