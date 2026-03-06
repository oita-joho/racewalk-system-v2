// public/app.js (FULL REPLACE)

// ===== util =====
const $ = (sel) => document.querySelector(sel);
const app = $("#app");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

// ===== CSV parse (simple but handles quotes) =====
function parseCsv(text){
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length){
    const ch = text[i];

    if (inQuotes){
      if (ch === '"'){
        // "" -> "
        if (text[i+1] === '"'){ cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }

    if (ch === '"'){ inQuotes = true; i++; continue; }

    if (ch === ","){
      row.push(cell); cell = ""; i++; continue;
    }

    if (ch === "\r"){
      // CRLF
      if (text[i+1] === "\n") i++;
      row.push(cell); rows.push(row);
      row = []; cell = ""; i++; continue;
    }

    if (ch === "\n"){
      row.push(cell); rows.push(row);
      row = []; cell = ""; i++; continue;
    }

    cell += ch; i++;
  }

  // last
  if (cell.length || row.length){
    row.push(cell); rows.push(row);
  }

  // trim
  return rows.map(r => r.map(c => String(c ?? "").trim()));
}

function csvRowsToRoster(rows){
  // 空行除去
  const cleaned = rows.filter(r => r.some(c => String(c||"").trim() !== ""));
  if (!cleaned.length) return [];

  // 1行目がヘッダっぽいなら捨てる
  const h0 = (cleaned[0][0]||"").toLowerCase();
  if (h0 === "lane" || h0 === "レーン" || h0.includes("lane")){
    cleaned.shift();
  }

  const out = [];
  for (const r of cleaned){
    const lane = String(r[0] ?? "").trim();
    const bib  = String(r[1] ?? "").trim();
    const name = String(r[2] ?? "").trim();
    const team = String(r[3] ?? "").trim();

    if (!lane || !name) continue;
    if (!/^\d+$/.test(lane)) continue; // 半角数字のみ

    out.push({ lane, bib, name, team });
  }

  // lane重複は後勝ちで上書き
  const map = {};
  for (const a of out) map[String(a.lane)] = a;
  return Object.values(map).sort((a,b)=>(parseInt(a.lane,10)||0)-(parseInt(b.lane,10)||0));
}


// ===== export / print helpers =====
function csvCell(v){
  const s = String(v ?? "");
  return `"${s.replace(/"/g,'""')}"`;
}
function buildCsv(rows){
  return rows.map(r => r.map(csvCell).join(",")).join("\r\n");
}
function downloadTextFile(filename, text, mime="text/plain;charset=utf-8"){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function typeLabel(t) {
  if (t === "loss") return "ロス";
  if (t === "bent") return "ベント";
  if (t === "dsq1") return "ロス失格";
  if (t === "dsq2") return "ベント失格";
  if (t === "notice") return "告知";
  return t;
}
function levelBadge(lv){
  if (lv === "dsq1") return `<span class="badge-dsq1">ロス失格</span>`;
  if (lv === "dsq2") return `<span class="badge-dsq2">ベント失格</span>`;
  if (lv === "notice") return `<span class="badge-notice">告知</span>`;
  if (lv === "warning") return "警告";
  if (lv === "caution") return "注意";
  return esc(lv);
}

function levelLabel(lv) {
  if (lv === "caution") return "注意";
  if (lv === "warning") return "警告";
  if (lv === "dsq1") return "ロス失格";
  if (lv === "dsq2") return "ベント失格";
  if (lv === "notice") return "告知";
  return lv;
}

function exportCsv(){
  // ★役割で絞り込まれていない「全履歴」を出力
  const list = (itemsAll||[])
    .filter(x => x.status !== "cancelled")
    .sort((a,b)=>(a.tsMs||0)-(b.tsMs||0));

// exportCsv() の中：ここを置き換え
const header = [
  "group","bib","name","team","lane","type","judgeId","time","level","status","id","raceId"
];
const rows = [header];

for (const x of list){
  const a = rosterByLane[String(x.lane)];
  rows.push([
    currentGroup,                 // group
    a?.bib  || "",                // bib
    a?.name || "",                // name
    a?.team || "",                // team
    x.lane || "",                 // lane
    typeLabel(x.type),            // type
    x.judgeId || "",              // judgeId
    x.hhmm || "",                 // time
    levelLabel(x.level),          // level
    x.status || "",               // status
    x.id || "",                   // id
    x.raceId || raceId || "",     // raceId
  ]);
}

  const csv = "\uFEFF" + buildCsv(rows); // ★Excel文字化け対策（UTF-8 BOM）
  const fn = `racewalk_group${currentGroup}_${new Date().toISOString().slice(0,10)}.csv`;
  downloadTextFile(fn, csv, "text/csv;charset=utf-8");
}

function openPrint(){
  // ★役割で絞り込まれていない「全履歴」を印刷
  const list = (itemsAll||[])
    .filter(x => x.status !== "cancelled")
    .sort((a,b)=>(a.tsMs||0)-(b.tsMs||0));

  const rowsHtml = list.map(x=>{
    const a = rosterByLane[String(x.lane)];
    const name = a?.name || "";
    const team = a?.team || "";
    const bib  = a?.bib  || "";
    return `
      <tr>
        <td>${esc(currentGroup)}</td>
        <td class="mono">${esc(x.hhmm||"")}</td>
        <td>${esc(x.lane||"")}</td>
        <td>${esc(name)}</td>
        <td>${esc(team)}</td>
        <td>${esc(bib)}</td>
        <td>${esc(typeLabel(x.type))}</td>
        <td>${esc(levelLabel(x.level))}</td>
        <td class="mono">${esc(x.judgeId||"")}</td>
        <td class="mono">${esc(x.status||"")}</td>
      </tr>
    `;
  }).join("");

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>競歩 記録印刷（グループ${esc(currentGroup)}）</title>
<style>
  body{ font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif; padding:16px; }
  h1{ font-size:18px; margin:0 0 8px; }
  .meta{ margin:0 0 12px; font-size:12px; }
  table{ width:100%; border-collapse: collapse; font-size:12px; }
  th,td{ border:1px solid #999; padding:6px; vertical-align: top; }
  th{ background:#eee; }
  .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  @media print{
    body{ padding:0; }
    h1{ font-size:14px; }
    th{ background:#eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <h1>競歩 記録一覧（グループ${esc(currentGroup)}）</h1>
  <div class="meta">raceId: ${esc(raceId)} / 出力: ${esc(new Date().toLocaleString())}</div>
  <table>
    <thead>
      <tr>
        <th>G</th><th>時刻</th><th>レーン</th><th>氏名</th><th>所属</th><th>番号</th>
        <th>反則</th><th>区分</th><th>審判</th><th>状態</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
<script>window.onload=()=>{ window.print(); };</script>
</body>
</html>`;

  const w = window.open("", "_blank");
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function routePath() {
  const h = location.hash || "#/";
  const idx = h.indexOf("?");
  return (idx >= 0 ? h.slice(0, idx) : h).replace(/^#/, "");
}
function qs() {
  const h = location.hash || "#/";
  const idx = h.indexOf("?");
  const q = idx >= 0 ? h.slice(idx + 1) : "";
  return new URLSearchParams(q);
}
function wsUrl() {
  return "wss://racewalk-system.onrender.com/ws";
}

// ===== state =====
const state = {}; // ★追加：UI用（並び替え等）を入れる
let socket = null;

let role = "judge";     // judge/recorder/chief/board/host/chiefjudge
let judgeId = null;     // J1..J5 / CJ
let chiefPin = "";      // 1234

let raceId = "";
let currentGroup = 1;

let rosterByLane = {};  // lane -> athlete

// ★重要：全履歴(itemsAll)を破壊しない。画面表示用(items)は役割で絞り込み。
let itemsAll = [];      // all infractions list (global truth)
let items = [];         // view list (filtered by role)

let infoLine = "接続中...";

// UI state (do not trigger full render on input)
let uiLane = "";
let hostSelectedGroup = 1;
let hostRosterCache = []; // [{lane,bib,name,team}]
let hostForm = { lane: "", bib: "", name: "", team: "" };

// ===== ws =====
function connect() {
  infoLine = `接続中... ${wsUrl()}`;
  render(); // 初期はOK

  socket = new WebSocket(wsUrl());

  socket.onopen = () => hello();

  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.op === "SNAPSHOT") {
      raceId = msg.raceId || "";
      currentGroup = msg.currentGroup || 1;

      rosterByLane = {};
      for (const a of (msg.roster || [])) rosterByLane[String(a.lane)] = a;

      itemsAll = msg.items || [];
      items = buildViewItems(itemsAll);

      infoLine = `接続OK（raceId=${raceId} / グループ${currentGroup}）`;
      render();
      return;
    }

    if (msg.op === "EVENT") {
      const kind = msg.kind;

      if (kind === "NEW" || kind === "UPDATE") {
        const inf = msg.item;
        const idx = itemsAll.findIndex((x) => x.id === inf.id);
        if (idx >= 0) itemsAll[idx] = inf;
        else itemsAll.unshift(inf);

        items = buildViewItems(itemsAll);
        render();
        return;
      }

      if (kind === "ROSTER") {
        rosterByLane = {};
        for (const a of (msg.roster || [])) rosterByLane[String(a.lane)] = a;
        render();
        return;
      }

      if (kind === "RESET") {
        itemsAll = [];
        items = [];
        raceId = msg.raceId || "";
        currentGroup = msg.currentGroup || currentGroup;
        infoLine = `接続OK（raceId=${raceId} / グループ${currentGroup}）`;
        render();
        return;
      }
    }

    if (msg.op === "REJECT") {
      alert(msg.reason || "拒否されました");
      return;
    }

    if (msg.op === "ROSTER_DATA") {
      hostSelectedGroup = msg.group || hostSelectedGroup;
      hostRosterCache = Array.isArray(msg.roster) ? msg.roster : [];
      render();
      return;
    }

    if (msg.op === "OK") {
      console.log("OK:", msg);
      return;
    }
  };

  socket.onclose = () => {
    infoLine = "切断…再接続します";
    render();
    setTimeout(connect, 1200);
  };

  socket.onerror = () => {};
}

function send(obj) {
  if (!socket || socket.readyState !== 1) return;
  socket.send(JSON.stringify(obj));
}

let rolePin = "";

function hello() {
  send({ op: "HELLO", role, judgeId, pin: rolePin });
}

// ★破壊しないフィルタ：表示用の items を生成する
function buildViewItems(src) {
  let out = Array.isArray(src) ? src.slice() : [];

  if (role === "board") {
    out = out.filter((x) =>
      x.status === "confirmed" &&
      (x.level === "warning" || x.level === "dsq1" || x.level === "dsq2")
    );
  }

  // 記録主任：確定済のみ表示（pendingは記録係で確認）
  if (role === "chief") {
    out = out.filter((x) => x.status === "confirmed");
  }

  // 審判：表示は自分の履歴だけ（ただし itemsAll は保持している）
  if (role === "judge" && judgeId) {
    out = out.filter((x) => x.judgeId === judgeId);
  }

  if (role === "chiefjudge") {
    out = out.filter((x) => x.judgeId === "CJ");
  }

  out.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
  return out;
}

function athleteForLane(lane) {
  return rosterByLane[String(lane)];
}

// ===== 送信済み判定（同一審判のみ） =====
function alreadySentByMe(lane, type, level) {
  // judgeId が無い場合は従来どおり全体で見る（保険）
  const jid = judgeId || null;
  return (itemsAll || []).some(
    (x) =>
      String(x.lane) === String(lane) &&
      (!jid || x.judgeId === jid) &&
      x.type === type &&
      x.level === level &&
      (x.status === "pending" || x.status === "confirmed")
  );
}

// ===== 自分がそのレーンに「警告」を出しているか（同一審判のみロック） =====
function myWarningExistsLane(lane) {
  const jid = judgeId || null;
  return (itemsAll || []).some(
    (x) =>
      String(x.lane) === String(lane) &&
      (!jid || x.judgeId === jid) &&
      x.level === "warning" &&
      (x.status === "pending" || x.status === "confirmed")
  );
}

// 互換で残す（他用途が出た時用）：そのレーンに警告が1つでもあるか（全審判）
function warningExistsLaneAny(lane) {
  return (itemsAll || []).some(
    (x) =>
      String(x.lane) === String(lane) &&
      x.level === "warning" &&
      (x.status === "pending" || x.status === "confirmed")
  );
}

// ===== views =====
function shell(title, bodyHtml) {
  return `
    <header>
      <div class="kv">
        <div class="big">${esc(title)}</div>
        <span class="badge">${esc(role)}${judgeId ? ` / ${esc(judgeId)}` : ""}</span>
        <span class="badge">グループ${esc(currentGroup)}</span>
        <span class="badge mono">${esc(infoLine)}</span>
      </div>

${role === "host" ? `
<div class="nav">
  <a href="#/judge?jid=J1">審判</a>
  <a href="#/chiefjudge">審判主任</a>
  <a href="#/recorder">記録</a>
  <a href="#/chief?pin=1234">記録主任</a>
  <a href="#/board">掲示板</a>
</div>
` : ""}

    </header>
    <main>${bodyHtml}</main>
  `;
}

function rosterDetailsHtml() {
  const list = Object.values(rosterByLane).sort((a, b) => (parseInt(a.lane) || 0) - (parseInt(b.lane) || 0));
  const rows = list.map((a) => `
      <tr>
        <td>${esc(a.lane)}</td>
        <td>${esc(a.bib || "")}</td>
        <td>${esc(a.name || "")}</td>
        <td>${esc(a.team || "")}</td>
      </tr>
  `).join("");

  return `
    <div class="card">
      <details open>
        <summary>競技者一覧（折りたたみ可）</summary>
        <table>
          <thead><tr><th>レーン</th><th>競技者番号</th><th>氏名</th><th>所属</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>
    </div>
  `;
}

function judgeView() {
  const lane = (uiLane || "").trim();
  const athlete = lane ? athleteForLane(lane) : null;

  // ★同一審判がそのレーンに警告を出していたら、そのレーンだけロック
  const laneLocked = !!lane && myWarningExistsLane(lane);

  const lossCautionDisabled = laneLocked || !lane || !athlete
    || alreadySentByMe(lane, "loss", "caution");

  const bentCautionDisabled = laneLocked || !lane || !athlete
    || alreadySentByMe(lane, "bent", "caution");

  const lossWarnDisabled = laneLocked || !lane || !athlete
    || alreadySentByMe(lane, "loss", "warning");

  const bentWarnDisabled = laneLocked || !lane || !athlete
    || alreadySentByMe(lane, "bent", "warning");

  const histRows = (items || [])
    .slice()
    .sort((a, b) => {
      const la = parseInt(a.lane, 10) || 0;
      const lb = parseInt(b.lane, 10) || 0;
      if (la !== lb) return la - lb;
      return (a.tsMs || 0) - (b.tsMs || 0);
    })
    .map((x) => `
      <tr>
        <td class="mono">${esc(hhmmTo12(x.hhmm))}</td>
        <td>${esc(x.lane)}</td>
        <td>${esc(typeLabel(x.type))}</td>
        <td class="lv-${esc(x.level)}">${esc(levelLabel(x.level))}</td>
        <td class="mono">${esc(x.status)}</td>
      </tr>
    `)
    .join("");

  return shell("審判", `
    ${rosterDetailsHtml()}

    <div class="card">
      <div class="notice">
        審判は<strong>レーン</strong>だけ入力。未登録レーンは送信できません。<br>
        注意/警告ともに、同一レーン・同一反則は<strong>同一審判は2回出せません</strong>。<br>
        また、同一審判が同一レーンで<strong>警告を出している場合は注意は出せません</strong>。<br>
        （他の審判は同じ選手にも警告できます）
      </div>
    </div>

    <div class="card">
      <div class="row">
        <input
          id="laneInput"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="3"
          style="width:80px;text-align:center"
          placeholder="例:1"
        />

        <button id="lossCautionBtn" class="judge-btn caution" ${lossCautionDisabled ? "disabled" : ""}>ロス 注意</button>
        <button id="bentCautionBtn" class="judge-btn caution" ${bentCautionDisabled ? "disabled" : ""}>ベント 注意</button>
        <button id="lossWarnBtn" class="judge-btn warning" ${lossWarnDisabled ? "disabled" : ""}>ロス 警告</button>
        <button id="bentWarnBtn" class="judge-btn warning" ${bentWarnDisabled ? "disabled" : ""}>ベント 警告</button>
      </div>
    </div>

    <div class="card" id="athleteCard">
      ${athlete ? `
        <div class="big">${esc(athlete.name)}</div>
        <div>${athlete.bib ? `競技者番号: ${esc(athlete.bib)}` : ""}</div>
        <div>${athlete.team ? esc(athlete.team) : ""}</div>
      ` : `<div>未登録レーン（設定係が名簿を登録してください）</div>`}
    </div>

    <div class="card">
      <div class="big">自分の送信履歴（分まで）</div>
      <table>
        <thead><tr><th>時刻</th><th>レーン</th><th>反則</th><th>区分</th><th>状態</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table>
    </div>
  `);
}

function chiefJudgeView() {
  const lane = (uiLane || "").trim();
  const athlete = lane ? athleteForLane(lane) : null;
  const disabled = !lane || !athlete;

  const histRows = (items || [])
    .slice()
    .sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0))
    .map((x) => `
      <tr>
        <td class="mono">${esc(hhmmTo12(x.hhmm))}</td>
        <td>${esc(x.lane)}</td>
        <td>${esc(typeLabel(x.type))}</td>
        <td>${esc(levelLabel(x.level))}</td>
        <td class="mono">${esc(x.status)}</td>
      </tr>
    `)
    .join("");

  return shell("審判主任", `
    ${rosterDetailsHtml()}

    <div class="card">
      <div class="notice">
        審判主任は<strong>ロス失格 / ベント失格 / 告知</strong>を送信します。<br>
        ※送信後は「記録係」が確定ボタンを押して確定します（主任側も pending → confirmed になります）。
      </div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center;gap:12px;flex-wrap:wrap;">
        <input
          id="laneInput"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          maxlength="3"
          style="width:80px;text-align:center"
          placeholder="例:1"
        />
        <button id="dsq1Btn" class="danger" ${disabled ? "disabled" : ""}>ロス失格</button>
        <button id="dsq2Btn" class="danger" ${disabled ? "disabled" : ""}>ベント失格</button>
        <button id="noticeBtn" ${disabled ? "disabled" : ""}>告知</button>
      </div>
    </div>

    <div class="card" id="athleteCard">
      ${athlete ? `
        <div class="big">${esc(athlete.name)}</div>
        <div>${athlete.bib ? `競技者番号: ${esc(athlete.bib)}` : ""}</div>
        <div>${athlete.team ? esc(athlete.team) : ""}</div>
      ` : `<div>未登録レーン（設定係が名簿を登録してください）</div>`}
    </div>

    <div class="card">
      <div class="big">自分の送信履歴（分まで）</div>
      <table>
        <thead><tr><th>時刻</th><th>レーン</th><th>種別</th><th>区分</th><th>状態</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table>
    </div>
  `);
}

function updateJudgeLiveUI(){
  const p = routePath();
  if (!(p === "/judge" || p === "/chiefjudge" || p === "/")) return;

  const laneInput = $("#laneInput");
  if (!laneInput) return;

  const lane = (uiLane || "").trim().replace(/^L/i, "");
  const athlete = lane ? athleteForLane(lane) : null;

  // 選手カード更新（renderしない）
  const athleteCard = $("#athleteCard");
  if (athleteCard){
    athleteCard.innerHTML = athlete ? `
      <div class="big">${esc(athlete.name)}</div>
      <div>${athlete.bib ? `競技者番号: ${esc(athlete.bib)}` : ""}</div>
      <div>${athlete.team ? esc(athlete.team) : ""}</div>
    ` : `<div>未登録レーン（設定係が名簿を登録してください）</div>`;
  }

  // 審判ボタン disabled 更新（renderしない）
  if (p === "/judge" || p === "/"){
    const lossCautionBtn = $("#lossCautionBtn");
    const lossWarnBtn    = $("#lossWarnBtn");
    const bentCautionBtn = $("#bentCautionBtn");
    const bentWarnBtn    = $("#bentWarnBtn");

    // ★同一審判がそのレーンに警告を出していたら、そのレーンだけロック
    const laneLocked = !!lane && myWarningExistsLane(lane);

    const lossCautionDisabled = laneLocked || !lane || !athlete
      || alreadySentByMe(lane, "loss", "caution");

    const bentCautionDisabled = laneLocked || !lane || !athlete
      || alreadySentByMe(lane, "bent", "caution");

    const lossWarnDisabled = laneLocked || !lane || !athlete
      || alreadySentByMe(lane, "loss", "warning");

    const bentWarnDisabled = laneLocked || !lane || !athlete
      || alreadySentByMe(lane, "bent", "warning");

    if (lossCautionBtn) lossCautionBtn.disabled = !!lossCautionDisabled;
    if (lossWarnBtn)    lossWarnBtn.disabled    = !!lossWarnDisabled;
    if (bentCautionBtn) bentCautionBtn.disabled = !!bentCautionDisabled;
    if (bentWarnBtn)    bentWarnBtn.disabled    = !!bentWarnDisabled;
  }

  // 審判主任ボタン disabled 更新（renderしない）
  if (p === "/chiefjudge"){
    const dsq1Btn = $("#dsq1Btn");
    const dsq2Btn = $("#dsq2Btn");
    const noticeBtn = $("#noticeBtn");
    const disabled = !lane || !athlete;
    if (dsq1Btn) dsq1Btn.disabled = disabled;
    if (dsq2Btn) dsq2Btn.disabled = disabled;
    if (noticeBtn) noticeBtn.disabled = disabled;
  }
}

function recorderView(isChief=false){

  const list = (items||[])
    .filter(x => x.status !== "cancelled")
    .sort((a,b)=>(b.tsMs||0)-(a.tsMs||0));

  // 見出しの▲▼表示（今の並び替え状態が分かる）
  const mode = state.topSortMode || "time"; // "time" or "lane"
  const dir  = state.topSortDir  || "asc";  // "asc" or "desc"
  const arrow = (dir === "asc") ? "▲" : "▼";
  const timeHead = `時刻${mode==="time" ? ` ${arrow}` : ""}`;
  const laneHead = `レーン${mode==="lane" ? ` ${arrow}` : ""}`;

  // ===== 通告（notice）を最上段に分離 =====
  const noticeRows = list
    .filter(x => x.level === "notice")
    .sort((a,b)=>(b.tsMs||0)-(a.tsMs||0))
    .map(x=>{
      const a = rosterByLane[String(x.lane)];
      const who = a ? `（${a.name}）` : "";

      const action = (x.status==="pending")
        ? `<button data-confirm="${esc(x.id)}">確定</button>`
        : `<span class="ok">確定済</span>`;

      return `
        <tr>
          <td class="mono">${esc(hhmmTo12(x.hhmm))}</td>
          <td>${esc(x.lane)} ${esc(who)}</td>
          <td>${esc(typeLabel(x.type))}</td>
          <td class="alert">通告</td>
          <td class="mono">${esc(x.judgeId||"")}</td>
          <td>${action}</td>
        </tr>
      `;
    }).join("");


  // ===== 上段（警告・失格・告知）=====
  const topRows = list
    .filter(x =>
      x.level==="warning" || x.level==="dsq1" || x.level==="dsq2"
    )
    .sort((a, b) => {
      const mul = (dir === "desc") ? -1 : 1;
      const ta = (a.tsMs ?? 0);
      const tb = (b.tsMs ?? 0);
      const la = Number(a.lane) || 0;
      const lb = Number(b.lane) || 0;

      if (mode === "lane") {
        if (la !== lb) return (la - lb) * mul;
        return (ta - tb) * mul;
      } else {
        if (ta !== tb) return (ta - tb) * mul;
        return (la - lb) * mul;
      }
    })
    .map(x=>{
      const a = rosterByLane[String(x.lane)];
      const who = a ? `（${a.name}）` : "";

      // ★修正：dsq1/dsq2 が「失格」になるように
      const label =
        x.level==="warning" ? "警告" :
        (x.level==="dsq1" || x.level==="dsq2") ? "失格" :
        "";

      const action = (x.status==="pending")
        ? `<button data-confirm="${esc(x.id)}">確定</button>`
        : `<span class="ok">確定済</span>`;

      return `
        <tr>
          <td class="mono">${esc(hhmmTo12(x.hhmm))}</td>
          <td>${esc(x.lane)} ${esc(who)}</td>
          <td>${esc(typeLabel(x.type))}</td>
          <td class="alert">${esc(label)}</td>
          <td class="mono">${esc(x.judgeId||"")}</td>
          <td>${action}</td>
        </tr>
      `;
    }).join("");

  // ===== 下段（注意のみ）=====  ※状態欄なし（確定操作は上段で行う）
  const bottomRows = list
    .filter(x => x.level==="caution")
    .map(x=>{
      const a = rosterByLane[String(x.lane)];
      const who = a ? `（${a.name}）` : "";

      return `
        <tr>
          <td class="mono">${esc(hhmmTo12(x.hhmm))}</td>
          <td>${esc(x.lane)} ${esc(who)}</td>
          <td>${esc(typeLabel(x.type))}</td>
          <td class="caution">注意</td>
          <td class="mono">${esc(x.judgeId||"")}</td>
        </tr>
      `;
    }).join("");

  const chiefTools = isChief ? `
    <div class="card">
      <div class="row">
        <button id="resetBtn" class="danger">ログ初期化</button>
      </div>
    </div>
  ` : "";

  return shell(isChief ? "記録主任" : "記録員", `
    <div class="card">
      <div class="big">通告</div>
      <table>
        <thead>
          <tr>
            <th>時刻</th>
            <th>レーン</th>
            <th>内容</th>
            <th>区分</th>
            <th>審判</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>${noticeRows || ""}</tbody>
      </table>
    </div>

    <div class="card">
      <div class="big">重要情報（警告・失格）</div>
      <table>
        <thead>
          <tr>
            <th class="clicksort" data-sort="time">${timeHead}</th>
            <th class="clicksort" data-sort="lane">${laneHead}</th>
            <th>反則</th>
            <th>区分</th>
            <th>審判</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>${topRows || ""}</tbody>
      </table>
    </div>

    ${chiefTools}

    <div class="card">
      <div class="big">注意</div>
      <table>
        <thead>
          <tr>
            <th>時刻</th>
            <th>レーン</th>
            <th>反則</th>
            <th>区分</th>
            <th>審判</th>
          </tr>
        </thead>
        <tbody>${bottomRows || ""}</tbody>
      </table>
    </div>
<div class="card">
    <div class="big">履歴一覧</div>

    <div class="row" style="margin-top:10px">
      <button id="csvBtn">CSV保存</button>
      <button id="printBtn" class="secondary">印刷</button>
    </div>
  </div>
  `);

}


// ===== 上段ヘッダクリックで並び替え（1回だけ登録）=====
state.topSortMode = state.topSortMode || "time";
state.topSortDir  = state.topSortDir  || "asc";

if (!state._topSortClickBound) {
  state._topSortClickBound = true;

  document.addEventListener("click", (e) => {
    const th = e.target.closest("th.clicksort");
    if (!th) return;

    const mode = th.dataset.sort; // "time" or "lane"
    if (!mode) return;

    if (state.topSortMode === mode) {
      state.topSortDir = (state.topSortDir === "asc") ? "desc" : "asc";
    } else {
      state.topSortMode = mode;
      state.topSortDir = "asc";
    }

    render();
  });
}

function boardView() {
  const confirmed = items
    .filter((x) => x.status === "confirmed" && (x.level === "warning" || x.level === "dsq1" || x.level === "dsq2"))
    .sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));

  const cards = confirmed.map((x) => `
      <div class="card">
        <div class="row" style="align-items:center">
          <div class="big">${esc(x.lane)}</div>
          <div class="big">${typeLabel(x.type)} ${levelBadge(x.level)}</div>
          <div style="margin-left:auto" class="big mono">${esc(x.hhmm)}</div>
        </div>
      </div>
  `).join("");

  return shell("掲示板（確定の警告＋失格）", `
    ${cards || `<div class="card">確定データがまだありません</div>`}
  `);
}

function hostView() {
  const map = {};
  for (const a of hostRosterCache) map[String(a.lane)] = a;
  const list = Object.values(map).sort((a, b) => (parseInt(a.lane) || 0) - (parseInt(b.lane) || 0));

  const rows = list.map((a) => `
      <tr>
        <td>${esc(a.lane)}</td>
        <td>${esc(a.bib || "")}</td>
        <td>${esc(a.name || "")}</td>
        <td>${esc(a.team || "")}</td>
        <td>
          <button class="secondary" data-edit="${esc(a.lane)}">編集</button>
          <button class="danger" data-del="${esc(a.lane)}">削除</button>
        </td>
      </tr>
  `).join("");

  return shell("設定係（PC）", `
    <div class="card">
      <div class="notice">
        ここで<strong>グループ1〜5</strong>の名簿を保存できます。<br>
        当日は「このグループで開始」を押すだけで、全端末に名簿反映＋ログ初期化されます。
      </div>
    </div>

    <div class="card">
      <div class="row">
        <select id="groupSelect" style="min-width:200px">
          ${[1,2,3,4,5].map(g => `<option value="${g}" ${g===hostSelectedGroup?"selected":""}>グループ${g}</option>`).join("")}
        </select>
        <button id="loadBtn" class="secondary">読み込み</button>
        <button id="saveBtn">保存</button>
        <button id="applyBtn">このグループで開始（名簿反映＋ログ初期化）</button>
        <button id="clearBtn" class="danger">このグループ名簿を全消去</button>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <input id="hLane" placeholder="レーン" style="width:120px">
        <input id="hBib" placeholder="競技者番号（英数字）" style="min-width:220px;flex:1">
        <input id="hName" placeholder="氏名（必須）" style="min-width:200px;flex:1">
        <input id="hTeam" placeholder="所属（任意）" style="min-width:200px;flex:1">
        <button id="upsertBtn">追加/更新</button>
      </div>
    </div>

    <div class="card">
      <div class="big">編集名簿（${list.length}名）</div>
      <table>
        <thead><tr><th>レーン</th><th>競技者番号</th><th>氏名</th><th>所属</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card">
      <div class="big">CSVから名簿を読み込み</div>
      <div class="notice" style="margin-top:6px">
        形式：lane,bib,name,team（1行目ヘッダ可）／レーンは半角数字のみ。<br>
        Excelで保存する場合は「CSV UTF-8（コンマ区切り）」推奨。
      </div>
      <div class="row" style="margin-top:10px; gap:10px; flex-wrap:wrap">
        <input id="csvFile" type="file" accept=".csv,text/csv" />
        <select id="csvEnc">
          <option value="utf-8" selected>UTF-8</option>
          <option value="shift_jis">Shift-JIS</option>
        </select>
        <button id="csvImportBtn" class="secondary">読み込み（反映）</button>
        <button id="csvImportSaveBtn">読み込み→保存</button>
      </div>
    </div>

  `);
}

// ===== render & bind =====
function render() {
  const p = routePath();

  // 役割が変わった可能性があるので、表示用 items を毎回同期
  items = buildViewItems(itemsAll);

  if (p === "/host") app.innerHTML = hostView();
  else if (p === "/recorder") app.innerHTML = recorderView(false);
  else if (p === "/board") app.innerHTML = boardView();
  else if (p === "/chief") app.innerHTML = recorderView(true);
  else if (p === "/chiefjudge") app.innerHTML = chiefJudgeView();
  else app.innerHTML = judgeView();

  bindEvents();
  updateJudgeLiveUI();
}

function bindEvents() {
  const p = routePath();

  // lane input
  const laneInput = $("#laneInput");
  if (laneInput) {
    laneInput.value = uiLane;
    laneInput.addEventListener("input", () => {
      // 半角数字のみ許可
      const v = laneInput.value.replace(/[^\d]/g, "");
      laneInput.value = v;
      uiLane = v;

      updateJudgeLiveUI();   // ★ここが重要（renderしない）
    });
  }

  // judge buttons
  const lossCautionBtn = $("#lossCautionBtn");
  if (lossCautionBtn) {
    lossCautionBtn.addEventListener("click", () => {
      const lane = (uiLane || "").trim();
      send({ op: "NEW_CAUTION", lane, type: "loss", judgeId });
      uiLane = "";
      render();
      setTimeout(() => {
        const inp = $("#laneInput");
        if (inp) inp.focus();
        updateJudgeLiveUI();
      }, 0);
    });
  }

  const lossWarnBtn = $("#lossWarnBtn");
  if (lossWarnBtn) {
    lossWarnBtn.addEventListener("click", () => {
      const lane = (uiLane || "").trim();
      send({ op: "NEW_WARNING", lane, type: "loss", judgeId });
      uiLane = "";
      render();
      setTimeout(() => {
        const inp = $("#laneInput");
        if (inp) inp.focus();
        updateJudgeLiveUI();
      }, 0);
    });
  }

  const bentCautionBtn = $("#bentCautionBtn");
  if (bentCautionBtn) {
    bentCautionBtn.addEventListener("click", () => {
      const lane = (uiLane || "").trim();
      send({ op: "NEW_CAUTION", lane, type: "bent", judgeId });
      uiLane = "";
      render();
      setTimeout(() => {
        const inp = $("#laneInput");
        if (inp) inp.focus();
        updateJudgeLiveUI();
      }, 0);
    });
  }

  const bentWarnBtn = $("#bentWarnBtn");
  if (bentWarnBtn) {
    bentWarnBtn.addEventListener("click", () => {
      const lane = (uiLane || "").trim();
      send({ op: "NEW_WARNING", lane, type: "bent", judgeId });
      uiLane = "";
      render();
      setTimeout(() => {
        const inp = $("#laneInput");
        if (inp) inp.focus();
        updateJudgeLiveUI();
      }, 0);
    });
  }

  // ===== chiefjudge buttons =====
  const dsq1Btn = $("#dsq1Btn");
  if (dsq1Btn) {
    dsq1Btn.addEventListener("click", () => {
      const lane = (uiLane || "").trim();
      send({ op: "NEW_CHIEF", lane, type: "dsq1" });
      uiLane = "";
      render();
    });
  }

  const dsq2Btn = $("#dsq2Btn");
  if (dsq2Btn) {
    dsq2Btn.addEventListener("click", () => {
      const lane = (uiLane || "").trim();
      send({ op: "NEW_CHIEF", lane, type: "dsq2" });
      uiLane = "";
      render();
    });
  }

  const noticeBtn = $("#noticeBtn");
  if (noticeBtn) {
    noticeBtn.addEventListener("click", () => {
      const lane = (uiLane || "").trim();
      send({ op: "NEW_CHIEF", lane, type: "notice" });
      uiLane = "";
      render();
    });
  }

  // recorder confirm
  document.querySelectorAll("[data-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-confirm");
      send({ op: "CONFIRM", id });
    });
  });

  // CSV / Print
  const csvBtn = $("#csvBtn");
  if (csvBtn) csvBtn.addEventListener("click", () => exportCsv());
  const printBtn = $("#printBtn");
  if (printBtn) printBtn.addEventListener("click", () => openPrint());

  // chief reset
  const resetBtn = $("#resetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!confirm("ログのみ初期化します（名簿は残ります）。よろしいですか？")) return;
      send({ op: "RESET", pin: chiefPin || "1234" });
    });
  }

  // host
  if (p === "/host") {
    const groupSelect = $("#groupSelect");
    const loadBtn = $("#loadBtn");
    const saveBtn = $("#saveBtn");
    const applyBtn = $("#applyBtn");
    const clearBtn = $("#clearBtn");

    const hLane = $("#hLane");
    const hBib = $("#hBib");
    const hName = $("#hName");
    const hTeam = $("#hTeam");
    const upsertBtn = $("#upsertBtn");

    const csvFile = $("#csvFile");
    const csvEnc = $("#csvEnc");
    const csvImportBtn = $("#csvImportBtn");
    const csvImportSaveBtn = $("#csvImportSaveBtn");

    async function readCsvFileAsText(file, enc="utf-8"){
      const buf = await file.arrayBuffer();
      // BOM付きUTF-8もOK
      try {
        return new TextDecoder(enc).decode(buf);
      } catch {
        // だめならUTF-8で読む
        return new TextDecoder("utf-8").decode(buf);
      }
    }

    async function importCsv(doSave=false){
      if (!csvFile || !csvFile.files || !csvFile.files[0]){
        alert("CSVファイルを選択してください");
        return;
      }
      const file = csvFile.files[0];
      const enc = (csvEnc && csvEnc.value) ? csvEnc.value : "utf-8";

      const text = await readCsvFileAsText(file, enc);
      const rows = parseCsv(text);
      const roster = csvRowsToRoster(rows);

      if (!roster.length){
        alert("有効な行がありませんでした（lane,name 必須 / レーンは半角数字）");
        return;
      }

      hostRosterCache = roster;
      alert(`CSVを読み込みました：${roster.length}名（グループ${hostSelectedGroup}に反映しました）`);
      render();

      if (doSave){
        send({ op: "SAVE_ROSTER", group: hostSelectedGroup, roster: hostRosterCache });
        alert(`グループ${hostSelectedGroup} を保存しました`);
      }
    }

    if (csvImportBtn){
      csvImportBtn.addEventListener("click", () => importCsv(false));
    }
    if (csvImportSaveBtn){
      csvImportSaveBtn.addEventListener("click", () => importCsv(true));
    }

    if (groupSelect) groupSelect.value = String(hostSelectedGroup);

    if (hLane) hLane.value = hostForm.lane;
    if (hBib) hBib.value = hostForm.bib;
    if (hName) hName.value = hostForm.name;
    if (hTeam) hTeam.value = hostForm.team;

    if (groupSelect) {
      groupSelect.addEventListener("change", () => {
        hostSelectedGroup = parseInt(groupSelect.value, 10) || 1;
      });
    }

    if (hLane) {
      hLane.addEventListener("input", () => {
        const v = hLane.value.replace(/[^\d]/g, "");
        hLane.value = v;
        hostForm.lane = v;
      });
    }
    if (hBib) hBib.addEventListener("input", () => (hostForm.bib = hBib.value));
    if (hName) hName.addEventListener("input", () => (hostForm.name = hName.value));
    if (hTeam) hTeam.addEventListener("input", () => (hostForm.team = hTeam.value));

    if (loadBtn) loadBtn.addEventListener("click", () => send({ op: "LOAD_ROSTER", group: hostSelectedGroup }));

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const roster = hostRosterCache.map((a) => ({
          lane: String(a.lane || "").trim(),
          bib: String(a.bib || ""),
          name: String(a.name || "").trim(),
          team: String(a.team || ""),
        }));
        send({ op: "SAVE_ROSTER", group: hostSelectedGroup, roster });
        alert(`グループ${hostSelectedGroup} を保存しました`);
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        if (!confirm(`グループ${hostSelectedGroup} を開始します（名簿反映＋ログ初期化）。よろしいですか？`)) return;
        send({ op: "APPLY_GROUP", group: hostSelectedGroup });
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (!confirm(`グループ${hostSelectedGroup} の名簿を全消去します。よろしいですか？`)) return;
        hostRosterCache = [];
        send({ op: "CLEAR_ROSTER", group: hostSelectedGroup });
        render();
      });
    }

    if (upsertBtn) {
      upsertBtn.addEventListener("click", () => {
        const lane = String(hostForm.lane || "").trim();
        const name = String(hostForm.name || "").trim();
        if (!lane || !name) return alert("レーンと氏名は必須です");

        const obj = {
          lane,
          bib: String(hostForm.bib || ""),
          name,
          team: String(hostForm.team || ""),
        };

        const idx = hostRosterCache.findIndex((x) => String(x.lane) === lane);
        if (idx >= 0) hostRosterCache[idx] = obj;
        else hostRosterCache.push(obj);

        hostForm = { lane: "", bib: "", name: "", team: "" };
        render();
      });
    }

    document.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lane = btn.getAttribute("data-edit");
        const a = hostRosterCache.find((x) => String(x.lane) === String(lane));
        if (!a) return;
        hostForm = {
          lane: String(a.lane || ""),
          bib: String(a.bib || ""),
          name: String(a.name || ""),
          team: String(a.team || ""),
        };
        render();
      });
    });

    document.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lane = btn.getAttribute("data-del");
        hostRosterCache = hostRosterCache.filter((x) => String(x.lane) !== String(lane));
        render();
      });
    });
  }
}

function hhmmTo12(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(hhmm || "");
  let h = Number(m[1]);
  const min = m[2];
  const ampm = (h >= 12) ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

// ===== routing =====
function applyRoute() {
  const p = routePath();
  const q = qs();
  rolePin = q.get("pin") || "";
　　console.log("rolePin=", rolePin, "role=", role, "judgeId=", judgeId);
  if (p === "/host") {
    role = "host";
    judgeId = null;
    chiefPin = "";
    hello();
    send({ op: "LOAD_ROSTER", group: hostSelectedGroup });
    render();
    return;
  }

  if (p === "/recorder") {
    role = "recorder";
    judgeId = null;
    chiefPin = "";
    hello();
    render();
    return;
  }

  if (p === "/board") {
    role = "board";
    judgeId = null;
    chiefPin = "";
    hello();
    render();
    return;
  }

  if (p === "/chief") {
    role = "chief";
    judgeId = null;
    chiefPin = q.get("pin") || "1234";
    hello();
    render();
    return;
  }

  if (p === "/chiefjudge") {
    role = "chiefjudge";
    judgeId = "CJ"; // ここが重要：サーバ側フィルタと一致させる
    chiefPin = "";
    hello();
    render();
    return;
  }

  role = "judge";
  judgeId = q.get("jid") || null;
  chiefPin = "";

  if (!judgeId) {
    alert("審判URLに jid=J1 のようなIDが必要です。例: #/judge?jid=J1");
    judgeId = "J1";
  }
  hello();
  render();
}

window.addEventListener("hashchange", () => applyRoute());

// init
connect();
applyRoute();
render();
