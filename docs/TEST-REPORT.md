# Báo cáo kiểm thử thực tế

Ngày: **22/10/2026**, múi giờ bàn giao Asia/Bangkok. Hệ điều hành Windows, Node 22.22.0 portable, Python 3.12.15 trong virtual environment, Edge Chromium đã cài trên máy. Đây là kiểm tra local, không phải load test hay chứng nhận khả năng tiếp cận.

## Kết quả

| Lệnh/kiểm tra | Kết quả thực tế |
| --- | --- |
| `npm run typecheck` | Thành công cho admin và web |
| `npm run build` | Thành công cho hai ứng dụng, Vite 7.3.7 |
| `python -m pytest -q` tại services/backend | **13 passed**, 6.80 giây; 1 cảnh báo deprecation của Starlette/httpx |
| `python -m ruff check app tests` | Thành công; đã kiểm tra thêm migrations và script E2E |
| `npm run test:e2e` | **10 passed**, 47.8 giây; desktop + Pixel 7 mô phỏng |
| Truy cập admin 5173, web 5174, API health 8000 | Cả ba HTTP **200** |
| Chạy `scripts/dev.mjs`, dừng bằng q | Thành công; xác nhận cổng 8000/5173/5174 đều đóng |
| Ảnh/scroll desktop và mobile | Kiểm tra trực quan; viewport 1440/393 px, document width bằng viewport |

Các lệnh Python thực tế trong phiên dùng `.venv/Scripts/python.exe` để không phụ thuộc alias hệ thống; lệnh `uv run ...` tương đương sau `uv sync --frozen`. Kiểm thử Playwright cần quyền tạo/dừng tiến trình trình duyệt và máy chủ; trong sandbox Windows đã chạy thành công ở môi trường được cấp quyền. Không có trình duyệt hiển thị hay máy chủ production được triển khai.

## Backend: 13 trường hợp

1. Guest không đọc admin, nội dung nháp hoặc URL media nháp; logout làm mất quyền đọc file riêng tư.
2. Editor nhập hai ngôn ngữ, upload WAV thật về định dạng, gửi duyệt; reviewer duyệt và xuất bản; guest nhận đúng từng nguồn audio, `Range` trả **206** và đúng 44 byte yêu cầu.
3. Thiếu ngôn ngữ/audio hoặc sửa văn bản sau upload bị chặn gửi duyệt.
4. Sửa nội dung đang xuất bản tạo draft, không thay đổi snapshot công khai hiện hành.
5. Revision cũ bị từ chối **409**, không ghi đè thay đổi mới.
6. Khóa sửa khi đang duyệt; editor không tự duyệt; từ chối bắt buộc có lý do và trả về draft.
7. Từ chối audio giả, MIME sai, SVG chứa script; chấp nhận PNG hợp lệ.
8. Logout thu hồi phiên; thao tác ghi thiếu header CSRF bị từ chối.
9. Lưu trữ ẩn nội dung công khai; khôi phục phiên bản thành draft mới, không tự xuất bản lại.
10. Tìm không dấu, kết quả rỗng, giới hạn page/page_size.
11. Chỉ admin xóa danh mục trống, không xóa danh mục đang được sử dụng.
12. Không được khôi phục release thuộc địa điểm khác.
13. Seed chạy lại không trùng 12 địa điểm và giữ thay đổi đã lưu của biên tập viên.

Mỗi test dùng SQLite và media tạm riêng, thực hiện migration Alembic thật. Không có test ghi vào `.runtime/quan1.db`.

## Trình duyệt: 5 trường hợp × 2 viewport

- Axe audit màn hình danh sách với các tag WCAG 2 A/AA và WCAG 2.1 AA: không có vi phạm được công cụ phát hiện.
- Axe audit đăng nhập và bước 1 trình biên tập: không có vi phạm được công cụ phát hiện. Đã sửa nhãn các nút bước khi chữ bị ẩn ở mobile và các nhãn tương phản thấp.
- Tìm không dấu, trạng thái rỗng, bỏ lọc, chuyển menu, không tràn ngang toàn trang, không có lỗi JavaScript trong ca này.
- Mở hướng dẫn, Escape đóng dialog; bật chữ lớn, đổi giao diện tiếng Anh, reload vẫn giữ lựa chọn.
- Luồng qua tài khoản editor → reviewer → guest: nhập hai ngôn ngữ, upload audio, gửi duyệt, duyệt, xuất bản; guest phát được audio (`currentTime > 0`), đổi ngôn ngữ nhận source khác và tải Range thành công.

Database/media của E2E tách riêng. WAV im lặng chỉ là **fixture codec** trong test, không phải bản ghi âm thuyết minh và không được seed vào nội dung mẫu local.

Ảnh kiểm tra tại `.runtime/screenshots/admin-local-desktop.png`, `admin-local-mobile.png`; ảnh luồng kiểm thử tại `admin-desktop.png`, `admin-mobile.png`, `editor-desktop.png`, `editor-mobile.png`. Báo cáo HTML tại `playwright-report/index.html`. Các artifact này được gitignore.

## Chưa xác minh/chưa triển khai

- Audit tự động không thay thế thử nghiệm với người dùng lớn tuổi, người dùng trình đọc màn hình hay kiểm thử mọi trạng thái/đường đi. Các bước 2–4 chưa được audit Axe riêng.
- Chưa thử Firefox, Safari, điện thoại thật, iOS/Android native, âm thanh thực tế, tai nghe, khóa màn hình hay cuộc gọi.
- Chưa có bản ghi âm thuyết minh mẫu được cấp quyền. Cần upload bản ghi âm thật và người duyệt nghe kiểm tra ngữ nghĩa; hệ thống chỉ xác thực định dạng và liên kết với văn bản.
- Chưa chạy nhánh PostgreSQL/PostGIS hoặc GitHub CI; chưa có load test, đo SLA, diễn tập backup/restore hay kho log tập trung.
- Tour, Expo, GPS, PWA/offline, QR scanner, đồng bộ nghe, worker, dịch/TTS tự động và S3 chưa triển khai. Dịch/TTS cần chọn nhà cung cấp và cấu hình credentials; luồng thủ công không bị chặn.
- Media đã từng phát hành giữ URL công khai để phục vụ các bản cũ. Lưu trữ địa điểm gỡ khỏi public API, không thu hồi tài sản đã công khai trước đó.

Xem README để chạy lại và CHECKLIST.md để tiếp tục công việc.
