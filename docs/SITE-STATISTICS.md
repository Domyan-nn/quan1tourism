# Thống kê lượt truy cập

Trong admin, mở **Tổng quan → Thống kê lượt truy cập** để xem tổng lượt, hôm nay, 7 ngày, 30 ngày, biểu đồ 7 ngày và tổng lượt xem/nghe địa điểm. Nút **Làm mới** tải lại số liệu từ DB. Chỉ vai trò `admin` được xem. Giao diện hỗ trợ VI/EN và điện thoại.

Trang du khách gửi `POST /api/v1/events/visit` sau khi tải danh sách địa điểm thành công, kể cả danh sách rỗng. Một phiên ẩn danh chỉ tăng một lượt trong cửa sổ 30 phút tính từ lần được ghi nhận trước; tải lại trang, đổi ngôn ngữ và mở tab cùng phiên trong cửa sổ này không tăng thêm. Phiên của admin/editor/reviewer bị loại trừ. Đây là lượt truy cập theo phiên, không phải số người duy nhất; xóa cookie hoặc dùng trình duyệt khác tạo phiên mới. Không cộng dồn lượt xem địa điểm thành lượt truy cập website.

Cookie HttpOnly `quan1_visit` dùng chung với thống kê địa điểm; DB chỉ lưu SHA-256 của mã ngẫu nhiên, không lưu IP hay thông tin cá nhân. `site_visit_sessions` giữ thời điểm lượt gần nhất để chống đếm trùng; `site_visit_daily` giữ tổng lượt từng ngày theo giờ Việt Nam (UTC+7). Hai thao tác cập nhật nằm trong một transaction và dùng upsert để tránh mất lượt khi có nhiều request đồng thời. Đọc API danh sách/chi tiết bằng công cụ giám sát không tạo lượt website. Số liệu website bắt đầu từ khi tính năng được triển khai; không suy diễn lịch sử cũ từ lượt xem địa điểm.

API `GET /api/v1/admin/statistics` trả các tổng và chuỗi 30 ngày, bổ sung ngày không có truy cập bằng 0. Lỗi ghi thống kê không chặn du khách xem nội dung. Lỗi tải thống kê được hiển thị cùng nút làm mới.

## Cập nhật DB

Migration mới **0011**, tương thích SQLite/PostgreSQL; hai bảng mới bật RLS trên PostgreSQL. Trước khi khởi động backend mới, thực hiện quy trình backup/migration theo [deployment runbook](DEPLOYMENT-RUNBOOK.md). Với DB local, tại `services/backend` chạy `uv run alembic upgrade head`. Metadata schema của backend và gói frontend được cập nhật cùng revision.

Push Git không tự chạy migration DB production; áp dụng migration qua quy trình phát hành hiện có.
