# 瓦力 客服機器人 — Supabase Edge Functions 原始碼備份

> ⚠️ 尚未上線到 LINE 官方帳號(只在 bot-test.html 測試)。

- `clinic-bot.ts` — 主機器人(Claude Haiku + 工具:查空檔/約/改/取消/查預約/通知群組/管理者模式)。讀治療師班表 therapist_schedules。
- `consult-submit.ts` — 症狀諮詢表單送出 → 推群組(含頭貼名字)。
- `call-staff.ts` — 舊版「請治療師回覆」按鈕(現多改自動通知)。
- `line-webhook.ts` — 暫時 capture 事件(抓 groupId 用)。

## 重新部署(Management API)
POST https://api.supabase.com/v1/projects/vmkdawpukwpsifqguljy/functions/deploy?slug=<函式名>
Header: Authorization: Bearer <sbp_ Personal Access Token>
multipart: metadata={"entrypoint_path":"index.ts","name":"<函式名>","verify_jwt":false}, file=@index.ts

金鑰、群組ID、ADMIN_IDS 等見 Claude 記憶 jiuchen-credentials / jiuchen-ai-bot-progress。
