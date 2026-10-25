# Bảng thuyết minh và trạng thái duyệt

## Nguyên nhân

CSS chung của `table` đặt `white-space: nowrap`; bảng AI lại chuyển thành `display: block; overflow-x: auto`. Tên ngôn ngữ, trạng thái, model và các nút cùng đẩy chiều rộng nội dung vượt khung. Model/thời gian dùng `small` nội tuyến nên dễ dính vào trạng thái.

Ở cỡ chữ lớn, ô tiêu đề dành cho screen reader trong bảng danh sách nền cũng có thể vượt khung cuộn do định vị tuyệt đối. Đặt khung cuộn làm containing block giải quyết phần tràn này mà không che thêm nội dung.

Tab trước đây hiển thị dấu tích khi `translation.text` không rỗng. Điều kiện này không chứng minh admin đã duyệt; cũng bỏ sót kết quả AI hợp lệ còn trong job.

## Quy tắc hiện tại

- Backend trả `narration_review` theo ngôn ngữ ở API chi tiết/danh sách admin và API narration jobs. Bảng và tab dùng cùng dữ liệu; polling cập nhật cả hai.
- Polling chỉ nhận trạng thái khi `poi_revision` khớp phiên bản form đang mở. Nếu phiên khác cập nhật địa điểm, cảnh báo yêu cầu mở lại; bằng chứng duyệt của văn bản mới không được gắn vào văn bản cũ đang hiển thị.
- `✓` chỉ xuất hiện khi `narration_meta[code].approval` có SHA-256 đúng tiêu đề/văn bản hiện tại, revision hợp lệ, người duyệt và thời điểm duyệt; nội dung không bị đánh dấu nguồn cũ.
- Bằng chứng này được ghi trong luồng **Duyệt nội dung** hoặc luồng **Công bố → Lưu thay đổi** dành cho admin đã có. Không thêm nút duyệt riêng. Cả hai API tiếp tục kiểm tra quyền và revision.
- Chỉ ngôn ngữ đang bật được ghi bằng chứng duyệt mới; bản nháp của ngôn ngữ bị tắt không tự được duyệt khi admin công bố các ngôn ngữ khác.
- Lưu nháp, vượt validator, chọn checkbox tạo AI hoặc xác nhận xem bản dịch trước khi lưu nháp không tạo bằng chứng duyệt. Sửa văn bản trong form bỏ dấu tích ngay và chuyển bản đã công bố/đã duyệt về Nháp; cần chủ động chọn Công bố để phát hành nội dung mới.
- `○` biểu thị nội dung chưa duyệt, với tooltip phân biệt AI và thủ công. Không có nội dung thì để trống vị trí biểu tượng.
- Job AI được xét khi đã hoàn tất, vượt kiểm tra lại bằng validator hiện tại, đúng địa điểm/ngôn ngữ, revision nguồn hợp lệ và còn khớp hash nguồn/đích hiện tại; chưa áp dụng/chưa bỏ. Job đang chờ/đang chạy, lỗi, sai ngôn ngữ hoặc đã cũ không tạo biểu tượng nội dung mới.
- Không giới hạn xét trạng thái vào 500 job gần nhất: bản AI cũ vẫn hợp lệ và còn truy cập được tiếp tục có `○` và nút xem/bỏ dù có nhiều job mới lỗi.
- Nội dung nhập Wikipedia ban đầu giữ nguồn AI khi hash văn bản và revision nguồn khớp kết quả job đã được backend kiểm tra. Chế độ Ollama trực tiếp lưu kết quả hoàn tất vào bảng job hiện có làm bằng chứng; chỉ `source.model` do client gửi không đủ để gán nguồn AI. Văn bản bị sửa khác kết quả đã chứng minh được đánh dấu Thủ công.
- Bản AI mới hợp lệ ưu tiên `○` dù nội dung hiện tại đã duyệt. Tooltip giải thích bản trước được giữ. Thao tác **Bỏ bản AI mới** chỉ đánh dấu kết quả đã bỏ, có kiểm tra admin/revision, giữ lịch sử và khôi phục `✓` nếu nội dung hiện tại vẫn đúng bằng chứng duyệt.
- Áp dụng AI chỉ tạo bản nháp. Không sửa release đang công khai. API công khai loại bỏ metadata nội bộ và trạng thái duyệt.

Không cần migration: bằng chứng bổ sung nằm trong cột JSON `narration_meta` đã có. Nội dung cũ thiếu bằng chứng hash/người/revision được coi là cần duyệt; không suy luận từ text, `ai_reviewed`, `published` hay trạng thái validator, và không thay đổi/gỡ release cũ. Admin có thể kiểm tra rồi dùng luồng công bố hiện có để ghi bằng chứng cho đúng nội dung.

## Bố cục và khả năng sử dụng

Bảng dùng layout cố định theo tỷ lệ cột; văn bản, model và nút được xuống dòng. Trạng thái, nguồn, model và thời gian nằm ở các dòng riêng. Khi **khung chứa** hẹp hơn 620px, từng hàng trở thành thẻ có nhãn cột; chỉ khung editor cuộn dọc. Không dùng che tràn ngang để sửa bảng.

Tab giữ mã/tên/ngôn ngữ bắt buộc, có vị trí biểu tượng cố định và chú giải Việt/Anh. Nền/gạch dưới tiếp tục biểu thị tab đang chọn. Chuyển ngôn ngữ giao diện giữ nội dung đang nhập.

## Tệp thay đổi

- `apps/admin/src/Editor.tsx`, `NarrationTranslations.tsx`, `narration-review.ts`, `styles.css`.
- `packages/contracts/src/index.ts`: hợp đồng `NarrationReview` tùy chọn cho phản hồi admin.
- `services/backend/app/narration_review.py`, `narration_jobs.py`, `content.py`, và tích hợp luồng công bố trong `main.py`.
- `services/backend/tests/test_narration_review.py`, các khẳng định nguồn AI trong `test_wikipedia.py`/`test_ai_jobs.py`, `tests/e2e/narration-review.spec.ts`.

## Kiểm chứng

Backend: 8 bài kiểm tra trạng thái mới và hồi quy Wikipedia/import queue đã đạt **34/34**; 18 bài hồi quy workflow/thuyết minh đã đạt, 1 bài chỉ chạy trên PostgreSQL được bỏ qua ở SQLite. Các ca mới kiểm tra nháp thủ công, hash/revision, dữ liệu cũ, job hợp lệ/chưa hoàn tất/bị từ chối/sai hash, bỏ kết quả, giữ bản công khai, quyền admin, ngôn ngữ bị tắt, hơn 500 job mới lỗi, nguồn AI giả và áp dụng AI vẫn là nháp. Typecheck admin, Ruff toàn bộ backend/tests và build site đã đạt trong phiên làm việc; báo cáo tổng hợp của nhiệm vụ ghi kết quả gate cuối cùng sau khi tích hợp mobile.

Playwright kiểm tra thực tế DOM của artifact build ở 1366, 1440, 1920, 768 và 390 CSS px, tên model dài, nút truy cập được, marker/tooltip và giữ nội dung khi chuyển VI/EN. Cỡ chữ lớn kết hợp viewport hiệu dụng thu nhỏ 1,25 lần mô phỏng ảnh hưởng bố cục của zoom 125%; đây không phải thao tác zoom thật trong giao diện trình duyệt.

Suite tập trung `narration-review.spec.ts` và `translation-reliability.spec.ts` đạt **6/6** trên desktop và Pixel 7 mô phỏng. Kiểm tra thêm cảnh báo khi phiên admin khác sửa/công bố để trạng thái duyệt không bị gắn sai văn bản; lần cập nhật cuối bổ sung guard revision/ID ngay trong hàm cập nhật state cũng đã qua typecheck, và được bao gồm khi build/chạy suite tổng hợp tiếp theo.

Ảnh đối chiếu được lưu trong `.runtime/screenshots/narration-review-<project>-<width>.png`. Mock chỉ dùng cho giọng đọc trong browser test; trạng thái nội dung/job/quyền và bản công khai đi qua backend test thật, cơ sở dữ liệu tạm riêng biệt. Chưa nghe giọng thật, kiểm tra thiết bị vật lý hay sửa dữ liệu legacy/production trong nhiệm vụ này.

Ảnh tiêu biểu: [bảng desktop 1440px](../.runtime/screenshots/narration-review-desktop-1440.png), [hàng AI trên 390px](../.runtime/screenshots/narration-review-ai-desktop-390.png), [tab với ✓ / ○ / trống](../.runtime/screenshots/narration-review-tabs-desktop-1440.png).
