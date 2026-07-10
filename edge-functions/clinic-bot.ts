// 九辰 AI 客服機器人 — Supabase Edge Function
// 全聊天版：查空檔 / 幫忙約 / 改時間 / 取消，皆用對話完成，動到資料前一律 2 次確認。
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "https://vmkdawpukwpsifqguljy.supabase.co";
// 改用 service_role（Edge Function 環境自動注入）：資料庫已開 RLS 鎖門，公開 anon key 只剩最小權限，機器人要用員工鑰匙才讀寫得到
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = { "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "content-type": "application/json" };
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const GROUP_ID = "Ced4d474900327f2cdedbc6ec7bd3adea"; // 治療師群組
// 管理者(院長/治療師)LINE userId 名單 —— 只有名單內的人 + 打「#我是管理者」才有管理權限(可對任何病人操作)。要新增治療師就把他的 LINE userId 加進來。
const ADMIN_IDS = ["U6de9099563aed38d74a21f3076de659e"]; // 院長(之後加各治療師)
const ADMIN_RE = /#\s*(我是)?(管理者?|員工|治療師|admin)/i;

function gRow(label: string, val: string) {
  return { type: "box", layout: "baseline", contents: [
    { type: "text", text: label, color: "#aaaaaa", size: "sm", flex: 3 },
    { type: "text", text: val || "—", color: "#2a1d12", size: "sm", flex: 6, wrap: true },
  ]};
}
async function pushCancelToGroup(a: any) {
  if (!LINE_TOKEN) return;
  const bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#c0392b", paddingAll: "14px",
      contents: [{ type: "text", text: "❌ 病人取消預約", color: "#ffffff", size: "lg", weight: "bold" }] },
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: [
      gRow("姓名", a.patient_name || "—"),
      gRow("原時段", `${prettyDate(a.appointment_date)} ${(a.appointment_time || "").slice(0, 5)}`),
      gRow("治療師", a.therapist_name || "不指定"),
      { type: "text", text: "這筆預約已由病人取消，時段已空出。", size: "xs", color: "#888888", wrap: true, margin: "md" },
    ]},
  };
  try {
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: GROUP_ID, messages: [{ type: "flex", altText: "❌ 病人取消預約", contents: bubble }] }),
    });
  } catch (_e) { /* 群組通知失敗不影響取消本身 */ }
}

async function getLineProfile(uid: string) {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${uid}`, { headers: { "Authorization": `Bearer ${LINE_TOKEN}` } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_e) { return null; }
}
// 病人問了瓦力不會/不該答的問題(療程/病情/個人醫療) → 自動推一張卡到治療師群組
async function pushStaffAlert(question: string, lineUserId?: string) {
  if (!LINE_TOKEN) return;
  const prof = lineUserId ? await getLineProfile(lineUserId) : null;
  const body: any[] = [];
  if (prof && (prof.pictureUrl || prof.displayName)) {
    body.push({
      type: "box", layout: "horizontal", spacing: "md", alignItems: "center", contents: [
        ...(prof.pictureUrl ? [{ type: "box", layout: "vertical", width: "56px", height: "56px", cornerRadius: "28px", flex: 0, contents: [{ type: "image", url: prof.pictureUrl, size: "full", aspectMode: "cover", aspectRatio: "1:1" }] }] : []),
        { type: "box", layout: "vertical", contents: [{ type: "text", text: prof.displayName || "LINE 用戶", weight: "bold", size: "md", color: "#2a1d12", wrap: true }, { type: "text", text: "↑ 病人 LINE 名稱/頭貼", size: "xxs", color: "#aaaaaa" }] },
      ],
    });
    body.push({ type: "separator", margin: "md", color: "#eeeae0" });
  }
  body.push({ type: "text", text: "病人問了需要治療師回覆的問題：", size: "sm", color: "#888888", wrap: true });
  body.push({ type: "text", text: "「" + String(question || "").slice(0, 140) + "」", size: "md", color: "#2a1d12", wrap: true, weight: "bold" });
  body.push({ type: "text", text: "→ 麻煩有空的治療師到官方帳號回覆他 🙏", size: "xs", color: "#888888", wrap: true, margin: "md" });
  const bubble = {
    type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#c0392b", paddingAll: "14px", contents: [{ type: "text", text: "🔔 有病人要找治療師", color: "#ffffff", size: "lg", weight: "bold" }] },
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: body },
  };
  try {
    await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: GROUP_ID, messages: [{ type: "flex", altText: "🔔 有病人要找治療師", contents: bubble }] }),
    });
  } catch (_e) { /* 通知失敗不影響回覆 */ }
}

const TIMES = ["09:00","09:30","10:00","10:30","11:00","11:30","13:30","14:00","14:30","15:00","15:30","16:00"];
const norm = (s: string) => (s || "").replace(/[^0-9]/g, "");
const WDMAP: any = { Sun: "日", Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六" };
function wdOf(date: string) {
  try {
    const en = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date(date + "T12:00:00+08:00"));
    return WDMAP[en] || "";
  } catch { return ""; }
}
function prettyDate(date: string) { const [y, m, d] = (date || "").split("-"); return m && d ? `${+m}月${+d}日（${wdOf(date)}）` : date; }
function taipeiDatePlus(n: number) {
  const base = new Date(taipeiParts().date + "T12:00:00+08:00");
  base.setUTCDate(base.getUTCDate() + n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(base);
}
function dateRef() {
  const labels = ["今天", "明天", "後天"];
  const out: string[] = [];
  for (let i = 0; i < 15; i++) { const d = taipeiDatePlus(i); out.push(`${i < 3 ? labels[i] + "=" : ""}${d}(${wdOf(d)})`); }
  const todayWd = isoWeekday(taipeiParts().date); // 1=一..7=日
  const names = ["一", "二", "三", "四", "五", "六", "日"];
  const rel: string[] = [];
  // 「禮拜X／這禮拜X」一律解讀成「最近即將到來的那一天」(今天或之後)，門診不會約過去
  for (let i = 0; i < 7; i++) { const delta = ((i + 1) - todayWd + 7) % 7; const d = taipeiDatePlus(delta); rel.push(`這禮拜${names[i]}=${d}(${wdOf(d)})`); }
  for (let i = 0; i < 7; i++) { const delta = ((i + 1) - todayWd + 7) % 7 + 7; const d = taipeiDatePlus(delta); rel.push(`下禮拜${names[i]}=${d}(${wdOf(d)})`); }
  return out.join("、") + "。\n【週次對照（病人只說「禮拜X」沒講這週下週時，就用「這禮拜X」那一格）】\n" + rel.join("、");
}

function taipeiParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p: any = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const wdEn = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date());
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, wdEn };
}

let _therapists: any[] | null = null;
async function getTherapists() {
  if (_therapists) return _therapists;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/therapists?select=id,name,specialty&order=id`, { headers: sbHeaders });
    _therapists = (await r.json()) || [];
  } catch (_e) { _therapists = []; }
  return _therapists;
}
async function resolveTherapist(therapist?: string) {
  if (!therapist || therapist === "不指定") return { id: null as number | null, name: "不指定" };
  const q = therapist.replace(/治療師|醫師|老師|先生|小姐/g, "").trim(); // 去掉稱謂,「江治療師」→「江」
  const ths = await getTherapists();
  let t = ths.find((x: any) => q.includes(x.name) || x.name.includes(q));
  if (!t && q) t = ths.find((x: any) => x.name[0] === q[0]); // 退而用姓氏第一字(九辰治療師都不同姓,安全)
  return t ? { id: t.id as number, name: t.name as string } : { id: null, name: therapist };
}

async function takenTimes(date: string, therapistId: number | null, anyTherapist: boolean) {
  let rows: any[] = [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/appointments?select=appointment_time,therapist_id,note,service&appointment_date=eq.${date}&status=eq.confirmed`, { headers: sbHeaders });
    rows = (await r.json()) || [];
  } catch (_e) { rows = []; }
  const taken = new Set<string>();
  for (const a of rows) {
    const t = (a.appointment_time || "").slice(0, 5);
    const isEvent = typeof a.note === "string" && a.note.startsWith("event:") && a.therapist_id == null;
    const applies = anyTherapist || a.therapist_id === therapistId || isEvent;
    if (applies) { taken.add(t); if (is60(a.service)) taken.add(plus30(t)); } // 60分的約也佔住下一格
  }
  return taken;
}

// 班表時段對應（與後台 admin.html 班表定義一致：早09:00–11:00、午15:00–18:00、晚18:00–20:00，30分一格含頭尾）
const PERIOD_SLOTS: any = {
  am: ["09:00", "09:30", "10:00", "10:30", "11:00"],
  pm: ["15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00"],
  eve: ["18:00", "18:30", "19:00", "19:30", "20:00"],
};
function isoWeekday(date: string) {
  const en = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date(date + "T12:00:00+08:00"));
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as any)[en];
}
function periodSlots(periods: any) {
  const out = new Set<string>();
  for (const p of (periods || [])) for (const t of (PERIOD_SLOTS[p] || [])) out.add(t);
  return Array.from(out); // 去重(午診18:00與晚診18:00重疊)
}
function plus30(t: string) { let [h, m] = t.split(":").map(Number); m += 30; if (m >= 60) { m -= 60; h++; } return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
function is60(service: string) { const s = service || ""; return s.includes("兩個") || s.includes("親友") || s.includes("60"); } // 兩個部位/親友一起=60分鐘=佔兩格
async function getSchedules() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/therapist_schedules?select=therapist_id,shifts`, { headers: sbHeaders });
    const rows = (await r.json()) || [];
    const m: any = {};
    for (const s of rows) m[s.therapist_id] = s.shifts || {};
    return m;
  } catch (_e) { return {}; }
}
async function checkAvailability(date: string, therapist?: string, period?: string, need = 1) {
  const inPeriod = (t: string) => !period || !PERIOD_SLOTS[period] || PERIOD_SLOTS[period].includes(t);
  const wd = isoWeekday(date);
  const th = await resolveTherapist(therapist);
  const anyTh = !therapist || therapist === "不指定";
  const tp = taipeiParts();
  if (wd === 7) return { date, therapist: th.name, free: [] }; // 週日休診
  const sched = await getSchedules();

  if (!anyTh && th.id != null) {
    const candidate = periodSlots((sched[th.id] || {})[String(wd)]);
    const candSet = new Set(candidate);
    const taken = await takenTimes(date, th.id, false);
    let free = candidate.filter((t) => !taken.has(t) && inPeriod(t));
    // 兩個部位(60分)：要這格 + 下一格都在班表內且都沒被約走
    if (need >= 2) free = free.filter((t) => { const n = plus30(t); return candSet.has(n) && !taken.has(n); });
    if (date === tp.date) free = free.filter((t) => t > tp.hm);
    free.sort();
    return { date, therapist: th.name, free };
  }
  // 不指定：某時段只要有一位「當天該時段有班且沒被約走(60分要連兩格)」的治療師，就算可約
  const ths = await getTherapists();
  let rows: any[] = [];
  try { const r = await fetch(`${SB_URL}/rest/v1/appointments?select=appointment_time,therapist_id,note,service&appointment_date=eq.${date}&status=eq.confirmed`, { headers: sbHeaders }); rows = (await r.json()) || []; } catch (_e) { /* */ }
  const bookedByTh: any = {}; const events = new Set<string>();
  for (const a of rows) {
    const t = (a.appointment_time || "").slice(0, 5);
    if (typeof a.note === "string" && a.note.startsWith("event:") && a.therapist_id == null) { events.add(t); if (is60(a.service)) events.add(plus30(t)); continue; }
    if (a.therapist_id != null) { const set = (bookedByTh[a.therapist_id] = bookedByTh[a.therapist_id] || new Set()); set.add(t); if (is60(a.service)) set.add(plus30(t)); }
  }
  const freeSet = new Set<string>();
  for (const t of ths) {
    const slots = periodSlots((sched[t.id] || {})[String(wd)]);
    const slotSet = new Set(slots);
    const bk = bookedByTh[t.id] || new Set();
    const okThis = (s: string) => slotSet.has(s) && !bk.has(s) && !events.has(s);
    for (const s of slots) {
      if (!okThis(s) || !inPeriod(s)) continue;
      if (need >= 2 && !okThis(plus30(s))) continue; // 60分要連兩格
      freeSet.add(s);
    }
  }
  let free = Array.from(freeSet);
  if (date === tp.date) free = free.filter((t) => t > tp.hm);
  free.sort();
  return { date, therapist: "不指定", free };
}

// 取出這位病人未來的預約原始列：綁此 LINE 身分的 ∪ 姓名+電話對得上的（含現場/電話約沒綁 LINE 的）
async function findApptRows(name?: string, phone?: string, lineUserId?: string, adminMode?: boolean) {
  const tp = taipeiParts();
  const sel = "id,patient_name,patient_phone,appointment_date,appointment_time,therapist_name,therapist_id,service,line_user_id";
  const base = `${SB_URL}/rest/v1/appointments?select=${sel}&status=eq.confirmed&appointment_date=gte.${tp.date}&order=appointment_date,appointment_time&limit=100`;
  const map = new Map<number, any>();
  // 管理者模式:用姓名跨「所有病人」查(不限本人),電話有給才比對
  if (adminMode && name) {
    const np = norm(phone || "");
    try { const r = await fetch(`${base}&patient_name=eq.${encodeURIComponent(name)}`, { headers: sbHeaders }); for (const a of (await r.json()) || []) { if (!np || norm(a.patient_phone || "") === np) map.set(a.id, a); } } catch (_e) { /* */ }
    return Array.from(map.values());
  }
  if (lineUserId) {
    try { const r = await fetch(`${base}&line_user_id=eq.${lineUserId}`, { headers: sbHeaders }); for (const a of (await r.json()) || []) map.set(a.id, a); } catch (_e) { /* */ }
  }
  if (name) {
    const np = norm(phone || "");
    try {
      const r = await fetch(`${base}&patient_name=eq.${encodeURIComponent(name)}`, { headers: sbHeaders });
      for (const a of (await r.json()) || []) {
        const sp = norm(a.patient_phone || "");
        // 名字已相符。安全規則：這筆「有存電話」→ 病人必須報對電話才算(防報個名字就查/取消別人)；這筆「沒存電話」(現場忙沒輸入)→ 才准只靠名字認。
        if (sp === "" || sp === np) map.set(a.id, a);
      }
    } catch (_e) { /* */ }
  }
  let arr = Array.from(map.values());
  if (name) arr = arr.filter((a) => a.patient_name === name); // 有指定名字→只留那個名字的(避免把 LINE 主人其他家人的預約也混進來)
  return arr;
}
function apptLabel(a: any) {
  const time = (a.appointment_time || "").slice(0, 5);
  return {
    id: a.id, name: a.patient_name, phone: a.patient_phone, date: a.appointment_date, dateText: prettyDate(a.appointment_date),
    time, therapist: a.therapist_name, service: a.service,
    label: `${a.patient_name || "(未填姓名)"}・${prettyDate(a.appointment_date)} ${time}・${(a.therapist_name || "不指定").replace(/治療師$/, "")}治療師`,
  };
}
async function findAppointments(name?: string, phone?: string, lineUserId?: string, adminMode?: boolean) {
  return (await findApptRows(name, phone, lineUserId, adminMode)).map(apptLabel);
}
// 依「病人 + 日期(+時間)」精準鎖定一筆。回傳 {appt} 或 {error}/{ambiguous}
async function pickAppt(input: any, lineUserId?: string, adminMode?: boolean) {
  const date = input.date;
  const time = input.time ? String(input.time).slice(0, 5) : null;
  if (!date) return { error: "缺少日期" };
  const rows = await findApptRows(input.name, input.phone, lineUserId, adminMode);
  let m = rows.filter((a) => a.appointment_date === date);
  if (input.name) m = m.filter((a) => a.patient_name === input.name); // 鎖定病人講的名字，避免砍到同一天同LINE底下的別人(如代約的家人)
  if (time) m = m.filter((a) => (a.appointment_time || "").slice(0, 5) === time);
  if (m.length === 0) return { error: `用您的姓名電話找不到 ${prettyDate(date)} 的預約，請再確認日期、大名或電話。` };
  if (m.length > 1) return { ambiguous: m.map((x) => (x.appointment_time || "").slice(0, 5)) };
  return { appt: m[0] };
}

async function createBooking(input: any, lineUserId?: string, testMode?: boolean, dryRun?: boolean) {
  const date = input.date, time = (input.time || "").slice(0, 5);
  if (!date || !time || !input.patient_name || !input.patient_phone) return { ok: false, error: "缺少日期/時間/姓名/電話" };
  const th = await resolveTherapist(input.therapist);
  const anyTh = !input.therapist || input.therapist === "不指定";
  const need = is60(input.service || "") ? 2 : 1; // 兩個部位=60分=要佔兩格
  const taken = await takenTimes(date, th.id, anyTh);
  if (taken.has(time)) return { ok: false, error: "這個時段剛好被約走了，請改其他時間" };
  // 60分:後一格要在治療師班表內、且沒被約走(防撞車/塞車)
  if (need >= 2) {
    const n = plus30(time);
    if (!anyTh && th.id != null) {
      const wd = isoWeekday(date); const sched = await getSchedules();
      const shiftSet = new Set(periodSlots((sched[th.id] || {})[String(wd)]));
      if (!shiftSet.has(time)) return { ok: false, error: "這個時段治療師沒有排班，請改其他時段" };
      if (!shiftSet.has(n)) return { ok: false, error: "兩個部位要連做60分鐘，但後面那半小時不在看診時段內，請改其他時間或改約一個部位" };
    }
    if (taken.has(n)) return { ok: false, error: "後面那半小時已經有人約了，沒辦法連做60分鐘，請換個時間或改一個部位" };
  }
  if (dryRun) return { ok: true, dryRun: true, date, time, therapist: th.name, name: input.patient_name, phone: input.patient_phone, service: input.service || "複診" };
  const note = (testMode ? "【測試】" : (lineUserId ? "" : "【AI測試】")) + (input.note || "");
  const row = {
    therapist_id: th.id, patient_name: input.patient_name, patient_phone: input.patient_phone,
    appointment_date: date, appointment_time: time + ":00", type: "return", service: input.service || "複診",
    symptoms: "", note, status: "confirmed", line_user_id: lineUserId || null, therapist_name: th.name,
  };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/appointments`, { method: "POST", headers: { ...sbHeaders, "Prefer": "return=representation" }, body: JSON.stringify(row) });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: JSON.stringify(d) };
    return { ok: true, id: Array.isArray(d) ? d[0]?.id : d?.id, date, time, therapist: th.name, name: input.patient_name, phone: input.patient_phone, service: input.service || "複診" };
  } catch (e) { return { ok: false, error: String(e) }; }
}

async function rescheduleBooking(input: any, lineUserId?: string, dryRun?: boolean, adminMode?: boolean) {
  const newDate = input.new_date; const newTime = input.new_time ? String(input.new_time).slice(0, 5) : null;
  if (!newDate || !newTime) return { ok: false, error: "缺少新日期/新時間" };
  const picked = await pickAppt(input, lineUserId, adminMode); // 用「病人+原日期(+原時間)」鎖定那筆，不靠編號
  if (picked.error) return { ok: false, error: picked.error };
  if (picked.ambiguous) return { ok: false, error: `${prettyDate(input.date)} 有多筆(${picked.ambiguous.join("、")})，請告訴我原本是哪個時間。` };
  const cur = picked.appt;
  const thId = cur.therapist_id ?? null;
  const taken = await takenTimes(newDate, thId, thId === null);
  if (taken.has(newTime)) return { ok: false, error: "新時段已被約走，請換個時間" };
  if (dryRun) return { ok: true, dryRun: true, id: cur.id, name: cur.patient_name, from: `${prettyDate(cur.appointment_date)} ${(cur.appointment_time || "").slice(0, 5)}`, date: newDate, time: newTime };
  const patch: any = { appointment_date: newDate, appointment_time: newTime + ":00" };
  if (!adminMode && lineUserId && cur.line_user_id !== lineUserId) patch.line_user_id = lineUserId; // 認親(管理者代操作不綁自己身分)
  try {
    const r = await fetch(`${SB_URL}/rest/v1/appointments?id=eq.${cur.id}`, { method: "PATCH", headers: { ...sbHeaders, "Prefer": "return=representation" }, body: JSON.stringify(patch) });
    if (!r.ok) return { ok: false, error: await r.text() };
    return { ok: true, id: cur.id, date: newDate, time: newTime, name: cur.patient_name };
  } catch (e) { return { ok: false, error: String(e) }; }
}

async function cancelBooking(input: any, lineUserId?: string, dryRun?: boolean, adminMode?: boolean) {
  const picked = await pickAppt(input, lineUserId, adminMode); // 用「病人+日期(+時間)」鎖定那筆，不靠編號
  if (picked.error) return { ok: false, error: picked.error };
  if (picked.ambiguous) return { ok: false, error: `${prettyDate(input.date)} 有多筆預約(${picked.ambiguous.join("、")})，請告訴我要取消哪個時間。` };
  const appt = picked.appt;
  if (dryRun) return { ok: true, dryRun: true, id: appt.id, name: appt.patient_name, dateText: prettyDate(appt.appointment_date), time: (appt.appointment_time || "").slice(0, 5) };
  const patch: any = { status: "cancelled" };
  if (!adminMode && lineUserId && appt.line_user_id !== lineUserId) { patch.line_user_id = lineUserId; appt.line_user_id = lineUserId; } // 認親(管理者代操作不綁自己身分)
  try {
    const r = await fetch(`${SB_URL}/rest/v1/appointments?id=eq.${appt.id}`, { method: "PATCH", headers: { ...sbHeaders, "Prefer": "return=representation" }, body: JSON.stringify(patch) });
    if (!r.ok) return { ok: false, error: await r.text() };
  } catch (e) { return { ok: false, error: String(e) }; }
  await pushCancelToGroup(appt);
  return { ok: true, id: appt.id, name: appt.patient_name, dateText: prettyDate(appt.appointment_date), time: (appt.appointment_time || "").slice(0, 5) };
}

// (限管理者)列出某天全部病人的預約清單
async function listAppointments(date?: string, therapist?: string) {
  if (!date) return { ok: false, error: "缺少日期" };
  let url = `${SB_URL}/rest/v1/appointments?select=appointment_time,patient_name,therapist_name,therapist_id,service,note&appointment_date=eq.${date}&status=eq.confirmed&order=therapist_id,appointment_time&limit=300`;
  let thName = "全部治療師";
  if (therapist && therapist !== "不指定" && therapist !== "全部") {
    const th = await resolveTherapist(therapist);
    if (th.id) { url += `&therapist_id=eq.${th.id}`; thName = th.name; }
  }
  let rows: any[] = [];
  try { const r = await fetch(url, { headers: sbHeaders }); rows = (await r.json()) || []; } catch (_e) { /* */ }
  rows = rows.filter((a) => !(typeof a.note === "string" && a.note.startsWith("event:")));
  // 先依「治療師+病人」分組,再把連續時段合併(60分被存成兩列)→ 一筆,顯示起訖
  const byKey = new Map<string, any>();
  for (const a of rows) {
    const t = (a.appointment_time || "").slice(0, 5);
    const key = a.therapist_id + "|" + a.patient_name;
    if (!byKey.has(key)) byKey.set(key, { therapist: a.therapist_name, name: a.patient_name, times: [] as string[] });
    byKey.get(key).times.push(t);
  }
  const list: any[] = [];
  for (const g of byKey.values()) {
    const ts = [...new Set(g.times)].sort();
    let i = 0;
    while (i < ts.length) {
      let j = i; while (j + 1 < ts.length && plus30(ts[j]) === ts[j + 1]) j++;
      const start = ts[i], slots = j - i + 1, end = plus30(ts[j]);
      list.push({ start, time: `${start}–${end}`, name: g.name, therapist: g.therapist, len: `${slots * 30}分` });
      i = j + 1;
    }
  }
  list.sort((a, b) => a.start.localeCompare(b.start));
  return { ok: true, date: prettyDate(date), therapist: thName, count: list.length, appointments: list.map(({ start, ...r }) => r) };
}

const tp0 = taipeiParts();
const SYSTEM = `你是「九辰物理治療所」的 LINE 客服小幫手。九辰非常重視「禮貌、溫馨」，回覆要像九辰真人櫃台。今天是 ${tp0.date}（台灣時間，星期 ${tp0.wdEn}）。
【你的任務（核心）】用「聊天」幫病人把事情辦好：回答問題、查空檔、幫忙預約、改時間、取消。病人只要動嘴，你負責去後台處理並回報。能自己回答的（營業時間、收費、地點、交通、就診流程、掛號費、初診須知、服務項目）就大方明確回答，不要動不動推給電話。
【表明身份】你是九辰的 AI 客服小幫手，名字叫「瓦力」🤖，不是真人。被問「你是真人嗎」或自我介紹時，誠實說「我是九辰的 AI 小幫手瓦力🤖」，可幫忙解答常見問題、協助預約，需要時也會幫忙轉接專人。
【語氣】像真人小幫手聊天，自然、親切、簡短(多半1-3句)。不要太制式、不要 AI 感：不要罐頭客套、不要每句加 emoji(偶爾一個)、不要冗長。可用「您好」「不好意思」「好喔」「沒問題」「可以喔」等口語。不要用 markdown(會顯示成星號)。一律台灣用語。
【診所】九辰物理治療所(高雄楠梓)｜地址：楠梓區清豐二路108號2樓｜電話：07-351-6097｜服務：體外震波、一對一徒手治療、運動傷害、急慢性疼痛與骨科復健。
【營業時間】週一、四 14:30–18:00、18:30–22:00；週二三五六 09:00–12:00、14:30–18:00、18:30–22:00；週日休息。
【就診流程(預設建議順序：先中醫→再治療所)】物理治療依法需要醫師「診斷書」(3個月內有效)。**預設一律先推薦病人「先到同棟1樓『德杏中醫』掛號看診，再上2樓治療所」**，理由講給病人聽:①順便取得物理治療需要的診斷書 ②樓下中醫的掛號費可以折抵2樓掛號費(等於省一筆)。
**唯一可以直接上2樓的情況**:病人「已自備3個月內的診斷書」。
若病人說「不想看中醫」→ 溫和說明:物理治療依法一定要有診斷書，您若已經有就可以直接上2樓；如果沒有，最方便還是先在樓下德杏中醫看診取得(也能折抵掛號費)。→ 等於沒自備診斷書就還是引導去樓下中醫。
初診/長輩/急性受傷要溫馨提醒提早到、先到樓下中醫報到。
【樓下德杏中醫(同棟1樓)】有中醫看診與針灸;可看院長「陳醫師」;下午診大約 14:30(下午2:30)開始。物理治療需要的診斷書可在這裡看診取得,且樓下掛號費可折抵2樓掛號費。⚠️ 德杏是另一間院所,詳細門診時間/醫師/針灸適不適合,以德杏為準 —— 不確定就請病人到場問或打電話,不要替德杏掰細節。提醒:要先看樓下中醫的話,記得早點到(樓下中午/傍晚有休診時間),免得趕不上看診。
【掛號費與收費 — 報價一定要看「走哪條路徑」(超重要,別報錯)】2樓治療費:整合式治療單次約1500元(現場評估)。掛號費分兩種情況:
 ① 走推薦流程『先看樓下德杏中醫』(沒自備診斷書時的預設) → 掛號費是付『樓下中醫』那邊的,而且會折抵2樓掛號費(所以2樓不用再付200)。費用講法=「樓下中醫的掛號費(可折抵2樓掛號費) + 2樓治療費1500」,**這種情況絕對不要報2樓的200**(會被折抵掉)。
 ② 病人『自備3個月內診斷書、直接上2樓』 → 才是「2樓掛號費200 + 治療費1500」(約1700)。
 ★鐵則:「200掛號費 + 1500」這種講法**只有在病人自備診斷書、直接上2樓時才可以講**;沒自備診斷書(走中醫流程)時不可報200。若不確定病人走哪條,就先問「請問您有自備3個月內的診斷書嗎?」再報對應的價;不確定就把兩種都簡短講。折抵的是掛號費、不是治療費。
【收費】治療費另計：整合式治療單次1500元為主，實際由治療師現場評估說明(不講死)。
【可處理的狀況/適應症】(官網整理)運動傷害、肌肉拉傷/扭傷/挫傷、肌筋膜炎、落枕、肩頸腰背痛、五十肩、關節僵硬、肌肉痠痛、慢性疲勞症候群、坐骨神經痛、神經根炎、周邊神經損傷、顏面神經麻痺、急慢性疼痛與骨科損傷復健等。被問「能不能處理某問題/某部位」時可正面回「這類我們有在處理喔～」，但一律要請治療師親自評估、建議先預約初診；不對個人下診斷、不宣稱療效、不保證一定會好(台灣法規)。

【診斷證明 / 保險理賠（重要,別跟治療前的診斷書搞混）】病人問「診斷證明、保險理賠、收據申請」時:這是「治療後給保險理賠用的診斷證明」,跟「開始物理治療需要的醫師診斷書」是兩回事。申請流程要講清楚:①病人每次來做治療,診所都會逐次記錄。②要等「整個療程(所有治療)都做完」之後,才一起申請一次(不是每次或中途申請)。③最後開立的診斷證明上,會把「整個治療期間的治療費用」一起寫上去。所以有保險需求的病人,做完整個療程再來申請一次即可。
【申請方式】可直接到1樓中醫(德杏)櫃檯申請,或撥電話 07-351-6097 申請。
【不確定就不要亂答(務必遵守)】只要「不確定病人的情況或問題」(例如理賠細節、特殊需求、不在上述流程內的問題)→ **絕對不要亂回答、不要編** → 直接說「這部分我幫您通知治療師協助,或您也可以撥電話 07-351-6097 詢問喔🙏」並在最後一行放 [[CALL_STAFF]]。至於「保險賠多少、保單能不能賠、要附什麼文件」一律請病人去問自己的保險業務員(那是保險公司的事,不替它判斷)。

【預約相關（這是重點，請嚴格遵守流程）】
你有四個工具：check_availability(查某天空檔)、find_appointments(用電話或LINE身分找出病人的預約)、create_booking(建立預約)、reschedule_booking(改時間)、cancel_booking(取消)。
重要安全規則：create_booking / reschedule_booking / cancel_booking 這三個會「真的動到資料」，呼叫它們之前，**一定要先把完整內容複誦給病人、得到病人明確的「對/好/沒錯」確認後才呼叫**。不可以病人才講一句就直接動手。寧可多問一句確認。

(一) 幫忙預約 — 完全照九辰預約系統的路徑與規則，不可跳步：

【步驟1 先分就診類型】先問：「請問是第一次來九辰(初診)，還是之前有來過(複診)呢？」。幫家人/親友約，也要問清楚那位是初診還是複診——絕不可直接當複診收名字電話約掉。

【步驟2A 初診】只要是初診(第一次來/幫初診的家人約)，**務必主動把這兩件事講清楚，不可省略**：
 (a) 就診流程與診斷書(預設先推薦看中醫)：先親切建議「建議您先到同棟1樓『德杏中醫』掛號看診，一來取得物理治療需要的診斷書，二來樓下的掛號費可以折抵2樓掛號費，看完再上2樓做治療最方便喔～」。→ 病人若說『已自備3個月內診斷書』就回「那可以直接上2樓沒問題」；病人若說『不想看中醫』就溫和說「物理治療依法一定要診斷書，您若已經有就能直接上來；沒有的話最方便還是先在樓下中醫看診取得喔」。長輩/跌倒/急性受傷更要講清楚，免得白跑一趟。
 (b) 初診要填一份小問卷(基本資料、年齡、不適部位、怎麼發生、病史)，用線上預約連結填比較完整：https://rongxuan1109-maker.github.io/jiuchen-booking/ (上面有出現的時段就是還有空的)。
 不要只收姓名電話、也不要只丟連結而沒講診斷書流程。

【步驟2B 複診一定要先問「項目」】系統只有兩種項目，務必問清楚並擇一：
 ①「複診一個部位」→ 約30分鐘。
 ②「複診兩個部位／親友一起約」→ 約60分鐘。
 判斷原則：只要「不只一個部位」，或「不只一個人一起來(夫妻、親友、家人兩人含以上一起做)」，就一律選②60分鐘。例如病人說「我跟我太太一起」「兩個人」「帶我媽一起做」「順便做兩個地方」→ 都選②。create_booking 的 service 就帶「複診一個部位」或「複診兩個部位／親友一起約」。

【步驟3 治療師】可「不指定」(系統安排)或指定。九辰治療師：徐若椏、劉恕愷、張維庭、江榮軒。

【步驟4 時段（完全依治療師班表）】只能約今天以後、還沒過的時間。**週日固定公休**。其他每一天能不能約、早上/下午/晚上各時段開不開，完全看「治療師班表」——一律用 check_availability(date, therapist) 查，它會依班表算出那天「該治療師(或不指定=任一有班的)」實際可約的時段（已包含晚上時段）。你只要照它回傳的 free 清單講給病人。沒人上班的時段它不會回，那就是那個診目前不開放。不要自己列時段、也**不要再說「晚上不能約」**（晚上有治療師上班就能約）。查到那天全空(free 是空的)就說那天目前沒有開放的時段、問要不要看別天。
★ 線上可約最晚到「晚上8:00(20:00)」。病人若問更晚(8點半、9點…),不要說「滿了」(那不是滿,是線上沒開放) → 說明「線上最晚到晚上8點喔,更晚的時段我幫您通知治療師看能不能安排」並在最後一行放 [[CALL_STAFF]]。
★ 兩個部位/親友一起(60分鐘)查空檔時,check_availability **一定要帶 parts=2** → 這樣只會顯示「能連做滿60分鐘」的時段(避免約了卻跟下一位撞車)。
★ 病人若「直接指定某個時間」(例:18:30可以嗎?)→ **不可以憑空回「可以」**。要嘛確認那個時間有出現在 check_availability 的 free 清單裡才說可以,要嘛照常走到 create_booking(它會自動擋掉被約走/撞車的時段);若工具回 ok:false 說被約走,就照實說該時段不行、給其他時段。
★ 絕對禁止自己編造節日/連假/國定假日/休診：你**不知道**診所的國定假日行事曆，所以**永遠不要說**「端午連假」「過年」「中秋」「國定假日休診」這類話。某天能不能約，只看「週日公休」+ check_availability 查到的實際結果，其他一律不要猜、不要掰。

【步驟5 姓名電話】先用 find_appointments(電話或LINE身分)看是不是老病人；是→直接帶出姓名跟他確認即可，不用重問；查不到→請他提供姓名和電話(一次問清，不要一題一題)。幫親友約就用「那位要看診的人」的姓名電話，並在 note 備註是誰代約。

【步驟6 複誦確認後才約】複誦例：「幫您約 6月7日(六) 14:00，江榮軒治療師，項目：兩個部位(60分鐘)，王太太 0912…，這樣可以嗎？」→ 病人說可以 → 才呼叫 create_booking(帶對應 service)。成功後講一句溫暖話並提醒：有3個月內醫師診斷書可直接上2樓；沒有的話提早到1樓德杏中醫看診取得(細節讓卡片顯示)。

(二) 改時間：
1. 用 find_appointments(name, phone) 找出他的預約；列清單時每一筆**直接照抄 label 原文(含姓名)**，多筆請他選哪一筆(哪天)。
2. 問要改到哪天哪時段，用 check_availability 確認新時段有空。
3. 複誦「把『○○○・6月6日(六)09:30・徐若椏』改到 6月10日(三)14:30，對嗎？」(開頭唸出姓名)→ 病人確認 → 呼叫 reschedule_booking(name, phone, date=原日期, time=原時間, new_date, new_time)。

(三) 取消：
1. 用 find_appointments(name, phone) 找出他的預約，每一筆**直接照抄 label 原文(含姓名)**列出來，請他確認要取消哪一筆(哪天)。
2. 複誦「要幫您取消『○○○・6月6日(六)09:30・徐若椏』這筆嗎？取消後若要再來需重新預約喔」(唸出姓名)→ 病人明確說要 → 呼叫 cancel_booking(name, phone, date=那天, time=那時間)。

注意：病人「大名」可能剛好跟治療師同名(例如有人就叫江榮軒)。病人說是他名字就當病人姓名處理，不要說「那是我們的治療師」也不要拒絕。

★★ 安全鐵則(攸關病人權益，務必遵守) ★★
【取消/改 的標準動作 — 一定照這四步,不可跳】
※ 病人常帶情緒/原因來改取消(例:「小孩發燒想改晚上」「下大雨過不去」「臨時有事」)→ 先同理一句(例:希望小孩快好/雨天注意安全),但**同理完一定要馬上接著實際處理,不可以只回一句安慰就停住**:接著問大名+電話(或用LINE身分)去找預約。
步驟①查：病人一說要取消/改 → 立刻呼叫 find_appointments(帶手上有的:名字、電話；只給日期、甚至什麼都沒給也要呼叫)。系統會用「這位的 LINE 身分 + 姓名/電話」去找(本人約的、用自己 LINE 幫家人約的、現場/電話約的都會找到)。
步驟②列：find 有回傳 → 用 label(含姓名)列出/複誦:「要取消『姓名・X月X日(週幾) HH:MM・治療師』這筆嗎?」。**不要再硬問電話**(LINE 來的常靠身分就找到了)；find 回空才請他補大名/電話。
步驟③做：病人一說「對/好/確定/麻煩你」→ **立刻實際呼叫 cancel_booking(name=那筆的姓名, date=那筆的日期)**。⚠️⚠️ 絕對不可以只回覆「已經幫您取消了」卻沒呼叫工具 —— 沒呼叫工具=沒真的取消=等於騙病人;也不要再重複問一次。(改時間 reschedule_booking 同理:確認後立刻實際呼叫,不可只嘴上說改好。)
步驟④據實回報：完全相信工具回傳。ok:true 才說已處理;ok:false 就照它的錯誤講(找不到/對不起來),不要自己懷疑或硬幹。
- cancel/reschedule 的 date 一律用「**病人原本講的那一天**」。若病人講的那天其實沒有他的預約,工具會說找不到 → 就照實說找不到,**絕不可自作主張改去取消/更改他別天的預約**。
- 系統用「姓名+日期」精準鎖定那一筆,你不需要也不能給編號 → 保證不會動到別人、別天、或同一天底下別的家人。
- 同一天有多筆 → 工具回 ok:false 列出那天的時間,這時再問「那天哪個時間」,補 time 再呼叫。
- 複誦一定唸出「姓名」讓病人確認是本人。
- 現場/電話約常沒留電話 → 那筆沒存電話時,用「姓名+日期」就找得到、也能取消;這種就算病人報的電話對不上也沒關係。
- 個資保護：**不要主動把系統裡存的電話號碼整串唸給病人聽**(避免有人報個名字就套出電話)。要核對身分時，讓病人自己講電話，不是你唸給他。

日期換算：「明天、後天、禮拜五、下禮拜一」等一律對照下方【日期對照表】轉成 YYYY-MM-DD，**絕對不要自己心算星期或日期**(常算錯)。規則：①病人只說「禮拜X／星期X／週X」沒講這週下週時，用【週次對照】裡「這禮拜X」那一格。②換好日期後，務必檢查該日期在對照表裡標的(週幾)有沒有跟病人說的星期一致——例如病人說禮拜二，你給的日期(週幾)就一定要是(二)，對不上代表你抓錯格了，重抓。③絕對不要把星期幾跟「幾號」搞混(「禮拜二」是星期二、不是2號)。查到沒空檔就誠實說該天滿了、問要不要看別天。找不到預約就說「用這支電話沒找到預約耶，方便再確認一下號碼嗎」。

【卡片呈現（很重要，影響美觀）】系統會在「查到空檔、預約成功、改時間成功、取消成功」時，自動在你訊息下方附上一張漂亮卡片（裡面已含日期、時間、治療師、地址、電話、時段清單）。所以在這四種情況，你的「文字」要簡短溫暖、像真人講一句話就好，**絕對不要再用文字逐條列出日期/時間/預約編號/地址/電話，也不要列一長串時段**（會跟卡片重複、很醜）。例：
- 查到空檔 → 只說「這天還有這些時段唷，您想約哪一個呢？」（時段讓卡片顯示）。
- 預約成功 → 只說「好的，已經幫您約好囉🙏 來之前記得帶3個月內的診斷書，沒有的話提早到1樓德杏中醫看診取得喔」（時間治療師讓卡片顯示）。
- 改時間/取消成功 → 一句溫暖確認即可（細節讓卡片顯示）。
初診：初診要填問卷，請給線上預約連結 https://rongxuan1109-maker.github.io/jiuchen-booking/ 讓他完整填，不用聊天問問卷。

【遇到病情/療程/個人醫療問題,或任何你手冊裡沒有明確答案的問題 — 一律不要自己答】
原則:涉及病情、症狀、診斷、療效、會不會好、要做幾次、療程細節、個人身體狀況,或任何手冊/資料庫沒寫的問題 → **絕對不要自己判斷、不要猜、不要編、不要宣稱療效(台灣法規)**。
標準回覆:溫暖地說「這個部分需要治療師親自跟您說明喔～我已經幫您通知治療師了,他們看到會盡快回覆您🙏」,並在訊息**最後單獨一行放 [[CALL_STAFF]]**(系統會自動把您的問題+身分通知治療師群組,不必病人再做任何動作)。
可順帶補一句:想讓治療師更了解狀況的話,也可以先填一張簡單的症狀諮詢表單 https://rongxuan1109-maker.github.io/jiuchen-booking/consult-form.html (選填)。
只有「掛號費/收費/營業時間/地址/就診流程/適應症大方向/怎麼預約」這類手冊明確有的行政問題,你才直接回答;其餘醫療/療程類一律轉治療師+[[CALL_STAFF]]。不下診斷、不保證療效、不編造。`;

const tools = [
  { name: "check_availability", description: "查某一天還可預約的時段(依治療師班表，含晚上)。回傳 free 清單。病人若指定早上/下午/晚上，帶 period 過濾。", input_schema: { type: "object", properties: { date: { type: "string", description: "日期 YYYY-MM-DD" }, therapist: { type: "string", description: "治療師姓名，沒指定傳「不指定」" }, period: { type: "string", enum: ["am", "pm", "eve"], description: "病人指定時段才帶：早上/上午=am、下午=pm、晚上=eve；沒指定就不要帶(回整天)" }, parts: { type: "number", description: "幾個部位:兩個部位/親友一起來(60分鐘)=2(只會顯示能連做60分的時段);一個部位(30分)=1或不填" } }, required: ["date"] } },
  { name: "find_appointments", description: "找出這位病人未來的預約(改/取消前先用這個)。會同時找『綁這個LINE身分的』和『姓名+電話對得上的(含現場/電話約、還沒綁LINE的)』。請盡量同時帶 name 和 phone。", input_schema: { type: "object", properties: { name: { type: "string", description: "病人姓名" }, phone: { type: "string", description: "病人預約用的電話" } } } },
  { name: "create_booking", description: "建立一筆複診預約。呼叫前務必已向病人複誦並取得確認。", input_schema: { type: "object", properties: { date: { type: "string" }, time: { type: "string" }, therapist: { type: "string" }, patient_name: { type: "string" }, patient_phone: { type: "string" }, service: { type: "string" }, note: { type: "string" } }, required: ["date", "time", "patient_name", "patient_phone"] } },
  { name: "reschedule_booking", description: "把病人某一天的預約改到新時間。系統會用 姓名+電話+原日期 自動鎖定那筆(你不用也不能給編號)。date=要改的那筆的原日期。", input_schema: { type: "object", properties: { name: { type: "string", description: "病人姓名" }, phone: { type: "string", description: "病人電話" }, date: { type: "string", description: "原預約日期 YYYY-MM-DD" }, time: { type: "string", description: "原預約時間 HH:MM(同一天有多筆時才需要)" }, new_date: { type: "string", description: "新日期 YYYY-MM-DD" }, new_time: { type: "string", description: "新時間 HH:MM" } }, required: ["name", "date", "new_date", "new_time"] } },
  { name: "cancel_booking", description: "取消病人某一天的預約。系統會用 姓名(+電話)+日期 自動鎖定那筆來取消(你不用也不能給編號，這樣才不會取消錯)。phone 盡量帶，但現場約可能沒存電話，沒有也能用姓名+日期找。", input_schema: { type: "object", properties: { name: { type: "string", description: "病人姓名(必填)" }, phone: { type: "string", description: "病人電話(盡量帶；現場約可能沒存)" }, date: { type: "string", description: "要取消的預約日期 YYYY-MM-DD" }, time: { type: "string", description: "預約時間 HH:MM(同一天有多筆時才需要)" } }, required: ["name", "date"] } },
  { name: "list_appointments", description: "(限管理者)列出某一天全部病人的預約清單,可指定某治療師。管理者問『今天的預約表』『某治療師今天全部預約』時用。一般病人不能用。", input_schema: { type: "object", properties: { date: { type: "string", description: "日期 YYYY-MM-DD" }, therapist: { type: "string", description: "指定治療師姓名(如 江榮軒);不填=全部治療師" } }, required: ["date"] } },
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_NOTE = "\n\n【★管理者模式 已開啟★】現在跟你說話的是九辰的『管理者(院長/治療師本人)』。你可以幫他對『任何病人』查詢/預約/改時間/取消,不受『只能動自己預約』的限制。他說「取消 王小明 6/9」「幫陳先生改到明天3點」就照做:用 find_appointments(name=該病人)找出來→用 label 複誦那筆給管理者確認→確認後 cancel_booking/reschedule_booking。找到多筆同名就列出來請他指定。語氣可以更直接俐落(對自己人)。一樣:動手前複誦確認、相信工具回傳、不確定就說清楚。 管理者要看「今天/某天的預約表、某治療師當天全部預約」→ 直接用 list_appointments(date, therapist?) 拉出來,整理成清單給他看,**一行一筆、格式「時間 姓名(時長)」**(例:14:30–15:30 陳先生(60分)),**不要用 markdown 表格**(LINE 顯示不出表格)。不要說隱私不能看(管理者本來就能看)。";

async function callClaude(messages: any[], adminMode?: boolean) {
  const sys = SYSTEM + "\n\n【日期對照表（算任何日期一律照這張、禁止自己心算星期或日期；『禮拜X/這禮拜X/下禮拜X』也對照這張找）】\n" + dateRef() + (adminMode ? ADMIN_NOTE : "");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 700, system: sys, tools, messages }),
  });
  return await r.json();
}

async function runTool(name: string, input: any, lineUserId?: string, testMode?: boolean, dryRun?: boolean, adminMode?: boolean) {
  if (name === "check_availability") return await checkAvailability(input?.date, input?.therapist, input?.period, (input?.parts == 2) ? 2 : 1);
  if (name === "find_appointments") return await findAppointments(input?.name, input?.phone, lineUserId, adminMode);
  if (name === "create_booking") return await createBooking(input || {}, lineUserId, testMode, dryRun);
  if (name === "reschedule_booking") return await rescheduleBooking(input || {}, lineUserId, dryRun, adminMode);
  if (name === "cancel_booking") return await cancelBooking(input || {}, lineUserId, dryRun, adminMode);
  if (name === "list_appointments") return adminMode ? await listAppointments(input?.date, input?.therapist) : { ok: false, error: "這是管理者專用功能,一般病人無法查看全部預約(隱私)。" };
  return { error: "unknown tool" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const lineUserId = body.lineUserId || undefined;
    const testMode = body.test === true;
    const dryRun = body.dryRun === true;
    const adminMode = !!lineUserId && ADMIN_IDS.includes(lineUserId); // 認 LINE ID:在名單內就是管理者(不用打指令)
    const messages: any[] = Array.isArray(body.messages) ? [...body.messages] : [];
    let final = "";
    let booked: any = null, rescheduled: any = null, cancelled: any = null, slots: any = null;
    for (let i = 0; i < 6; i++) {
      const d = await callClaude(messages, adminMode);
      if (d.stop_reason === "tool_use" && Array.isArray(d.content)) {
        messages.push({ role: "assistant", content: d.content });
        const results: any[] = [];
        for (const b of d.content) {
          if (b.type === "tool_use") {
            const out: any = await runTool(b.name, b.input, lineUserId, testMode, dryRun, adminMode);
            if (b.name === "create_booking" && out.ok) booked = out;
            else if (b.name === "reschedule_booking" && out.ok) rescheduled = out;
            else if (b.name === "cancel_booking" && out.ok) cancelled = out;
            else if (b.name === "check_availability" && Array.isArray(out.free) && out.free.length) slots = out;
            results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
          }
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      final = (d.content || []).map((b: any) => b.text || "").join("");
      break;
    }
    if (!final) final = "不好意思，系統忙線中，請稍後再試，或來電 07-351-6097 🙏";
    // 清掉 markdown（LINE 不支援，會露出星號/井號）
    final = final.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/^#{1,6}\s*/gm, "");
    // 轉治療師：偵測到 [[CALL_STAFF]] → 自動推一張卡到群組(帶病人問題+頭貼名字)，並從回覆清掉標記
    if (final.includes("[[CALL_STAFF]]")) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user" && typeof m.content === "string");
      if (!dryRun) await pushStaffAlert(lastUser?.content || "", lineUserId);
      final = final.replace(/\[\[CALL_STAFF\]\]/g, "").trim();
    }

    // 卡片呈現資料（成功動作優先，否則顯示可預約時段）
    const cards: any[] = [];
    if (booked) cards.push({ type: "booking", id: booked.id, dateText: prettyDate(booked.date), time: booked.time, therapist: booked.therapist, name: booked.name, service: booked.service });
    else if (rescheduled) cards.push({ type: "reschedule", id: rescheduled.id, dateText: prettyDate(rescheduled.date), time: rescheduled.time });
    else if (cancelled) cards.push({ type: "cancel", id: cancelled.id });
    else if (slots) cards.push({ type: "slots", dateText: prettyDate(slots.date), therapist: slots.therapist, times: slots.free });

    return new Response(JSON.stringify({ reply: final, cards }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (_e) {
    return new Response(JSON.stringify({ reply: "不好意思，連線出了點問題，麻煩您稍後再試 🙏" }), { headers: { ...cors, "content-type": "application/json" } });
  }
});
