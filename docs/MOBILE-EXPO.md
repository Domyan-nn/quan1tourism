# Saigon Stories trên Expo Go

Ứng dụng native ở `apps/mobile` dùng cùng API và release công khai với web. Không dùng WebView.
Thay đổi này chưa triển khai production; các endpoint xác thực native mới cần có trên backend
được chọn trước khi thử đăng ký/đăng nhập.

## Phiên bản và nền tảng

Đã đối chiếu SDK 57 với [bản phát hành chính thức](https://expo.dev/changelog/sdk-57),
[ma trận module](https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json)
và `expo install --check` trực tuyến. Lockfile giữ Expo 57.0.31, React Native 0.86.3,
React/React DOM 19.2.3. Web và mobile dùng một bản React để tránh lỗi hook do workspace hoist.
Không chọn SDK chỉ theo nhãn npm `latest`.

Cài Expo Go **khớp SDK 57** theo [Expo Go](https://expo.dev/go).
Nếu bản trên cửa hàng chưa khớp, Android có thể dùng bản Expo cung cấp cho SDK này.
Xem [hướng dẫn lệch phiên bản](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/).
Khả năng cài trên iPhone thật phụ thuộc bản Expo Go được Apple cho phép phân phối; không giả định
Android/iOS trên cửa hàng hỗ trợ cùng SDK. Cả Android thật và iPhone thật chưa được thử trong phiên này.

[react-native-maps](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/) có trong Expo Go:
Google Maps trên Android, Apple Maps mặc định trên iOS; thử qua Expo Go không cần thêm API key.
Không bật billing hay tạo Google Cloud project. APK/App Store độc lập cần xem lại key, điều khoản,
chi phí bản đồ và quy trình phát hành riêng. Không có pipeline EAS/store trong nhiệm vụ này.

TTS dùng [expo-speech](https://docs.expo.dev/versions/v57.0.0/sdk/speech/) và giọng thiết bị.
Điều khiển là **nghe từ đầu / dừng** vì Android không hỗ trợ pause/resume giống iOS.
Bài dài chia đoạn bằng logic thuần dùng chung với web; đổi bài/ngôn ngữ hoặc vào background hủy hàng đợi.
Thiếu giọng đúng ngôn ngữ/hệ chữ sẽ báo rõ và giữ văn bản. Không dùng API TTS trả phí.

## Windows PowerShell

Cần Node.js 22.22 trở lên, npm và Expo Go phù hợp. Không cần Docker/WSL.
Nếu đã có Node portable của repo:

```powershell
cd D:\cnpm\quan1tourism
$env:Path = "$PWD\.tools\node-v22.22.0-win-x64;" + $env:Path
npm.cmd ci
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

`apps/mobile/.env` mặc định dùng origin HTTPS công khai đã có của dự án:

```dotenv
EXPO_PUBLIC_API_ORIGIN=https://quan1-tourism-api.onrender.com
```

Chỉ đặt origin, không có `/api/v1`, không localhost/127.0.0.1. Điện thoại phải truy cập được origin đó.
Để thử xác thực native, dùng backend HTTPS môi trường thử nghiệm có mã mới. Không tự triển khai production.
Expo đọc `.env` trong `apps/mobile`; tuyệt đối không đặt database credential, khóa worker hoặc secret admin
vào `EXPO_PUBLIC_*`. Đổi origin thì dừng Metro/chạy lại; thêm `--clear` nếu bundle cũ còn lưu trên thiết bị.

Cùng Wi-Fi:

```powershell
npm.cmd run mobile:lan
```

Mở Expo Go trên Android → **Scan QR code**, quét mã CLI. Cho phép Node qua Windows Firewall trên mạng riêng
khi Windows hỏi. LAN cần điện thoại truy cập được máy chạy Metro; không dùng qua 4G chỉ vì API vẫn chạy.

Khác Wi-Fi hoặc 4G:

```powershell
npm.cmd run mobile:tunnel
```

`@expo/ngrok` đã có trong devDependencies, không cần cài global. Tunnel cần Internet và dịch vụ ngoài,
có thể bị VPN/firewall/giới hạn dịch vụ ngắt. Không cần mua gói; nếu bị yêu cầu nâng gói, dùng LAN.
Không mở cổng Ollama/PostgreSQL. Giữ máy chạy Expo và tiến trình tunnel hoạt động suốt buổi demo.
Expo Go dùng để phát triển/thử; QR phiên dev không phải cam kết app luôn sẵn sàng.

## Cập nhật hoặc tắt QR trên web

Chép **nguyên liên kết mở Expo Go** CLI cung cấp (`exp://` hoặc `exps://`), không chép URL website/API.
SDK 57 có endpoint chỉ đọc để lấy chính liên kết đó:

```powershell
# Dùng đúng cổng CLI đang chạy; 8081 chỉ là cổng ví dụ.
(Invoke-RestMethod 'http://127.0.0.1:8081/_expo/open?platform=android').url
```

Đặt vào `.env` ở gốc repo hoặc môi trường build web:

```dotenv
VITE_EXPO_QR_ENABLED=true
VITE_EXPO_GO_URL=<liên kết thực tế vừa lấy từ CLI>
```

Khởi động lại `npm.cmd run dev:web` để xem local. Artifact web cần chạy lại `npm.cmd run build:site`
và triển khai qua quy trình được chủ dự án cho phép. URL tunnel đổi cũng cần restart/build lại.
Sau demo, đặt `VITE_EXPO_QR_ENABLED=false` và restart/build lại. Mặc định thẻ ẩn khi cấu hình thiếu/sai.
Không tự đoán hostname/port, không báo online suy đoán, không có API cấu hình tùy ý.
QR được tạo tại chỗ, không gửi URL cho dịch vụ tạo QR ngoài. Xem [EXPO-QR.md](EXPO-QR.md).

## Backend và phiên

Khách chưa đăng nhập vẫn đọc/nghe release công khai. Tìm kiếm/lọc danh mục trên dữ liệu API hiện có,
giữ thứ tự server `view_count DESC, id ASC`, không thêm `display_order` hoặc lộ số lượt riêng admin.
Ngôn ngữ giao diện VI/EN độc lập với ngôn ngữ thuyết minh.

Cookie HttpOnly của trình duyệt không được tái sử dụng trên native. API mới dưới `/api/v1`:

| Endpoint | Hành vi |
| --- | --- |
| `POST /native/auth/register` | `{name,email,password}` → user + opaque bearer token |
| `POST /native/auth/login` | `{email,password}` → user + opaque bearer token |
| `GET /native/auth/me` | Khôi phục user từ bearer token còn hạn |
| `POST /native/auth/logout` | Thu hồi token trên server |

Token visitor hết hạn sau 8 giờ; DB lưu hash có miền riêng trong bảng session hiện có. Không cần migration.
Không dùng token native như cookie web hay cấp quyền admin; giữ bảo vệ API/CSRF và rate limit dùng chung.
SecureStore giữ token, không AsyncStorage; không lưu mật khẩu. Logout lỗi mạng cho phép thử lại;
không báo đã thu hồi khi server chưa nhận được. Hết hạn phải đăng nhập lại, không có refresh token.

Analytics dùng endpoint events cũ. Định danh ngẫu nhiên `X-Quan1-Visit` trong SecureStore giữ chống đếm trùng
30 phút qua app restart/đổi phiên. Không chứa tọa độ, lộ trình hay tài khoản. Gửi lượt nghe ở `onStart`
đoạn đầu; không đếm theo từng đoạn TTS. Quyền xem thống kê vẫn thuộc admin.

GPS chỉ xin quyền sau khi bấm **Bật GPS & tự nghe**. Logic khoảng cách/dwell 5 giây/cooldown 10 phút
dùng chung tại `packages/contracts/src/geofencing.ts`, lấy bán kính/cờ bật từ API. Chọn điểm gần nhất
trong vùng chồng nhau, chờ khi audio bận, bỏ fix cũ/độ chính xác thấp. Tắt GPS hoặc vào background
tháo watcher; về foreground chỉ tiếp tục nếu chế độ còn bật. Không chạy nền/offline/lưu lộ trình;
không gửi tọa độ lên backend.

## Kiểm tra và xử lý lỗi

```powershell
npm.cmd run typecheck
npm.cmd run test:mobile
npm.cmd run test:narration
npm.cmd run test:qr
cd apps/mobile
npx.cmd expo install --check
npx.cmd expo export --platform android --output-dir ../../.runtime/mobile-android-export
npx.cmd expo export --platform ios --output-dir ../../.runtime/mobile-ios-export
```

CI giữ các gate cũ, thêm typecheck/test mobile và test QR; không chạy tunnel trong CI. Docker copy manifest
mobile trước `npm ci` để khớp lockfile. Export bundle xác nhận mã đóng gói được, chưa chứng minh cảm biến/âm thanh thật.

| Triệu chứng | Kiểm tra |
| --- | --- |
| Expo Go không tương thích | Cài đúng bản cho SDK 57 từ Expo; không nâng ngẫu nhiên dependency |
| Chưa tải được dự án | Metro/tunnel còn chạy, Wi-Fi/firewall/VPN; lấy lại URL CLI |
| App mở nhưng không tải bài | Kiểm tra HTTPS origin/mạng/backend; tunnel Expo không sửa lỗi API |
| Bài tải được, login 404 | Backend cũ chưa có `/native/auth/*`; dùng môi trường thử có mã mới |
| GPS bị từ chối | Bật quyền foreground trong cài đặt rồi bấm GPS thử lại |
| GPS chưa tự phát | Fix mới/đủ chính xác, trong bán kính qua nhiều mẫu ít nhất 5 giây, có bài/giọng, hết cooldown |
| TTS im lặng | Âm lượng, giọng ngôn ngữ đã cài; iOS tắt silent mode; thử bài ngắn |
| PowerShell chặn npm.ps1 | Dùng `npm.cmd`/`npx.cmd`, không cần đổi execution policy |

Nghiệm thu còn cần điện thoại thật: quét LAN và tunnel/4G, API thật, đăng ký/đăng nhập, tải lại giữ phiên,
logout/thu hồi, bản đồ/ghim, GPS/từ chối/background, TTS hết bài/đổi bài/thiếu giọng.
**Android thật và iOS thật đều chưa kiểm thử**; không có thiết bị kết nối trong môi trường này.
Kết quả tự động và ảnh: [IMPLEMENTATION-VERIFICATION.md](IMPLEMENTATION-VERIFICATION.md).
