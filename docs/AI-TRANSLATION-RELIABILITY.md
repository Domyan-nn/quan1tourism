# Kiểm chứng luồng dịch AI — 24/10/2026

Báo cáo ghi lại trạng thái trước khi push: workspace dựa trên HEAD `1810c03fceae045cba9d70ed00c571393677c1a7`. Khi kiểm chứng chưa triển khai, khởi động lại worker production hoặc sửa dữ liệu production. Không tải/chuyển model, không thêm dịch vụ AI hay hệ thống hàng đợi.

**Đã chặn kết quả sai và sửa cách báo trạng thái. Model `qwen3:4b` trên máy này vẫn chưa đạt kiểm chứng dịch.** Không mở dịch hàng loạt bằng kết quả mock hoặc việc detector nhận diện đúng ngôn ngữ.

## Nguyên nhân và bằng chứng

| Tầng | Điều đã chứng minh | Điều chưa kết luận |
| --- | --- | --- |
| Nguồn/đích | Job có nguồn VI và đúng locale đích. 21/21 supplement đã completed có `text` trùng nguồn VI. | Không suy ra 21 bản dịch đã được lưu/công bố. |
| Ollama | Tái hiện payload cũ: raw `message.content` đã chép nguồn cho Pháp và Ả Rập. Gọi trực tiếp và qua hàm worker mới vẫn chép nguồn. `/api/show` xác nhận family qwen3, 4.0B, Q4_K_M, system tùy chỉnh rỗng. | Chưa xác định nguyên nhân sâu bên trong weights/template/runtime khiến model chép nguồn. Không có bằng chứng đủ để quy riêng cho prompt, schema hay nhiệt độ. |
| Parser/fallback | Parser đọc `message.content`; không tìm thấy nhánh lấy nguồn thay bản dịch lỗi trong hai hàm sinh nội dung đã kiểm tra. | Không quy lỗi này cho React hoặc cache chỉ từ stack trace trình duyệt. |
| Validator cũ | Độ dài và vài ký tự thuộc hệ chữ không phân biệt được VI với các đích Latin; Pháp chép VI vẫn qua. Ả Rập bị `wrong_script`. | Kiểm tra ngôn ngữ mới cũng không xác minh đúng nghĩa hoặc đủ sự kiện. |
| Worker/backend/UI | Worker cũ gom lỗi cụ thể thành `generation_failed`; backend nhận kết quả chưa kiểm tra đủ; UI nhầm việc job kết thúc với kết quả đủ điều kiện review. | Không tuyên bố nâng chất lượng sinh nội dung chỉ nhờ chặn đầu ra sai. |
| Queue | CPU xử lý tuần tự, từng có thời gian chờ khoảng 235s; mặc định chọn nhiều locale và nghỉ giữa job làm thời gian chờ tăng. | Chưa có số liệu đủ để đưa SLA/ETA cho tải production. |

Raw tái hiện cũ nằm trong `.runtime/ai-translation-diagnosis/`; không đưa nội dung nghiệp vụ này vào fixture hoặc Git. Bằng chứng tổng hợp đã bỏ nội dung/ID nghiệp vụ: [JSON kiểm chứng](verification/ai-translation-2026-10-24.json).

## Thay đổi thực hiện

- `services/backend/app/translation_validation.py`: validator dùng chung, detector offline độc lập với model sinh; kết quả `passed/rejected/uncertain`, issue codes, metrics và version `translation-v2.1`.
- `app/narration_generation.py`: prompt `faithful-translation-v2.1`; dịch tiêu đề và toàn bộ ý từ bài VI đã lưu, không thêm ý để đạt thời lượng. Schema bắt buộc đủ trường, kiểm tra kết thúc generation, không fallback về nguồn.
- `app/narration_jobs.py`: nguồn VI có xác nhận của admin; lưu source locale/revision/hash và target hash; lựa chọn locale rõ ràng, gộp job trùng, kiểm tra lại khi completion và khi áp dụng. Job cũ được đánh giá lại khi đọc, không sửa lịch sử.
- `app/ai_jobs.py`, `app/wikipedia.py`: chặn bypass completion cho cả supplement và Wikipedia. Bài tóm lược Wikipedia được đánh giá đúng loại tác vụ, không buộc dài như bài gốc; bản chép VI vào locale khác vẫn bị chặn. Mặc định nhập Wikipedia chỉ tạo bản VI để admin kiểm tra/lưu trước.
- `scripts/ollama_worker.py`: protocol 3, giữ mã lỗi đã biết, heartbeat gắn job/lease, retry completion có giới hạn, bỏ nghỉ 5s giữa các job đã có sẵn. Không tự retry vô hạn bản sao nguồn.
- `app/ai_policy.py`, `.env.example`, `app/config.py`: giới hạn batch/pending và danh sách locale được phép chạy batch; backend thực thi.
- `apps/admin/src/NarrationTranslations.tsx`, `WikipediaImport.tsx`, `packages/api-client`, `packages/contracts`: lỗi VI/EN theo mã, tiến độ chờ/xử lý, kết quả từng locale, số đạt/lỗi/chờ; chỉ kết quả vượt kiểm tra mới có thể review. Nhãn thành công là “Đã tạo — chờ kiểm tra”. Không chọn tự động toàn bộ locale thiếu.
- Ba script audit/benchmark/calibration và fixture tổng hợp, pytest/E2E tương ứng.

Kết quả đủ điều kiện review vẫn cần admin kiểm tra ngôn ngữ, ý nghĩa và sự kiện. Lưu bản AI vào nháp không thay snapshot công khai; sửa tay và luồng duyệt/công bố hiện hữu được giữ. Nghe thử AI không ghi lượt xem/nghe.

## API, trạng thái và dữ liệu

Không thêm migration hoặc trạng thái job mới. Alembic vẫn `0010`. Dùng các trường JSON `AiJob.payload/result` và `AiWorker.protocol` hiện có.

| API | Thay đổi |
| --- | --- |
| `POST /api/v1/admin/pois/{id}/narration-jobs` | Phải chọn locale và xác nhận nguồn đã lưu. Trả 422 `batch_limited/language_not_verified` hoặc 429 khi quá số pending; không âm thầm tạo mọi locale. |
| `GET .../narration-jobs` | Thêm `policy`, `worker_ready`; từng job có `validation`, `issue_codes`, `reviewable`, `timings`. Job legacy vẫn giữ trạng thái lịch sử nhưng kết quả sai không review được. |
| `GET /api/v1/admin/ai/jobs/{id}` | Tương tự cho bản nháp Wikipedia; kiểm tra lại kết quả legacy. |
| `POST /api/v1/worker/heartbeat` | `protocol:3`, có thể gửi `job_id/lease`; chỉ cập nhật heartbeat cho lease còn hiệu lực và đúng job đang chạy. |
| `POST /api/v1/worker/claim` | Protocol 1/2 không nhận job có validation contract mới. Protocol 3 vẫn nhận job legacy. PostgreSQL advisory lock và CAS chỉ cho một lease đang chạy toàn cục. |
| `POST /api/v1/worker/jobs/{id}/complete` | Supplement mới phải echo `locale/source_revision/source_hash`, dùng đúng lease. `done_reason:stop` bắt buộc cho kết quả thành công mới. Worker có thể gửi timing/prompt metadata; cờ `validation` của worker không được tin để chấp nhận kết quả. |
| `POST .../narration-jobs/{job}/apply` | Kiểm tra lại bản đã chỉnh, xác nhận review và đối chiếu revision/source/target trước khi ghi nháp. |

Backend lấy nguồn từ payload do server tạo; kiểm tra source/target hiện tại để ngăn kết quả cũ. Callback terminal lặp cùng lease trả trạng thái đã chốt và không ghi đè; lease cũ sau reclaim bị 409. Lỗi bị giới hạn trong whitelist: `source_copy`, `wrong_language`, `wrong_script`, `language_uncertain`, `empty_output`, `invalid_output`, `incomplete_generation`, `repetitive_output`, `damaged_unicode`, `model_timeout`, `worker_unavailable`, `generation_failed`, `source_changed`, `target_changed`, `batch_limited`, `language_not_verified`. Không lưu raw exception/URL nhạy cảm làm mã lỗi.

## Detector, ngưỡng và giới hạn

Dependency khóa trong `uv.lock`: `py3langid==0.4.0` (BSD-3-Clause) và NumPy. Detector dùng tài nguyên nén 4.586.720 byte đi kèm package, hỗ trợ 139 ngôn ngữ, tải một lần mỗi process và cache kết quả hữu hạn. Không gọi Ollama hoặc tải tài nguyên khi request. Xem [mã nguồn py3langid](https://github.com/adbar/py3langid). Cần cài cùng dependencies trên cả backend và PC worker; chưa đo giới hạn RSS dưới tải Render.

Mapping base language hỗ trợ VI/EN/FR/DE/ES/IT/PT/ID/MS/AR/ZH/JA/KO/RU/TH/HI. Locale vùng/script vẫn được giữ trong job; detector base `zh` không chứng nhận riêng zh-CN/zh-TW hoặc vùng của tiếng Bồ Đào Nha. ID và MS được phân biệt, không gộp kết quả.

| Kiểm tra | Ngưỡng mặc định |
| --- | --- |
| Chép gần nguyên bản sau NFC/casefold/khoảng trắng/dấu câu | Similarity ≥0,90; luôn giữ nguyên dấu trong phép so sánh |
| Chép đoạn dài | Block ≥50 ký tự; phủ ≥65% nguồn và ≥60% đầu ra |
| Nhận diện ngôn ngữ | Confidence ≥0,85 và margin top-2 ≥0,20; thấp hơn là uncertain |
| Văn bản quá ngắn | <24 chữ cái, hoặc <10 cho zh/ja/ko: uncertain |
| Trộn ngôn ngữ | Câu/đoạn ≥45 chữ cái; phần sai ngôn ngữ có độ tin cậy cao chiếm ≥20% thì reject |
| Hệ chữ AR/ZH/JA/KO/RU/TH/HI | Tỷ lệ chữ thuộc hệ đích ≥45%; không dùng chữ Latin để phân biệt VI/FR/DE… |
| Cắt ngắn bản dịch | Nguồn ≥200 ký tự chuẩn hóa và đầu ra <22% nguồn, hoặc <12% cho zh/ja, là tín hiệu thiếu; không áp dụng cho tóm lược Wikipedia |
| Bất thường cấu trúc | Trống/sai schema, Unicode hỏng, câu dài lặp ≥3 lần, vốn từ quá lặp, generation chưa `stop` bị chặn |

Tên riêng nhiều từ từ nguồn tin cậy được loại khỏi bước detector khi phù hợp; không loại khỏi kiểm tra sao chép hoặc nội dung lưu. Không dùng tiêu đề chứa tên Việt để thay việc kiểm tra bài chính. Dịch cùng ngôn ngữ/tạo thuyết minh có cách đánh giá riêng.

Calibration trên mẫu **tổng hợp dùng phát triển**, không phải tập nghiệm thu độc lập: 28/28 mẫu sai dạng sao chép bị chặn; 16/18 mẫu ngôn ngữ hợp lệ qua, 2/18 uncertain (ID/MS); false accept 0/28, false reject cứng 0/18. Nếu tính uncertain là không được tự chấp nhận thì có 2/18 (11,1%) mẫu hợp lệ phải kiểm tra thêm. Các mẫu ngôn ngữ này không phải bộ bản dịch chuẩn bảo đảm giữ đủ nghĩa của cùng một nguồn. Chưa có ước lượng tỷ lệ lỗi trên dữ liệu thực tế tương lai.

## Benchmark model thật

Máy: Ryzen 7 6800H, 8 nhân/16 luồng; RAM hệ thống thấy khoảng 13,69 GiB. Ollama `0.40.8`; `qwen3:4b`, Q4_K_M, chạy CPU (`size_vram=0`). Digest:

`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`

Template hash `2d54db2b9bb29ce7db54fea63a891f5859603813c555b1f88b5e0994652897f9`, không có system tùy chỉnh. Đây là nhận dạng cài đặt quan sát được, chưa chứng nhận weights/runtime hoạt động đúng.

Request mới: `think=false`, schema JSON bắt buộc title/text, temperature 0,7; top_p 0,8; top_k 20; min_p 0; context 8192; output tối đa 1600 token; seed 42 trong benchmark. Mức sampling tham khảo [hướng dẫn Qwen](https://qwen.readthedocs.io/en/stable/getting_started/quickstart.html), không phải bằng chứng dịch đạt. Có kiểm tra kích thước context bảo thủ, không âm thầm cắt nguồn.

Bộ thử có ba bài VI hư cấu, gồm bài nhiều tên riêng. Pilot dùng bài `riverside` 413 ký tự, một lượt mỗi cặp, chạy tuần tự. Thời gian dưới đây là quan sát trên máy dùng chung CPU, không phải phép đo hiệu năng dưới tải được kiểm soát; queue wait local bằng 0.

| Ngôn ngữ | Worker mới v2.1 | Direct cùng request | Kết quả |
| --- | --- | --- | --- |
| Pháp | 25,297s tổng | 13,500s tổng | Cả hai reject `source_copy,wrong_language` |
| Ả Rập | 14,218s tổng | 10,579s tổng | Cả hai reject `source_copy,wrong_script,wrong_language` |
| Đức/Tây Ban Nha/Ý/Bồ Đào Nha/Indonesia | Chưa chạy bộ benchmark mới | Chưa chạy | Không đủ bằng chứng model; chưa mở batch |

Pilot trước đó với validator v2.0 cũng không đạt: Pháp baseline 19,406s / worker 14,782s / direct 11,438s; Ả Rập baseline 13,391s / worker 14,203s / direct 12,484s. Baseline là request tái dựng từ implementation cũ với nguồn tổng hợp, không phải phép thay duy nhất prompt so với request mới. Prose control Pháp/Ả Rập timeout lần lượt 45,016s và 45,031s; không có output hoàn chỉnh để kết luận đúng/sai nghĩa.

Đối chiếu từng yếu tố trên Pháp: chỉ đổi temperature từ baseline vẫn sao chép (10,141s); chỉ thay schema vẫn sao chép (9,859s). Bỏ ràng buộc format khỏi request mới timeout 30,016s. Prose control thay giao thức nhiều hơn một yếu tố, nên không dùng để kết luận riêng tác động schema. Những timeout ở báo cáo cũ thiếu raw response; công cụ hiện đã lưu request trước khi gọi để timeout vẫn có bằng chứng request.

**Không locale nào của model vượt pilot; không có đánh giá ngữ nghĩa bởi người đọc đủ năng lực ở ngôn ngữ đích.** Đã thử lệnh full, kết quả `blocked_by_pilot`; chưa chạy 3 nguồn × 7 đích × 2 lượt = 42 lần. Fixture/mock chỉ chứng minh validator và luồng xử lý.

Raw báo cáo local: `.runtime/translation-benchmark-pilot.json`, `translation-benchmark-controls.json`, `translation-benchmark-final-pilot.json`, `translation-benchmark-full.json`, `translation-model-metadata.json`. Báo cáo có request/response khi nhận được, parameters, version/hash, timing, done reason và trường manual review chưa đánh giá. Không đưa raw nghiệp vụ lên log production.

## Audit lịch sử chỉ đọc

Đã lấy snapshot bằng transaction PostgreSQL `READ ONLY`, xác minh `SHOW transaction_read_only=on`, chỉ SELECT và rollback; audit không gọi endpoint admin có tác dụng hết hạn job. Sau đó chạy lại validator v2.1 hoàn toàn từ snapshot local. Không sửa trạng thái job, POI, bản dịch, release, lịch sử hoặc enqueue lại.

| Phạm vi | Passed | Rejected | Uncertain |
| --- | ---: | ---: | ---: |
| Kết quả supplement giữ trong job | 0 | 21 | 0 |
| Các locale trong bản nháp Wikipedia của job | 19 | 0 | 5 |
| Bản dịch đang lưu, ngoài VI | 14 | 0 | 5 |
| Locale trong mọi release lịch sử, ngoài VI | 46 | 0 | 16 |
| Trong các release hiện hành | 14 | 0 | 5 |

21 supplement sai **không có kết quả nào trùng cả title/text với bản đang lưu hoặc release hiện hành**. Không có căn cứ từ audit này để nói chúng đã được xuất bản. 26 job lỗi không lưu output nên không thể dựng lại toàn bộ đầu ra của chúng.

Năm mục đang lưu uncertain gồm EN, hai zh-CN, zh-TW và AR; không tự kết luận chúng sai hoặc dịch lại. Đối với bản đã lưu không liên kết được job, bài VI hiện tại chỉ là nguồn đối chiếu tạm, không được xem là nguồn lịch sử đã chứng minh. Metadata `origin=manual`, revision, khác biệt so với job và snapshot release được giữ để admin kiểm tra. Cả bộ có 61 mục cần xem xét (bao gồm provenance chưa chứng minh và các phiên bản lịch sử), không phải 61 bản dịch sai hay 61 POI khác nhau.

Snapshot/báo cáo riêng: `.runtime/translation-audit-snapshot.json`, `.runtime/translation-audit-report.json`. Kế hoạch tái tạo trong báo cáo luôn `ready:false`; chỉ là danh sách cần xem xét. Cần admin đối chiếu nguồn đúng phiên bản, chỉnh sửa thủ công và nội dung đang công khai trước khi chọn mục chạy lại, sau khi model đã đủ bằng chứng.

## Cấu hình và thao tác local

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `AI_TRANSLATION_ENABLED` | `true` | Cho phép thử nhỏ; đặt `false` để ngừng nhận yêu cầu AI mới. Không hủy job đã có. |
| `AI_TRANSLATION_BATCH_LIMIT` | `1` | 1–10 đích/request; không tự chạy hết ngôn ngữ. |
| `AI_TRANSLATION_PENDING_LIMIT` | `3` | 1–10 job queued/running mỗi người yêu cầu, tính cả creation và supplement. |
| `AI_TRANSLATION_VERIFIED_LOCALES` | rỗng | Batch >1 chỉ được phép cho các locale liệt kê chính xác, sau benchmark và review của người phụ trách. Không tự điền danh sách bằng detector. |
| `AI_GENERATION_TIMEOUT_SECONDS` | `120` | 30–300s riêng thời gian suy luận; chờ queue không trừ vào timeout này. Phải đặt trên PC worker; direct mode đặt trên backend local. |

Policy batch đặt trên backend; khi đổi cấu hình cần khởi động lại process liên quan. `model_verified` trong API phản ánh danh sách operator cấu hình, không phải chứng chỉ model tự phát hành. Giữ danh sách rỗng ở thời điểm bàn giao. Có thể thử một locale chưa nghiệm thu; để ngừng cả thử nghiệm đặt `AI_TRANSLATION_ENABLED=false`. Cờ này không khóa sửa tay hoặc phục vụ bản công khai.

Lease 900s, heartbeat 20s; job quá 24h hoặc hết lease sau 3 lần nhận bị đánh dấu lỗi. Heartbeat không gia hạn lease vô hạn. Retry gửi completion tối đa 3 lần, backoff 1s/2s; các lỗi 401/403/409/422 không retry. Poll idle 5s; không nghỉ thêm giữa job có sẵn. Chỉ có một claim chạy trên PostgreSQL production; direct mode dùng semaphore local theo process, không được chạy nhiều process inference.

```powershell
# Không tải model, không tạo job nghiệp vụ. Chạy trong môi trường local không có job inference khác.
services/backend/.venv/Scripts/python.exe scripts/calibrate_translation_validator.py
services/backend/.venv/Scripts/python.exe scripts/benchmark_translations.py --languages fr,ar --modes worker,direct --timeout 45 --output .runtime/new-pilot.json
services/backend/.venv/Scripts/python.exe scripts/benchmark_translations.py --stage full --pilot-report .runtime/new-pilot.json --output .runtime/new-full.json

# Audit lại snapshot có sẵn, không kết nối database:
services/backend/.venv/Scripts/python.exe scripts/audit_ai_translations.py --snapshot .runtime/translation-audit-snapshot.json --output .runtime/new-audit.json
```

Full bị chặn nếu pilot worker chưa qua hoặc khác model digest/prompt/validator/corpus. Công cụ chỉ kết nối Ollama loopback có sẵn, raw benchmark phải ở `.runtime`. Để lấy snapshot khác, cấp `TRANSLATION_AUDIT_DATABASE_URL` qua secret manager cho tài khoản chỉ đọc, rồi chạy `--database`; remote cần thêm `--allow-remote-read`. Không đặt credential trong đối số hoặc tài liệu. Script không tự đọc `DATABASE_URL/local.env`, không có lệnh sửa dữ liệu. Có thể dùng database restore local để giảm truy cập cloud.

## Kiểm thử

| Kiểm tra cuối | Kết quả |
| --- | --- |
| Ruff, cấu hình `services/backend/pyproject.toml`, app/tests/migrations/scripts | Qua |
| Pytest SQLite, dữ liệu tạm | 197 qua, 6 bỏ qua vì cần PostgreSQL |
| Pytest PostgreSQL 18.6, cluster tạm riêng | 203 qua |
| Typecheck admin/web/edge | Qua |
| Build site admin/web | Qua |
| Playwright: admin, narration-location, translation-reliability; desktop/mobile | 40 qua |
| `git diff --check` | Qua |

Lệnh tái chạy từ root: `services/backend/.venv/Scripts/python.exe -m ruff check --config services/backend/pyproject.toml services/backend/app services/backend/tests services/backend/migrations scripts`; `services/backend/.venv/Scripts/python.exe -m pytest services/backend/tests -q`; `services/backend/.venv/Scripts/python.exe scripts/test_postgres.py`; `npm.cmd run typecheck`; `npm.cmd run build:site`; `npm.cmd run test:e2e -- tests/e2e/admin.spec.ts tests/e2e/narration-location.spec.ts tests/e2e/translation-reliability.spec.ts`. PostgreSQL helper tự tạo cluster loopback tạm; không trỏ test vào database thật. Trên máy này dùng Node portable theo README và browser có sẵn trong `.runtime/pw-browsers`.

Các ca kiểm tra gồm: copy chính xác/NFD/dấu câu/gần nguyên văn/thêm câu ngoại ngữ; ngôn ngữ sai/trộn; một chữ Ả Rập không đủ; tên riêng; nguồn ngắn; cùng ngôn ngữ; uncertain; Unicode/schema/truncated; bypass completion cho cả hai nhánh; mã lỗi/secret; lease/heartbeat cũ; idempotence; pending/batch/disable; audit collector chỉ đọc; partial success; review riêng tư, không tăng engagement.

PostgreSQL local 18.6, migration rehearsal từ base/0007/0008/0009 lên 0010. PostgreSQL 17 trong CI chưa chạy ở phiên này; chưa chạy tải dài hạn Render, benchmark đầy đủ, đánh giá ngữ nghĩa đa ngôn ngữ, giọng thật/thiết bị thật hoặc kiểm thử deploy production. Có warning Starlette về httpx ở TestClient; các ca kiểm thử vẫn qua. Không dùng Ollama thật trong CI bắt buộc.

## Phát hành và rollback — chưa thực hiện

1. Review thay đổi, dependency và evidence ở staging. Giữ `AI_TRANSLATION_VERIFIED_LOCALES` rỗng/batch 1, hoặc tắt nhận yêu cầu AI mới khi chuyển phiên bản. Không push main nếu điều đó tự deploy khi chưa được phép.
2. Phát hành backend với `uv sync --frozen` và protocol 3 trước; không cần migration mới. Worker cũ không nhận job contract mới; readiness báo cần cập nhật. Job legacy được giữ nguyên.
3. Người vận hành cập nhật dependency/code và restart **một** PC worker protocol 3, không để hai bản worker chạy cùng lúc. Nhiệm vụ này chưa restart worker đang phục vụ production.
4. Phát hành frontend/edge metadata protocol 3; kiểm tra một job staging đúng ngôn ngữ, một source-copy, một timeout và review nháp không thay public. Chỉ mở rộng từng locale sau benchmark và người đọc kiểm tra.
5. Rollback: ngừng nhận job AI mới, dừng worker mới theo quy trình vận hành, trả backend/frontend/worker về bộ phiên bản tương thích. Không rollback dữ liệu hoặc xóa metadata/history. Bản cũ có lỗ hổng completed giả, nên không bật dịch trở lại trên bản cũ chỉ vì rollback thành công. Nội dung đã công khai tiếp tục theo snapshot hiện có.

Để cải thiện sinh nội dung, bước tiếp theo là kiểm tra template/runtime Qwen đang cài trong một thử nghiệm tách biệt có log request, thay từng yếu tố và giữ nguyên corpus. Nếu vẫn không đạt, có thể xin phép benchmark riêng [qwen2.5:3b/7b](https://ollama.com/library/qwen2.5) (weights khoảng 1,9/4,7GB) hoặc một model instruct đa ngôn ngữ cỡ nhỏ khác. Với RAM hệ thống khoảng 13,69 GiB, chọn bản quantized nhỏ và context 4K–8K, đo thêm RAM runtime/OS và tốc độ CPU; kích thước file không phải RAM tổng. Chưa tải hoặc kiểm chứng các lựa chọn đó; không coi chúng là bản thay thế đã nghiệm thu.
