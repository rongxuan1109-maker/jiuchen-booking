// 症狀諮詢表單送出 → 撈病人 LINE 頭貼+名稱 → 推 Flex 通知到治療師群組
const GROUP_ID = "Ced4d474900327f2cdedbc6ec7bd3adea";
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function row(label: string, val: string) {
  return {
    type: "box", layout: "baseline",
    contents: [
      { type: "text", text: label, color: "#aaaaaa", size: "sm", flex: 3 },
      { type: "text", text: val || "—", color: "#2a1d12", size: "sm", flex: 6, wrap: true },
    ],
  };
}

async function getProfile(userId: string) {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { "Authorization": `Bearer ${LINE_TOKEN}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_e) { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const f = await req.json();
    const prof = f.lineUserId ? await getProfile(f.lineUserId) : null;

    const body: any[] = [];
    // 病人 LINE 身分（頭貼 + LINE 名稱），方便治療師在官方帳號一眼認出他
    if (prof && (prof.pictureUrl || prof.displayName)) {
      body.push({
        type: "box", layout: "horizontal", spacing: "md", alignItems: "center",
        contents: [
          ...(prof.pictureUrl ? [{
            type: "box", layout: "vertical", width: "78px", height: "78px", cornerRadius: "39px", flex: 0,
            contents: [{ type: "image", url: prof.pictureUrl, size: "full", aspectMode: "cover", aspectRatio: "1:1" }],
          }] : []),
          {
            type: "box", layout: "vertical", contents: [
              { type: "text", text: prof.displayName || "LINE 用戶", weight: "bold", size: "md", color: "#2a1d12", wrap: true },
              { type: "text", text: "↑ 這是他的 LINE 名稱/頭貼", size: "xxs", color: "#aaaaaa", wrap: true },
            ],
          },
        ],
      });
      body.push({ type: "separator", margin: "md", color: "#eeeae0" });
    }
    body.push(
      row("姓名", `${f.name || "—"}${f.age ? "（" + f.age + "歲）" : ""}`),
      row("部位", f.parts),
      row("症狀", f.symptoms),
      row("多久", f.dur),
      row("如何發生", f.cause),
      row("診斷書", f.dx),
      { type: "separator", margin: "sm", color: "#eeeae0" },
      { type: "text", text: "補充：" + (f.note || "—"), size: "sm", color: "#444444", wrap: true },
    );

    const bubble = {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#4f7a5a", paddingAll: "14px",
        contents: [
          { type: "text", text: "🤖 機器人提醒", color: "#ffffff", size: "lg", weight: "bold" },
          { type: "text", text: "官方 LINE 有病患諮詢，請協助回覆", color: "#e6f0e9", size: "xs", wrap: true },
        ],
      },
      body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: body },
    };
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: GROUP_ID, messages: [{ type: "flex", altText: "🤖 新症狀諮詢：" + (f.name || ""), contents: bubble }] }),
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false }), { headers: { ...cors, "content-type": "application/json" } });
  }
});
