# Lỗi Quality checks ngày 25/10/2026

Run gốc: [40159350229](https://github.com/Domyan-nn/quan1tourism/actions/runs/40159350229),
commit `8a53b331766c1409a7ee7045d11827dd1216f559`.

## Built artifact E2E

CI đạt 69/70 ca. Ca bổ sung thuyết minh AI trên desktop thất bại ở selector
`getByRole("button", { name: "Hủy", exact: true })`: cả panel duyệt bản AI và footer
editor đều có nút này. Backend có thể lưu xong trước khi trình duyệt xử lý response
apply và đóng panel duyệt. Vì vậy lỗi phụ thuộc thời điểm, không chỉ hệ điều hành.

Bài test chờ `.ai-review` ẩn sau apply và giới hạn nút đóng form trong `.editor-footer`.
Playwright cũng xuất GitHub annotations khi chạy CI để lần lỗi sau có chi tiết ngay
trong check, cùng HTML report/trace đã có.

Ca đã sửa được chạy ba lần trên mỗi project desktop/mobile: **6/6 đạt**.

## Security

Audit ban đầu có 7 mục (5 high, 2 moderate). Đã khóa Zod **4.6.7** và UUID của
`@expo/ngrok` ở **11.1.1** bằng root overrides và lockfile. Lockfile chuẩn hóa vị trí
dependencies để npm áp dụng override cả khi Expo nằm trong workspace.

`test:tooling` kiểm tra schema plugin, schema lệnh MCP, output hợp lệ/không hợp lệ
của Expo CLI với Zod mới và đường gọi `ngrok.connect` tạo tên UUID v4. Ngrok binary
và API được mock; kiểm tra này không tạo tunnel thật. CI chạy bài test này trong
Frontend and edge. Khi nâng SDK, cần kiểm tra lại các API nội bộ mà bài test sử dụng.

Audit còn **4 mục high**, cùng bắt nguồn từ `node-forge@1.4.0`:
`node-forge`, `@expo/code-signing-certificates`, `@expo/cli`, `expo`.
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
hiện chưa công bố bản vá; npm registry vẫn có bản mới nhất 1.4.0 khi kiểm tra.
Zod được vá theo [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

Ở commit `6e3fae9`, giữ `npm audit --audit-level=high` và Quality gate. **Security vẫn chặn release**
cho đến khi có dependency đã vá hoặc quyết định chấp nhận rủi ro được phê duyệt.
Không dùng `npm audit fix --force`: đề xuất hiện tại hạ Expo về SDK 44.

## Bản vá cục bộ tiếp theo

Run [40171020073](https://github.com/Domyan-nn/quan1tourism/actions/runs/40171020073)
xác nhận Built artifact E2E đã thành công; chỉ Security thất bại và kéo theo Quality gate.

Đã backport kiểm tra số phần tử DigestAlgorithm từ
[upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152), chưa merge/phát hành.
`npm ci` tự áp dụng bản vá có khóa version và SHA256. Test tái hiện chữ ký có phần tử
thừa bị bản gốc chấp nhận, kiểm tra bản vá từ chối, và kiểm tra chữ ký/chứng chỉ Expo hợp lệ.

CI dùng `npm run audit:security`: vẫn gọi npm audit thật, nhưng chỉ chấp nhận advisory
trên nếu xác minh được bản vá ở đúng installation mà Expo đang dùng. Advisory mới,
bản node-forge khác chưa vá, code bị sửa hoặc lỗi registry vẫn làm Security thất bại.
`npm audit` nguyên bản tiếp tục báo 4 high vì không kiểm tra thay đổi source cục bộ.
Chi tiết cách kiểm tra và gỡ backport: [security/README.md](../security/README.md).

Quality gate vẫn yêu cầu tất cả job thành công; thông báo lỗi giờ nêu rõ job nào
failed/cancelled/skipped thay vì chỉ báo một AssertionError chung.

## Kiểm tra lại

Kiểm chứng local trên Windows, Node 22.22.0:

- `npm ci`, `npm ls zod uuid`: đạt; overrides được áp dụng, không có dependency invalid.
- `test:tooling`: 2/2; typecheck admin/web/edge/mobile: đạt.
- `build:site`: đạt; trên artifact cuối, ca E2E đã sửa đạt 2/2 desktop/mobile.
  Lượt kiểm tra lặp trước đó đạt 6/6.
- `test:qr:ui`: 8/8; mobile logic: 11/11; QR URL: 2/2.
- `expo install --check` và export Android với lockfile cuối: đạt.
- Trước backport: npm audit có 4 high, 0 moderate và exit 1.
- Sau backport: cài sạch tự áp dụng đúng SHA256; `audit:security` đạt, gồm 6/6 test
  RSA/chứng chỉ Expo/chính sách audit. `test:tooling` đạt 2/2; pip-audit không tìm thấy
  lỗ hổng đã biết trong dependency Python được kiểm tra trên máy local.

```powershell
npm.cmd ci
npm.cmd run test:tooling
npm.cmd run typecheck
npm.cmd run test:e2e -- --grep "admin supplements an existing place" --repeat-each 3
npm.cmd audit --audit-level=high
npm.cmd run audit:security
```

Sau khi push, cần xem một CI run mới trên Ubuntu. Sửa local không thay đổi kết quả
của run cũ. Quality gate chỉ đạt khi mọi job bắt buộc thành công.
