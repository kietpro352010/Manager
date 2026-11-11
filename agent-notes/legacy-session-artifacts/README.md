# Lưu trữ Bản ghi Phiên Làm việc Cũ (`legacy-session-artifacts/`)

> [!WARNING]
> **CHỈ DÙNG ĐỂ THAM KHẢO LỊCH SỬ (PRE-`e3c94ec`) — KHÔNG PHẢI TRẠNG THÁI HIỆN TẠI.**
> Các file trong thư mục này là ảnh chụp nguyên bản các artifact ghi chú của agent từ các phiên rà soát/sửa lỗi trước đây (từ 08/11 đến 10/11, trước hàng loạt commit `b506e43` -> `6b9cd90` -> `2cd0a09` -> `a5421ef` -> `4c184b8` -> `e3c94ec`). Nhiều mục đánh dấu `[ ] Pending` hoặc mô tả phiên bản `4ec784b` ở đây đã được hoàn tất hoặc thay đổi ở các commit sau.

---

## 1. Danh sách file snapshot trong thư mục này

| File | Mốc thời gian | Nội dung |
|---|---|---|
| [`findings.md`](findings.md) | 10/11/2026 | Bảng remediation V11.8 (`F-01` .. `F-10` — cột trạng thái lúc đó ghi `Pending`, sau đó đã hoàn thành ở `4ec784b` & các test sau) |
| [`progress.md`](progress.md) | 10/11/2026 | Báo cáo tổng kết phiên `4ec784b` (Manager) và `c2f3eae` (BotWorker) |
| [`task_plan.md`](task_plan.md) | 10/11/2026 | Kế hoạch tối ưu tổng thể V11.8 across Manager & BotWorker |
| [`audit_and_fix_plan.md`](audit_and_fix_plan.md) | 08/11/2026 | Kế hoạch audit ban đầu sau live-test KingMC |

## 2. Các file chỉ có ở thư mục làm việc local (`D:/manager`) KHÔNG đưa vào Phần 1

Khi rà soát ổ đĩa local, thư mục `D:/manager` còn chứa một số file không có trong `D:/manager deploy` và **cố ý không commit vào Phần 1** vì:
- **Bị lỗi thời / sai lệch với code hiện tại** (sẽ gây hiểu nhầm cho ChatGPT nếu đặt ở root repo):
  - `CLAUDE.md`, `README.md`, `FEATURES.md`, `SETUP.md`, `docs/architecture.md`, `docs/deploy-manager-vi.md`, `docs/discord-commands-vi.md` (các file này ghi từ thời chưa có Web Dashboard / còn mô tả schema `manager_access` cũ hoặc nhắc migration `20261111000000`).
- **Bí mật / Runtime local / Script nháp**:
  - `.env`, `node_modules/`, `manager.log`, `start_manager.bat`, và thư mục `scratch/` (13 script nháp test/audit cũ).
