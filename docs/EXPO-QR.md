# Mã QR mở Expo Go trên trang du khách

Khối QR nằm bên phải phần giới thiệu trên desktop, xuống dưới trên màn hình hẹp. Nó chỉ xuất hiện khi **cả hai** cấu hình build hợp lệ: `VITE_EXPO_QR_ENABLED=true` và `VITE_EXPO_GO_URL` chứa nguyên liên kết `exp://` hoặc `exps://` do Expo CLI in ra. URL website/backend, URL có tài khoản, query, fragment hoặc đường dẫn deep link bị từ chối. Không cấu hình thì giữ hero cũ. QR được tạo tại máy người dùng bằng `qrcode.react`, không gửi liên kết cho dịch vụ QR ngoài.

Từ PowerShell tại thư mục gốc, sau khi chạy mobile LAN hoặc tunnel, sao chép nguyên liên kết trong dòng `Metro waiting on ...` của Expo CLI:

```powershell
$env:VITE_EXPO_QR_ENABLED = 'true'
$env:VITE_EXPO_GO_URL = '<dán nguyên Expo Go URL do Expo CLI cung cấp>'
npm.cmd run build:site
```

Để xem local, dùng `npm.cmd run dev:web` thay lệnh build. Có thể đặt hai biến này trong `.env` tại thư mục gốc (đã gitignore). Đây là cấu hình **lúc build**: khi URL tunnel đổi, phải cập nhật URL rồi build lại; bản web đang được phục vụ chỉ đổi sau khi thay artifact. Với máy chủ Vite đang chạy, khởi động lại sau khi thay biến. Việc triển khai production không thuộc nhiệm vụ này.

Để kết thúc demo, đặt `VITE_EXPO_QR_ENABLED=false`, build lại và thay artifact tương ứng. Chỉ người có quyền build/cấu hình môi trường triển khai thay được URL; không tạo API cấu hình công khai.

## Website online

Chạy Expo trên PC và đổi `.env.local` chỉ cập nhật môi trường local. Website đã phát hành
giữ nguyên QR của artifact trước cho tới khi build và phát hành lại.

- **GitHub Actions:** vào repository → Settings → Secrets and variables → Actions → Variables,
  đặt hai repository variable `VITE_EXPO_QR_ENABLED=true` và `VITE_EXPO_GO_URL` bằng URL CLI thực tế.
  Job `Frontend and edge` đã truyền hai biến này vào build; không cần đưa URL vào mã nguồn hay Git.
  Sau đó dùng release workflow hiện có và giữ nguyên gate staging/production.
- **Cloudflare Workers Builds:** nếu website đang dùng builder này, đặt hai giá trị ở **build variables**
  của Worker rồi build lại qua quy trình được phép. Chỉ thêm runtime binding hoặc đổi GitHub Variables
  không cập nhật một bản build do Cloudflare thực hiện.
- Không bật cả hai đường tự deploy. Đối chiếu nguồn release đang dùng theo runbook trước khi phát hành.
  Trong nhiệm vụ cấu hình QR không tự bật auto-deploy, bỏ staging gate hoặc thay origin/backend.

Kiểm tra sau phát hành: `/release.json` đúng SHA dự kiến, trang chủ có thẻ Expo,
link Mở/Sao chép trùng URL CLI; vẫn thử quét trên điện thoại thật. Thẻ hiện không chứng minh tunnel đang online.

Trên điện thoại, bấm **Mở bằng Expo Go**; trên máy khác dùng Expo Go quét QR. Nút **Sao chép liên kết** có trường chọn/sao chép thủ công khi trình duyệt không hỗ trợ Clipboard. Thẻ không tuyên bố phiên đang online: máy chạy Expo và tunnel phải tiếp tục hoạt động. LAN chỉ dùng khi điện thoại truy cập được máy chạy Expo; khác Wi-Fi/4G cần URL tunnel thực tế. URL backend HTTPS là kết nối riêng của ứng dụng, không dùng làm QR.

Kiểm tra tự động:

```powershell
node --experimental-strip-types --test tests/expo-link.test.mjs
npx.cmd playwright test --config playwright.qr.config.mjs
```

Suite QR dùng dữ liệu API giả và địa chỉ dành riêng cho test; không coi đó là kiểm chứng Expo Go/thiết bị thật. Có thể truyền `QR_TEST_EXPO_URL` là URL CLI thực tế khi chạy kiểm tra, nhưng thao tác quét và mở ứng dụng vẫn cần thiết bị thật.
