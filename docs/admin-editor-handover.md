# Bàn giao luồng biên tập địa điểm Saigon Stories

Thực hiện trên HEAD `76bfdd3` ngày 25/10/2026. Workspace sạch trước khi sửa; không tìm thấy `AGENTS.md` trong dự án hoặc các thư mục cha đã kiểm tra. Không deploy, đổi database đang sử dụng, seed đè dữ liệu hoặc tạo tài nguyên trả phí.

**Hành trình sau thay đổi**

- Thêm mới tại `/admin/#places/new`; chỉnh sửa tại `/admin/#places/{id}`. Sau lần lưu đầu, URL chuyển sang ID thật bằng `replaceState`, giữ nguyên phiên biên tập và file ảnh đang chờ.
- Ba tab tự do: Thông tin địa điểm; Thuyết minh; Kiểm tra & công bố. Chuyển tab/ngôn ngữ không lưu và không xóa nội dung. Chỉ trang xem trước và xác nhận thao tác dùng hộp thoại.
- Thanh đầu hiển thị tên, trạng thái đã lưu, revision và tình trạng lưu. Thanh dưới có Hủy, Lưu nháp/Lưu thay đổi, Kiểm tra công bố; các nút xuống dòng trên màn hình hẹp.
- Thông tin chính gồm tên, danh mục song ngữ, địa chỉ, mô tả và ảnh. Chỉ tên, danh mục hợp lệ, địa chỉ cần cho bản nháp; ảnh, vị trí và thuyết minh bổ sung sau.
- Wikipedia tạo đề xuất riêng. Có xem trước thông tin, tọa độ, nguồn và từng bài AI; trường đang nhập chỉ bị thay sau khi xác nhận. Đổi phương thức nhập giữ nội dung.
- Vị trí mặc định thu gọn, có tóm tắt tọa độ, bán kính và tự thuyết minh. Giữ bản đồ, tìm kiếm, kéo ghim, nhập số, khôi phục cấu hình đã lưu; đóng phần vị trí vẫn giữ bản chỉnh sửa.
- Desktop có danh sách ngôn ngữ bên trái và một khung biên tập bên phải. Mobile xuống dòng danh sách ngôn ngữ. Nghe thử nằm cạnh nội dung; chỉ ngôn ngữ đang chọn có các thao tác AI chính. Chọn batch vẫn có trong phần mở rộng và tuân thủ policy hiện tại.
- Lưu luôn ghi nháp. Gửi duyệt → xác nhận đã kiểm tra → Duyệt nội dung → Công bố là các bước nghiệp vụ riêng ở tab cuối. Checklist dẫn tới trường/ngôn ngữ cần sửa; ảnh là khuyến nghị, không tự tăng điều kiện công bố.
- Xem trước dùng dữ liệu form hiện tại và không gọi thống kê. Liên kết “Mở bản đang công khai” tách biệt với xem trước nháp. Ẩn dùng hành động archive, giữ nội dung, thống kê và lịch sử. Lịch sử phát hành và khả năng khôi phục cũ vẫn có trong phần mở rộng.
- Quay lại danh sách giữ tìm kiếm, bộ lọc, sắp xếp, trang, số hàng, dạng danh sách/thẻ và vị trí cuộn trong phiên trình duyệt. Back/Forward dùng cùng cơ chế hash; thay đổi chưa lưu có cảnh báo. Đóng tab/tải lại vẫn có cảnh báo của trình duyệt.

**Nguyên nhân và cách xử lý**

| Vấn đề xác minh trong mã hoặc trình duyệt | Thay đổi |
| --- | --- |
| Editor cũ nằm trong dialog cao cố định, chia bốn bước, có nhiều vùng cuộn | Đưa vào trang admin, dùng cuộn tài liệu và ba tab; footer sticky nằm trong luồng bố cục |
| Không có URL editor; reload mất địa điểm đang mở | Hash theo ID, tải detail riêng, bảo vệ Back/Forward và chuyển URL sau checkpoint lưu đầu |
| Lưu có thể công bố qua select trạng thái | Bỏ select khỏi thông tin; mọi persist của editor gửi `status: draft`; công bố gọi actions riêng |
| Toàn bộ ngôn ngữ lặp nhiều nút, trạng thái AI chen vào form | Một ngôn ngữ đang chọn, phần batch và thông tin kỹ thuật thu gọn, so sánh đề xuất trong cùng tab |
| Apply AI yêu cầu xác minh bản dịch nhưng chưa tạo bằng chứng duyệt chính thức | Nhãn “Dùng bản này vào nháp”, nói rõ còn cần duyệt và giữ dấu ○; giữ nguyên ý nghĩa endpoint |
| Cần giữ bằng chứng duyệt khi đổi nguồn/nhập tay | Giữ trạng thái backend; bản nhập thay đổi hoặc nguồn thay đổi không dùng dấu ✓ của phiên bản trước. Không có bằng chứng thì không tự tạo ✓ |
| Trường bị gộp cả lỗi hoặc nội dung textarea vào tên truy cập | Thêm nhãn truy cập ổn định và mô tả lỗi cạnh trường |
| Detail tải xong trước danh mục/ngôn ngữ, lưu nhanh có thể báo lỗi giả | Chờ catalog cần thiết trước khi mở form; có tải lại khi request mở editor lỗi |
| Thanh tua nghe thử tràn 2 px trong khung hẹp | Bỏ lề ngang mặc định của range input trong editor, không dùng overflow để che |
| Các màu “chưa có”, cảnh báo và tiêu đề checklist không đạt tương phản | Điều chỉnh màu tại đúng thành phần; kiểm tra Axe trên cả ba tab |
| CSS responsive cũ ẩn trạng thái lưu trên màn hình hẹp | Hiển thị trạng thái ở cả header và footer, cho thông báo xuống dòng; bổ sung assertion ở mọi độ rộng thử nghiệm |

**Các phần đã có và được bảo toàn**

Bản công khai là Release snapshot riêng; draft không thay cấu hình GPS, ảnh hay bài du khách đang thấy. Revision conflict, kiểm tra trùng địa điểm, upload ID chống ảnh trùng, validator bản dịch, chống sao chép nguồn/sai ngôn ngữ, giới hạn batch, hàng đợi bền vững và worker protocol 3 đều được tái sử dụng. Không đổi model, tăng batch hoặc thay cơ chế duyệt. Phân quyền admin cho sửa/tạo AI/duyệt/công bố và thống kê được giữ; bộ đếm chỉ đọc. Không thêm `display_order` hoặc chức năng rollback mới.

Lưu ảnh tiếp tục theo persist → upload. Mỗi checkpoint cập nhật ID/revision; ảnh lỗi không xóa dữ liệu đã lưu, file vẫn ở trong phiên và retry dùng cùng upload ID. Xung đột 409 giữ bản nhập/file và cho mở bản đã lưu trong tab mới để đối chiếu. Không có cơ chế khôi phục toàn bộ form hoặc file sau reload; giao diện nói rõ điều này.

“Lưu nháp và tạo thuyết minh” chỉ enqueue sau persist thành công. Nếu enqueue lỗi, thông báo nêu rõ nháp đã lưu; retry dùng ID đã lưu. Backend hiện có tiếp tục gộp yêu cầu trùng cho tác vụ đang chạy. Đề xuất AI mới không thay bản đã lưu/công khai; bỏ đề xuất khôi phục trạng thái bằng chứng duyệt cũ khi còn phù hợp. Bản đề xuất đang chỉnh được giữ khi đóng so sánh/chuyển tab và được tính vào cảnh báo rời trang.

**File và API**

| File/nhóm file | Mục đích |
| --- | --- |
| `apps/admin/src/App.tsx`, `useAdminRoute.ts` | Trang editor, tải theo ID, điều hướng có cảnh báo, giữ ngữ cảnh danh sách, chờ catalog |
| `apps/admin/src/Editor.tsx` | Ba tab, form nháp, Wikipedia preview, checkpoint ảnh, checklist, hành động duyệt/công bố/ẩn, preview, lịch sử/thống kê |
| `apps/admin/src/NarrationTranslations.tsx` | Thao tác theo ngôn ngữ, lý do khóa AI, batch thu gọn, so sánh/sửa/nghe/áp dụng/bỏ đề xuất |
| `apps/admin/src/narration-review.ts` | Hiển thị bằng chứng duyệt đúng với bản nhập và các trường nguồn mà backend dùng tính hash |
| `apps/admin/src/WikipediaImport.tsx`, `i18n.ts` | Giữ resume job; đưa model/thời gian vào phần kỹ thuật; cập nhật hướng dẫn Việt/Anh |
| `apps/admin/src/styles.css`, `packages/api-client/src/PlaceMap.tsx` | Responsive, một vùng cuộn chính, focus/tương phản, tóm tắt vị trí |
| `tests/e2e/*`, `tests/narration-review.test.mjs`, `package.json`, `.github/workflows/checks.yml` | Chuyển test sang trang/ba tab, thêm hồi quy navigation/lưu/ảnh/AI/revision/accessibility; chạy test bằng chứng duyệt trong CI |

Không đổi contract, schema, migration hay endpoint backend. Các endpoint dùng lại:

- `POST /admin/pois`, `PUT /admin/pois/{id}`: persist với `status: draft`.
- `GET /admin/pois/{id}`, `GET /admin/pois/{id}/history`: tải đúng bản biên tập và lịch sử.
- `POST /admin/pois/{id}/upload`: giữ revision và upload ID khi retry.
- `POST /admin/pois/{id}/actions`: submit, approve kèm confirmed_review, publish, archive, restore.
- `GET/POST /admin/pois/{id}/narration-jobs`, `.../{job}/apply`, `.../{job}/discard`: giữ hash/revision, policy và validator hiện có. Apply chỉ ghi nháp và giữ trạng thái pending; xác nhận bản dịch không thay thế hành động approve phiên bản.
- Các API Wikipedia, trạng thái worker và tìm vị trí hiện có; không xây pipeline AI thứ hai.

**Kiểm thử thực tế**

- Ruff backend: đạt với `app`, `tests`, `migrations`, `scripts`.
- Backend: **262 passed, 6 skipped**. Không thay backend; bộ test kiểm tra tiếp tương thích, quyền, release, narration review, ảnh và revision.
- `npm run typecheck`: admin, web, edge, mobile đạt.
- `npm run test:narration`: **18/18**; `npm run test:categories`: **1/1**.
- Kiểm tra định dạng các file TS/TSX chính và `git diff --check`: đạt.
- Production artifact qua `scripts/build-site.mjs`: **exit 0**. Vite có cảnh báo kích thước chunk admin hơn 500 kB; không có lỗi build.
- E2E đầy đủ: **96/96 đạt**, không skip hoặc flaky, trên desktop và mobile (5,3 phút).
- Sau khi chốt đúng nhãn apply, **8/8 ca AI đạt** trên artifact mới: sửa/giữ đề xuất, cảnh báo rời trang, áp dụng vẫn giữ ○, validator, discard và revision.
- Kiểm tra bổ sung cuối: **2/2 ca responsive/trạng thái lưu/Axe đạt**; **2/2 ca mở metadata model dài qua mọi độ rộng đạt**. Không còn lỗi kiểm thử đang mở.

Số liệu từng lượt được lưu trong [verification.json](admin-editor/verification.json). Các lần chạy lại chỉ nhằm xác nhận phần vừa sửa; không dùng kết quả mô phỏng để khẳng định giọng đọc, GPS hoặc suy luận AI thật.

E2E chạy trên artifact đã build, backend SQLite/media trong thư mục tạm riêng do `scripts/e2e_backend.py` tạo, cùng các server local 8010/5183/5184. Phiên Windows này dùng config tạm `.runtime/playwright-editor.config.mjs` và quản lý ba tiến trình server riêng, tránh runner mắc ở bước thu dọn webServer. Không dùng database thường hoặc production.

| Ca nghiệm thu trong yêu cầu | Bằng chứng tự động |
| --- | --- |
| 1–2: lưu tối thiểu/reload; AI offline vẫn nhập tay | `editor-page`: manual draft, stable URL |
| 3: Wikipedia không mất bản nhập, xác nhận trước thay | `admin`: Wikipedia preview, hủy/xác nhận apply |
| 4: persist thành công, enqueue lỗi/retry cùng ID | `editor-page`: save then AI, coalescing active job |
| 5–8: tab/ngôn ngữ, cảnh báo rời trang, list context, URL/Back/Forward | `editor-page`: navigation và minimum draft |
| 9–12: dấu duyệt đúng phiên bản; AI giữ bản cũ; apply/discard đúng nhãn | `narration-review`, `narration-location`, `translation-reliability`, unit review |
| 13–14: nghe/preview không tăng thống kê, đúng nháp | `editor-page`: publication/preview; `maps-statistics` |
| 15–17: ảnh lỗi từng bước, mất phản hồi, retry, giữ form/file khi 409 | `admin`: storage/upload-response; `editor-page`: conflict và publication retry |
| 18–21: lưu không công bố, checklist focus, quyền/approval, ẩn giữ lịch sử | `editor-page`: manual draft, checklist, publication/hide; backend workflow/review tests |
| 22–25: 1366/1440/1920/768/390 px, viewport 125%, chữ lớn, model dài, footer, Vi/En/RTL | `editor-page`, `narration-review`, Axe cả ba tab và desktop/mobile projects |

**Ảnh bàn giao**

Ảnh dùng dữ liệu thử của backend tạm; không phải dữ liệu production:

- [Thêm mới desktop](admin-editor/add-desktop.png)
- [Thêm mới mobile](admin-editor/add-mobile.png)
- [Chỉnh sửa desktop](admin-editor/edit-desktop.png)
- [Chỉnh sửa mobile](admin-editor/edit-mobile.png)

Ảnh chi tiết các tab, AI, lỗi ảnh và các độ rộng được sinh thêm trong `.runtime/screenshots/`.

**Giới hạn xác minh**

Các bài trình duyệt mô phỏng speech/GPS, tile/search và đầu ra model để kiểm tra giao diện, hàng đợi, validator và bảo toàn dữ liệu. Chưa xác minh nghe bằng giọng thật, GPS trên thiết bị thật, suy luận Ollama thật, Wikipedia Internet thật, Supabase Storage thật hoặc các tích hợp cần môi trường ngoài. 6 test backend bỏ qua không được coi là đã đạt. Kiểm tra zoom dùng viewport CSS tương đương 125% cùng chữ lớn, không phải bấm zoom trình duyệt trên mọi thiết bị.

**Thao tác ngắn cho admin**

1. Chọn Thêm địa điểm, nhập tên/danh mục/địa chỉ, bấm Lưu nháp. Có thể dùng Wikipedia, xem đề xuất và xác nhận điền vào form trước khi lưu.
2. Mở Thuyết minh, viết và lưu bài nguồn tiếng Việt. Chọn ngôn ngữ, xác nhận nguồn, tạo AI hoặc nhập tay; nghe thử trong cùng khung.
3. Xem/chỉnh/nghe đề xuất AI. Chọn “Dùng bản này vào nháp” sau khi xác minh, hoặc Bỏ đề xuất. Lưu tay không tự duyệt.
4. Mở Kiểm tra & công bố, theo liên kết tới mục còn thiếu, xem trước nháp. Gửi duyệt, xác nhận kiểm tra phiên bản rồi Duyệt nội dung và Công bố.
5. Dùng Ẩn địa điểm ở tab cuối để ngừng hiển thị; lịch sử và dữ liệu vẫn giữ. Khi gặp 409, giữ tab đang nhập và mở bản đã lưu trong tab mới để đối chiếu.
