# Đối chiếu giao diện du khách — 25/10/2026

Đã chụp và xem ảnh trước/sau trên Chromium chạy Windows, desktop **1440×1100**
và mobile viewport **390×844**, device scale 1. Ảnh là full-page nên chiều cao lớn hơn viewport.
Baseline lấy từ HEAD `95468e03cec87d56ccadc9ff7648998ffb7a6b51`; bản sau lấy working tree hiện tại.

| Kích thước | Trước | Sau |
| --- | --- | --- |
| Desktop 1440px | [Ảnh trước](../.runtime/screenshots/comparison-before-desktop.png) | [Ảnh sau](../.runtime/screenshots/comparison-after-desktop.png) |
| Mobile 390px | [Ảnh trước](../.runtime/screenshots/comparison-before-mobile.png) | [Ảnh sau](../.runtime/screenshots/comparison-after-mobile.png) |

Ảnh và dữ liệu đo là artifact local trong `.runtime` đã gitignore, không phải dữ liệu production.
Chi tiết máy đọc được: [visual-comparison.json](../.runtime/visual-comparison.json).
Script chụp lại: [visual-comparison.mjs](../.runtime/visual-comparison.mjs).

## Dữ liệu và phạm vi kiểm tra

- Cùng ba địa điểm có nhãn **QA**, địa chỉ ghi **Dữ liệu thử**, danh mục Lịch sử/Văn hóa và VI/EN.
  Nội dung mô phỏng, không phải thông tin du lịch đã xác minh; không có ảnh/media thật.
- Cùng QR giả `exp://192.0.2.10:8081` thuộc dải địa chỉ tài liệu; ảnh không chứng minh phiên Expo đang online.
- Static baseline và current phục vụ qua hai server loopback riêng `5295`/`5296`.
  Toàn bộ `/api/v1/*` được Playwright mock; request ngoài server loopback bị chặn.
  Không kết nối backend/database/cloud thật, không phát TTS/model hay xin quyền GPS.
- Source app không chứa mock. Current build riêng tại `.runtime/audit-current-web`,
  không thay artifact `apps/web/dist` dùng cho E2E của dự án. Browser và hai server đều được đóng sau khi chụp.
- Đã xem ảnh bằng `view_image`, gồm mobile ở độ phân giải gốc để kiểm tra header, QR và nút xuống dòng.

## Bố cục đo được

`placesTop` là tọa độ Y tính từ đầu tài liệu của vùng tiêu đề/tìm kiếm danh sách,
đo bằng `getBoundingClientRect().top + scrollY` sau khi font đã tải.

| Chỉ số | Desktop trước | Desktop sau | Mobile trước | Mobile sau |
| --- | ---: | ---: | ---: | ---: |
| Chiều rộng document | 1440 | 1440 | 390 | 390 |
| `placesTop` (px) | 711.08 | 778.86 | 1024.23 | **814.73** |
| Chiều cao hero (px) | 541.08 | 619.86 | 775.23 | **574.73** |
| Chiều cao thẻ QR (px) | 435.08 | 513.86 | 469.45 | **267.27** |
| Nút/text thẻ QR nằm trong chiều ngang thẻ | Có | Có | Có | Có |
| Lỗi JavaScript trang | 0 | 0 | 0 | 0 |

Mobile đưa vùng danh sách lên sớm **209.5px**. Hai nút Đăng nhập/Đăng ký nằm cùng hàng;
nhãn ngôn ngữ thuyết minh có hàng riêng. QR 112px bên trái, hướng dẫn và nút bên phải,
cảnh báo phiên dùng thử và link tiếp tục web nằm dưới, không giấu nội dung.
Hero vẫn có nút **Khám phá bản đồ / Xem địa điểm** trước thẻ QR.

Desktop giữ QR ở bên phải hero, header và ba cột địa điểm thẳng hàng. Vùng danh sách thấp hơn
baseline **67.78px** vì thẻ QR bổ sung link cài Expo Go, nút mở và link tiếp tục web.
Không ghi nhận cuộn ngang ở cả bốn ảnh. Kiểm tra này không đại diện cho mọi thiết bị thật hoặc trạng thái dữ liệu.

## Tương phản đã đo

Chạy Axe rule `color-contrast` trên trang đã tải font, đồng thời tính WCAG luminance từ màu CSS
và nền thực tế (các vùng đo không dùng gradient). Ngưỡng chữ thường 4.5:1, chữ lớn 3:1.

| Thành phần | Trước | Sau | Ngưỡng / kết quả sau |
| --- | ---: | ---: | --- |
| Eyebrow hero | 3.78 | **5.77** | 4.5; đạt |
| Đoạn giới thiệu hero | 3.32 | **5.77** | 4.5; đạt |
| Tiêu đề lớn chữ nghiêng | 3.28 | 3.28 | 3; đạt |
| Chú thích phiên Expo | 5.36 | 5.36 | 4.5; đạt |
| Tiêu đề thẻ Expo | 7.16 | 7.16 | 4.5; đạt |
| Ngôn ngữ trên nền trắng | 4.76 | **6.07** | 4.5; đạt |

Baseline mỗi viewport có một violation rule `color-contrast`, gồm **15 node**:
eyebrow, mô tả hero, text phụ trên các thẻ và footer. Bản sau có **0 violation**,
**0 incomplete** cho rule này ở cả desktop/mobile.
Đây là kiểm tra tương phản trên fixture đã nêu; không thay thế toàn bộ đánh giá accessibility,
bàn phím, trình đọc màn hình, motion hoặc kiểm tra thiết bị thật.

## Lệnh đã chạy

Build current riêng, với cùng cấu hình QR giả của baseline:

```powershell
$env:VITE_EXPO_QR_ENABLED = 'true'
$env:VITE_EXPO_GO_URL = 'exp://192.0.2.10:8081'
& .\.tools\node-v22.22.0-win-x64\node.exe node_modules/vite/bin/vite.js build apps/web --outDir 'D:/cnpm/quan1tourism/.runtime/audit-current-web' --emptyOutDir
& .\.tools\node-v22.22.0-win-x64\node.exe .runtime/visual-comparison.mjs
```

Build và script đều exit **0**. Bốn ảnh, JSON metrics và kiểm tra contrast đã được tạo;
không còn server snapshot chạy nền sau khi hoàn tất.
