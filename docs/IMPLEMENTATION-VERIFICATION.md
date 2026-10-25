# Kiểm tra thay đổi admin và Expo Go · 25/10/2026

Báo cáo dưới đây ghi nhận lần triển khai SDK 57 ban đầu. Bản nâng SDK 58 sau đó có
[báo cáo riêng](MOBILE-SDK58.md); hướng dẫn chạy hiện tại ở [MOBILE-EXPO.md](MOBILE-EXPO.md).

Thực hiện trên Windows, từ HEAD `68c9e54`. Working tree ban đầu sạch, không tìm thấy AGENTS.md.
Chỉ chỉnh mã nguồn/local artifacts; không triển khai production, không tạo dịch vụ/gói trả phí.

## Thay đổi

| Phần | File chính |
| --- | --- |
| Bảng/tab và trạng thái duyệt admin | `apps/admin/src/Editor.tsx`, `NarrationTranslations.tsx`, `narration-review.ts`, `styles.css` |
| Bằng chứng duyệt backend và job AI | `services/backend/app/narration_review.py`, `narration_jobs.py`, `content.py`, `main.py`, `packages/contracts/src/index.ts` |
| Mobile native | `apps/mobile/App.tsx`, `index.ts`, `app.json`, `package.json`, `tsconfig.json`, `.env.example`, `src/Account.tsx`, `api.ts`, `config.ts`, `narrator.ts`, `useGps.ts` |
| Logic GPS dùng chung | `packages/contracts/src/geofencing.ts`; `apps/web/src/geofencing.ts` re-export để giữ imports cũ |
| Xác thực/analytics native | `services/backend/app/native_auth.py`, `auth.py`, middleware trong `main.py` |
| QR hero | `apps/web/src/MobileAppCard.tsx`, `expo-link.ts`, `main.tsx`, `styles.css`, `vite.config.ts`, `package.json` |
| Workspace/CI | `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example`, `.github/workflows/checks.yml` |
| Kiểm thử | `tests/mobile-logic.test.mjs`, `tests/expo-link.test.mjs`, `tests/qr/hero.spec.ts`, `playwright.qr.config.mjs`, `tests/e2e/narration-review.spec.ts`, `services/backend/tests/test_native_auth.py`, `test_narration_review.py`, `test_ai_jobs.py`, `test_wikipedia.py` |
| Tài liệu | `README.md`, `docs/ADMIN-NARRATION-REVIEW.md`, `EXPO-QR.md`, `MOBILE-EXPO.md`, `IMPLEMENTATION-VERIFICATION.md` |

Chi tiết admin: [ADMIN-NARRATION-REVIEW.md](ADMIN-NARRATION-REVIEW.md).
Cách chạy/cấu hình: [MOBILE-EXPO.md](MOBILE-EXPO.md), [EXPO-QR.md](EXPO-QR.md).
Không có migration mới: dùng JSON `narration_meta` và bảng session hiện có.

## Kiểm tra đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| `npm.cmd run typecheck` | Đạt admin/web/edge/mobile |
| `npm.cmd run build:site` cuối | Đạt cả web/admin, QR mặc định tắt |
| `npm.cmd run test:mobile` | 11/11 đạt; chia đoạn, giọng, hủy/race, GPS, token và đăng xuất |
| `npm.cmd run test:qr` | 2/2 đạt, URL hợp lệ/sai và bật/tắt |
| `npm.cmd run test:narration` | 15/15 đạt; giữ hành vi khoảng cách/dwell/cooldown/chunk web |
| `npm.cmd run test:categories` | 1/1 đạt |
| `npm.cmd run test:edge` | 4/4 đạt |
| `npm.cmd run check:worker` + Worker tests | Dry-run và 3/3 đạt; không deploy |
| `expo install --check` trực tuyến | Đạt, dependencies khớp SDK 57 |
| Expo export Android + iOS sau khi đồng bộ React | Đạt cả hai, 649/651 modules, Hermes bundles tại `.runtime/mobile-final-export` |
| Backend toàn bộ suite sau sửa cuối | 234 đạt, 6 bỏ qua, 2 cảnh báo deprecation thư viện |
| Ruff toàn bộ app/tests/migrations/scripts | Đạt |
| Isolated `npm ci` với đúng manifest COPY của Docker | Đạt, 586 packages; Expo 57.0.31, RN 0.86.3; root/mobile/RN resolve cùng React 19.2.3 |
| Playwright QR sau đồng bộ React | 8/8 đạt; 390/768/1366/1440/1920px, chữ 125%, VI/EN, copy/fallback, tắt QR |
| Playwright tập trung admin | 6/6 đạt trên desktop/Pixel 7 mô phỏng; bảng/tab, revision, bản nháp/public và hồi quy AI |
| Playwright toàn bộ artifact cuối | 70/70 đạt (desktop + Pixel 7 mô phỏng) |
| Đường dẫn cấu hình Vite | Xác nhận cả lệnh workspace `dev:web` và build từ gốc đều đọc `.env` ở gốc repo |

Artifact browser được build lại sau guard revision/ID cuối. Playwright trên Windows sandbox cần dừng
đúng các server QA đã tạo bằng tiến trình ngoài sandbox để hoàn tất teardown; cả lệnh E2E và QR đều kết thúc exit 0.

Kiểm tra chỉ đọc backend HTTPS hiện có: `/health/ready`, `/languages`, `/pois?locale=vi` đều HTTP 200,
15 ngôn ngữ và 3 release công khai tại thời điểm thử. Không gọi đăng ký, tạo tài khoản hay thay dữ liệu production.
Endpoint native mới trong working tree chưa triển khai lên backend đó.

## Security gate chưa đạt

`npm audit --audit-level=high` trả exit 1: 7 cảnh báo (5 high, 2 moderate) trong chuỗi công cụ Expo CLI/ngrok.
`node-forge` 1.4.0 có [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
chưa có bản vá phát hành theo advisory và npm registry tại thời điểm kiểm tra.
Expo CLI SDK 57 còn phụ thuộc Zod 3.25.76; [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
chỉ nêu bản sửa 4.6.6, ngoài dải major mà CLI khai báo. Ngrok kéo uuid cũ (moderate).
Không chạy `npm audit fix --force` vì npm đề xuất hạ Expo về SDK 44, không tương thích yêu cầu.
Không tự sửa mã mật mã/ép major dependency hoặc thêm ngoại lệ để làm xanh báo cáo.

Giữ nguyên bước `npm audit --audit-level=high` và gate tổng hợp trong CI; CI security sẽ tiếp tục chặn
cho đến khi dependency upstream có bản phù hợp hoặc chủ dự án hoàn tất xử lý riêng. Không tuyên bố CI toàn bộ đạt.

## Ảnh và giới hạn

- [Hero desktop](../.runtime/screenshots/hero-expo-desktop.png), [hero mobile](../.runtime/screenshots/hero-expo-mobile.png).
- Ảnh admin: [bảng desktop](../.runtime/screenshots/narration-review-desktop-1440.png),
  [hàng AI trên mobile](../.runtime/screenshots/narration-review-ai-desktop-390.png),
  [tab duyệt](../.runtime/screenshots/narration-review-tabs-desktop-1440.png).
- Ảnh hero dùng URL thật do Expo CLI cung cấp cho phiên LAN local; API chỉ mock trong test giao diện.
  Không dùng URL ví dụ làm QR sản phẩm và không coi ảnh là bằng chứng quét thành công.
- Đã đọc manifest LAN từ Expo CLI và xác nhận tên `Saigon Stories`, SDK `57.0.0`.
  Phiên Metro kiểm tra đã dừng; QR trên web vẫn mặc định ẩn. Cần chạy lại CLI và cấu hình URL mới khi demo.
- Chưa thử điện thoại Android/iOS thật, quét LAN/tunnel/4G, GPS thực tế, giọng TTS thực tế hoặc phiên qua app restart trên thiết bị.
- Không có Docker CLI trên máy nên chưa build/chạy image Linux; chỉ mô phỏng chính xác bước manifest `npm ci` và cập nhật CI Docker.
- Chưa chạy lại PostgreSQL matrix hoặc toàn bộ workflow GitHub Actions từ môi trường này.
- Dữ liệu cũ thiếu bằng chứng duyệt vẫn cần admin duyệt lại đúng nội dung; giữ nguyên release đang công khai.

Screenshot, Metro/bundle và test artifacts nằm trong `.runtime` đã gitignore. Chúng là kết quả local của phiên này.
