# Dữ liệu và quyền sử dụng

- Tên 12 địa điểm/đường phố là nhãn nhận diện phổ thông, dùng cho demo. Địa chỉ và tọa độ làm tròn mang tính minh họa, **chưa được thẩm định để định vị hoặc hướng dẫn thực địa**. Không có giờ mở cửa, giá vé hay thông tin lịch sử được khẳng định.
- Hai bài mẫu tiếng Việt/Anh là nội dung ngắn tự soạn trong `app/seed.py`, công khai rõ là nội dung minh họa cần thay bằng nội dung đã xác minh. Không sao chép văn bản từ trang du lịch, Wikipedia hoặc repository bên ngoài.
- Ảnh bìa mặc định là SVG tự tạo bằng mã trong `apps/admin/src/components.tsx`; là minh họa kiến trúc, không phải ảnh chụp thực tế địa điểm. Không gọi dịch vụ ảnh ngoài.
- Phông Be Vietnam Pro được phân phối local qua `@fontsource/be-vietnam-pro`, giấy phép SIL Open Font License trong package. Icon Lucide theo ISC, React/TypeScript/Vite và dependencies giữ giấy phép của package tương ứng.
- Thuyết minh được lưu dạng văn bản và đọc bằng Web Speech API trên thiết bị, không lưu tệp audio mới. Giọng do trình duyệt/hệ điều hành cung cấp, không clone giọng hay giả danh người thật. Các lựa chọn ngôn ngữ mới chưa tự có bản dịch nội dung.
- Upload ảnh kiểm tra định dạng/nội dung và liên kết phiên bản, không xác thực bản quyền. Người quản lý xác nhận quyền sử dụng ảnh và văn bản trước khi xuất bản. Tệp audio lịch sử từ bản cũ được giữ nguyên, không còn trong luồng biên tập/phát mới.
