# Audit mobile và Ollama worker — 25/10/2026

Phạm vi kiểm tra tại HEAD `95468e03cec87d56ccadc9ff7648998ffb7a6b51`, trước thay đổi của lượt hoàn thiện này. Không gọi production, tạo tài nguyên, chạy model thật hoặc thử trên điện thoại thật.

| Vấn đề | Bằng chứng | Mức độ | Kết quả / cách sửa | Kiểm chứng |
| --- | --- | --- | --- | --- |
| Callback kết thúc đoạn TTS native bị lặp có thể xếp thêm đoạn hoặc làm dừng trạng thái đoạn kế tiếp | Regression gọi `onDone` hai lần tạo 3 đoạn thay vì 2; callback lỗi cũ vẫn đổi state | P1 | Đã sửa: mỗi đoạn chỉ nhận một callback kết thúc; callback cũ bị bỏ qua | Regression thất bại trước sửa, đạt sau sửa |
| Thiết bị ném lỗi khi bắt đầu đoạn thứ hai làm thoát callback và giữ khóa phát | Regression `speak` đoạn thứ hai ném lỗi; `onDone` thoát exception | P1 | Đã sửa: bắt lỗi quanh mỗi lần gọi TTS, trả trạng thái lỗi và giải phóng khóa | Regression thất bại trước sửa, đạt sau sửa |
| Android Back đóng app khi đang đọc chi tiết; danh sách/map bị mất vị trí khi quay lại | `App.tsx` trước sửa không có `BackHandler`, map dùng initial region cố định, mở chi tiết chỉ cuộn lên đầu | P1 | Đã sửa handler quay về; giữ truy vấn/category/view, lưu vị trí cuộn và region map | Typecheck và export Android/iOS đạt; hành vi nút/scroll thật cần điện thoại |
| Tìm kiếm mobile không gộp khoảng trắng nội bộ và không có nút xóa | Chuỗi chuẩn hóa trước sửa chỉ bỏ dấu/đổi chữ thường | P1 | Đã sửa: trim/gộp whitespace, nút xóa, nút bỏ bộ lọc khi không có kết quả | Typecheck/export đạt; UI native thật chưa xác minh |
| GPS báo sẵn sàng chung, chưa phân biệt không ở gần/thiếu nội dung/dwell/đang phát | Hook trước sửa chỉ dùng `fixProblem` | P1 | Đã sửa: dùng `Geofence.diagnose` chung với web; đọc trạng thái không tác động quyết định kích hoạt | Test trạng thái/cooldown/dwell/accuracy đạt |
| GPS native yêu cầu di chuyển 2 m mới nhận mẫu mới, có thể cản xác nhận dwell khi đứng yên | `watchPositionAsync.distanceInterval` trước sửa là 2 trong khi dwell cần các mẫu timestamp mới | P1 | Đã đặt 0 để tiếp nhận mẫu vị trí mới cả khi đứng yên; không thêm timer tự kích hoạt bằng fix cũ | Export đạt; cadence cảm biến thực tế cần điện thoại |
| Worker retry cả HTTP lỗi vĩnh viễn và im lặng khi gửi completion thất bại hết lượt | Vòng retry trước sửa loại trừ chỉ 401/403/409/422 và không có thông báo khi hết 3 lần | P1 | Đã sửa: chỉ retry nhóm lỗi tạm thời có giới hạn; báo completion chưa xác nhận, không báo thành công | Test 400/404/409/422 gửi 1 lần; 429/503 gửi 3 lần; không lộ URL/secret/body |
| Worker chấp nhận origin `https://` thiếu host | Kiểm tra URL trước sửa không yêu cầu hostname | P1 | Đã sửa: từ chối origin thiếu host | Test URL đạt |
| Tập GPS độc lập search | `useGps` nhận `places` gốc; `filtered` chỉ dùng hiển thị | P1 | Đã có sẵn, giữ nguyên | Đọc source và test Geofence |
| TTS chia đoạn đầy đủ, đúng giọng và một lượt nghe ở `onStart` đoạn đầu | Dùng `nextChunk`, `voiceMatches`, cờ counted và generation của bài | P1 | Đã có sẵn, bổ sung chặn callback theo đoạn | Test Unicode lossless, sai hệ chữ, đổi bài, stop trước start đạt |
| Phiên native được giữ bằng SecureStore, logout lỗi có thể retry | API dùng opaque bearer, serialize session writes; 401 cũ không xóa phiên mới | P0 | Đã có sẵn, giữ nguyên | Test storage fail, stale 401, sai mật khẩu, logout offline đạt |
| Worker kiểm tra nội dung và server kiểm tra độc lập | `generate_translation`/`generate_draft` dùng validator chung; backend không dựa vào kết quả worker tự nhận | P0 | Đã có sẵn, giữ nguyên; không mở rộng model/batch | 28 test worker + translation pipeline đạt |
| Model dịch thật / Expo Go / cảm biến và âm thanh thật | Không có lượt thử thiết bị hoặc benchmark model thật trong phiên này | P1 | Chưa xác minh; không coi bundle export hoặc mock là nghiệm thu thiết bị/model | Chạy checklist thiết bị và pilot model riêng trước phát hành |

## File/API/migration

Thay đổi: `apps/mobile/App.tsx`, `apps/mobile/src/narrator.ts`, `apps/mobile/src/useGps.ts`, `packages/contracts/src/geofencing.ts`, `scripts/ollama_worker.py`; regression tại `tests/mobile-logic.test.mjs`, `services/backend/tests/test_ollama_worker.py`.

Không đổi API HTTP, schema database hoặc migration. Method mới `Geofence.diagnose(fix, targets, locale, now, busy)` được đọc sau `offer()`, phân biệt lỗi fix và trạng thái GPS bằng cùng dữ liệu của bộ kích hoạt. Không gửi vị trí lên server.

## Lệnh và kết quả thực tế

Từ repo, dùng Node portable đã có `.tools/node-v22.22.0-win-x64/node.exe` và Python `.venv` hiện có; không tải thêm dependency.

| Lệnh | Kết quả |
| --- | --- |
| `node --experimental-strip-types --test tests/mobile-logic.test.mjs` với 2 regression mới trước sửa | 11 đạt, 2 lỗi; tái hiện đúng lỗi callback và exception native |
| `node --experimental-strip-types --test tests/mobile-logic.test.mjs tests/narration-logic.test.mjs` sau sửa | 29/29 đạt (mobile 14, shared narration 15) |
| `node node_modules/typescript/bin/tsc --noEmit -p apps/mobile` | Đạt |
| `services/backend/.venv/Scripts/python.exe -m pytest -q services/backend/tests/test_ollama_worker.py services/backend/tests/test_translation_pipeline.py` | 28/28 đạt; 1 cảnh báo Starlette/httpx đã có |
| `services/backend/.venv/Scripts/python.exe -m ruff check scripts/ollama_worker.py services/backend/tests/test_ollama_worker.py` từ repo root | Không đạt do chọn config ngoài gate backend (import/noqa/broad-exception rules). Không hạ tiêu chuẩn hoặc sửa config để che lỗi |
| `services/backend/.venv/Scripts/python.exe -m ruff check --config services/backend/pyproject.toml scripts/ollama_worker.py services/backend/tests/test_ollama_worker.py` | Đạt theo config backend của repo |
| `expo export --platform android --output-dir ../../.runtime/mobile-audit-android-export` từ `apps/mobile`, `CI=1`, `EXPO_OFFLINE=1` | Đạt; 686 modules, Hermes bundle 1.8 MB |
| `expo export --platform ios --output-dir ../../.runtime/mobile-audit-ios-export` với cùng chế độ offline | Đạt; 688 modules, Hermes bundle 1.7 MB |
| `git diff --check -- apps/mobile scripts/ollama_worker.py services/backend/tests/test_ollama_worker.py tests/mobile-logic.test.mjs packages/contracts/src/geofencing.ts` | Đạt; Git chỉ nhắc chính sách LF/CRLF |

Bundle export chứng minh mã native đóng gói được. Chưa chứng minh bản Expo Go cài trên thiết bị tương thích SDK, microphone/âm lượng/giọng đọc hay GPS vật lý.

## Chạy và nghiệm thu trên Windows

Theo [MOBILE-EXPO.md](MOBILE-EXPO.md), tạo `apps/mobile/.env` từ mẫu và dùng origin **HTTPS môi trường thử nghiệm** có backend mới. Chạy `npm.cmd run mobile:lan` cùng Wi-Fi hoặc `npm.cmd run mobile:tunnel` cho mạng khác/4G. Lấy URL Expo thực tế từ CLI để cấu hình QR; không đoán URL, không báo online từ cấu hình.

Worker dùng Python backend: `services/backend/.venv/Scripts/python.exe scripts/ollama_worker.py`. Cấu hình origin/worker token trong `.runtime/local.env` riêng; giữ terminal và Ollama chạy. Chế độ xử lý vẫn một job/một lượt inference; retry completion không sinh lại nội dung. Chỉ completed do backend xác nhận mới in thông báo cần admin review.

Nghiệm thu thiết bị còn phải làm: Android Back/scroll/map region; quét LAN và tunnel/4G; đăng nhập, restart giữ phiên, logout; TTS hết bài/thiếu giọng/đổi bài; GPS đứng yên trong vùng, accuracy thấp, từ chối quyền, background/foreground. Không có ảnh chụp native thật trong báo cáo này. Hướng dẫn web/admin và phát hành nằm trong bàn giao tổng của lượt hoàn thiện; không thực hiện deploy.
