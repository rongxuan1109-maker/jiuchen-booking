Deno.serve(async (req) => {
  if (req.method === "GET") return new Response("ok");
  try {
    const body = await req.text();
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    await fetch(`${url}/rest/v1/webhook_capture`, {
      method: "POST",
      headers: { "apikey": key, "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ payload: JSON.parse(body || "{}") }),
    });
  } catch (_e) { /* ignore */ }
  return new Response("OK", { status: 200 });
});
