// 病人點「請治療師回覆我」→ 推一則「有病人在找真人」到治療師群組
const GROUP_ID = "Ced4d474900327f2cdedbc6ec7bd3adea";
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const f = await req.json().catch(() => ({}));
    const who = f && f.name ? `（${f.name}）` : "";
    const last = f && f.lastMessage ? `\n病人說：「${String(f.lastMessage).slice(0, 80)}」` : "";
    const bubble = {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#c0392b", paddingAll: "14px",
        contents: [
          { type: "text", text: "🔔 有病人在找真人回覆", color: "#ffffff", size: "lg", weight: "bold", wrap: true },
        ],
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px",
        contents: [
          { type: "text", text: `有病人${who}希望治療師親自回覆${last}`, size: "sm", color: "#2a1d12", wrap: true },
          { type: "text", text: "→ 麻煩有空的同事到官方帳號回覆他 🙏", size: "xs", color: "#888888", wrap: true, margin: "md" },
        ],
      },
    };
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: GROUP_ID, messages: [{ type: "flex", altText: "🔔 有病人在找真人回覆", contents: bubble }] }),
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (_e) {
    return new Response(JSON.stringify({ ok: false }), { headers: { ...cors, "content-type": "application/json" } });
  }
});
