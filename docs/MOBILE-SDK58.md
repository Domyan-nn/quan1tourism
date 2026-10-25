# Nâng Expo SDK 58 · 25/10/2026

Ứng dụng `apps/mobile` được nâng từ SDK 57 lên SDK 58 theo
[release notes](https://expo.dev/changelog/sdk-58) và ma trận `bundledNativeModules.json`
đi kèm **Expo 58.0.19 đã cài**. `expo install --check` xác nhận dependencies phù hợp.
Node portable 22.22.0 hiện có đáp ứng yêu cầu công cụ.

| Thành phần | Phiên bản trong lockfile |
| --- | --- |
| Expo | 58.0.19 |
| React Native | 0.88.0 |
| React / React DOM | 19.3.0 |
| React / React DOM types | 19.3.0 |
| expo-crypto | 58.0.7 |
| expo-location | 58.0.19 |
| expo-secure-store | 58.0.2 |
| expo-speech | 58.0.3 |
| react-native-maps | 1.29.11 |
| react-native-safe-area-context | 5.10.1 |

Web/admin và mobile dùng chung React 19.3.0, đã xác nhận cùng đường dẫn module để tránh lỗi hook.
React Native chuyển sang Strict TypeScript API; ref cuộn dùng `ScrollViewInstance` thay kiểu component.
Không bật lại bộ kiểu legacy và không dùng ép kiểu để bỏ qua lỗi.

## Chạy và quét

```powershell
cd D:\cnpm\quan1tourism
$env:Path = "$PWD\.tools\node-v22.22.0-win-x64;" + $env:Path
npm.cmd ci
npm.cmd run mobile:tunnel
```

Script tunnel dùng **`expo start --go --tunnel ngrok`**. SDK 58 có tunnel mặc định mới yêu cầu đăng nhập
Expo; lựa chọn ngrok giữ cách dùng hiện có, không yêu cầu tài khoản mới hay bật dịch vụ trả phí.
Lấy URL thật từ CLI hoặc `/_expo/open?platform=android`, không tự tạo địa chỉ.

Máy và tiến trình Expo phải chạy liên tục khi demo. Dùng Expo Go hỗ trợ **SDK 58**; phiên bản ứng dụng
trên cửa hàng có thể đang trong giai đoạn chuyển tiếp theo thông báo Expo. Trên Android, xem bản phù hợp
tại [expo.dev/go](https://expo.dev/go). Không tự tạo development build trả phí hoặc pipeline store.

QR trên website vẫn nằm bên phải phần giới thiệu trên desktop, xuống dưới ở màn hình hẹp.
Cập nhật URL bằng cấu hình build đã có; không hardcode URL tunnel vào mã nguồn.
Trong phiên kiểm chứng, CLI ngrok vẫn trả URL dạng project-root `exp://...`, nên validator hiện có tiếp tục phù hợp.
Chi tiết cấu hình/tắt QR và backend: [MOBILE-EXPO.md](MOBILE-EXPO.md), [EXPO-QR.md](EXPO-QR.md).

## Kiểm chứng

- `expo install --check`: đạt.
- Expo Doctor 1.21.5: **20/20** đạt.
- Typecheck admin/web/edge/mobile: đạt.
- Mobile logic: **11/11**; narration dùng chung: **15/15**; QR URL: **2/2** đạt.
- Export Android/iOS: đạt, Hermes bundles tại `.runtime/sdk58-mobile-export`.
- `npm ci` trong thư mục chỉ có đúng manifest Docker: đạt, 570 packages;
  Expo 58.0.19, RN 0.88.0 và một bản React 19.3.0.
- Tunnel HTTPS thực tế trả manifest **SDK 58.0.0**, tên Saigon Stories, HTTP 200;
  tải được bundle Android 4.176.917 bytes, HTTP 200. Bằng chứng ở `.runtime/sdk58-tunnel-verification.json`.
- Hồi quy browser chạy với QR bật. Selector thông báo GPS được giới hạn vào vùng GPS để không nhầm
  với vùng thông báo sao chép QR; không thay hành vi GPS/TTS.
- Lượt browser toàn bộ: **68/70** đạt; hai ca GPS chỉ lỗi selector trùng vùng thông báo QR.
  Sau khi sửa selector, chạy lại desktop/mobile: **2/2** đạt. Không có lỗi chức năng còn lại trong 70 ca.
- Suite riêng QR trên React 19.3: **8/8** đạt, gồm desktop, mobile, VI/EN và sao chép liên kết.

Tại thời điểm nâng SDK, `npm audit --audit-level=high` báo 7 mục (5 high, 2 moderate), như trước lần nâng:
chuỗi công cụ Expo CLI phụ thuộc node-forge/Zod, và ngrok phụ thuộc uuid cũ.
Giữ nguyên security gate trong CI, không thêm ngoại lệ hoặc chạy `audit fix --force` hạ Expo về SDK 44.
Không tuyên bố toàn bộ CI đã đạt chỉ từ Expo Doctor/typecheck.

Bản sửa CI sau đó đã nâng Zod/UUID và sửa selector nút đóng editor;
xem [lỗi CI và trạng thái Security còn lại](CI-FAILURES-2026-10-25.md).

Chưa có điện thoại thật để xác nhận GPS, TTS, phiên đăng nhập hoặc quét bằng thiết bị.
Bundle/manifest qua tunnel không thay thế nghiệm thu Android/iOS thật. Docker CLI chưa có trên máy;
kiểm tra manifest `npm ci` không phải bằng chứng image Linux đã chạy.

## File thay đổi

`apps/mobile/package.json`, `apps/mobile/App.tsx`, `package.json`, `package-lock.json`,
`tests/e2e/narration-location.spec.ts`, `docs/MOBILE-EXPO.md`, `docs/MOBILE-SDK58.md`, `README.md` và liên kết báo cáo nâng cấp
trong `docs/IMPLEMENTATION-VERIFICATION.md`.
