const qs = new URLSearchParams(location.search);
const mode = qs.get("mode") || "judge";
const pinFromUrl = qs.get("pin") || "";
const serverFromUrl = qs.get("server") || "";

const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const serverUrlEl = document.getElementById("serverUrl");
const pinEl = document.getElementById("pin");
const connectBtn = document.getElementById("connectBtn");
const statusEl = document.getElementById("status");

const judgeArea = document.getElementById("judgeArea");
const hostArea = document.getElementById("hostArea");

const bibEl = document.getElementById("bib");
const actionEl = document.getElementById("action");
const sendBtn = document.getElementById("sendBtn");

const newJudgePinEl = document.getElementById("newJudgePin");
const saveJudgePinBtn = document.getElementById("saveJudgePinBtn");
const resetBtn = document.getElementById("resetBtn");

const summaryEl = document.getElementById("summary");
const listEl = document.getElementById("list");

let ws = null;
let loggedIn = false;

if (pinFromUrl) pinEl.value = pinFromUrl;
if (serverFromUrl) serverUrlEl.value = serverFromUrl;

initMode();

connectBtn.addEventListener("click", connectServer);
sendBtn.addEventListener("click", sendRecord);
saveJudgePinBtn.addEventListener("click", saveJudgePin);
resetBtn.addEventListener("click", resetRecords);

function initMode() {
  titleEl.textContent = `競歩システム [${mode}]`;
  subtitleEl.textContent = `URLの最後に ?mode=${mode} が付いています`;

  if (mode === "judge" || mode === "chief") {
    judgeArea.classList.remove("hidden");
  }

  if (mode === "host") {
    hostArea.classList.remove("hidden");
  }
}

function connectServer() {
  const raw = serverUrlEl.value.trim();
  const pin = pinEl.value.trim();

  if (!raw) {
    alert("サーバURLを入力してください");
    return;
  }

  if (!pin) {
    alert("PINを入力してください");
    return;
  }

  const wsUrl = toWsUrl(raw);

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    statusEl.textContent = "接続失敗";
    alert("サーバURLが正しくありません");
    return;
  }

  statusEl.textContent = "接続中...";

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "login",
      mode,
      pin
    }));
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error("JSON parse error:", e);
      return;
    }

    if (msg.type === "login_ok") {
      loggedIn = true;
      statusEl.textContent = "接続成功";
      renderAll(msg.records || []);
      return;
    }

    if (msg.type === "update") {
      renderAll(msg.records || []);
      return;
    }

    if (msg.type === "saved_pin") {
      alert("審判PINを保存しました");
      return;
    }

    if (msg.type === "reset_done") {
      alert("記録を全消去しました");
      renderAll([]);
      return;
    }

    if (msg.type === "error") {
      alert(msg.message || "エラー");
      statusEl.textContent = "未接続";
      loggedIn = false;
      return;
    }
  };

  ws.onclose = () => {
    statusEl.textContent = "切断";
    loggedIn = false;
  };

  ws.onerror = () => {
    statusEl.textContent = "接続失敗";
    loggedIn = false;
  };
}

function sendRecord() {
  if (!loggedIn || !ws || ws.readyState !== WebSocket.OPEN) {
    alert("先に接続してください");
    return;
  }

  const bib = bibEl.value.trim();
  const action = actionEl.value;

  if (!bib) {
    alert("ナンバーを入力してください");
    return;
  }

  ws.send(JSON.stringify({
    type: "record",
    bib,
    action
  }));

  bibEl.value = "";
  bibEl.focus();
}

function saveJudgePin() {
  if (!loggedIn || !ws || ws.readyState !== WebSocket.OPEN) {
    alert("先に接続してください");
    return;
  }

  const newPin = newJudgePinEl.value.trim();

  if (!newPin) {
    alert("新しいPINを入力してください");
    return;
  }

  ws.send(JSON.stringify({
    type: "set_pin",
    target: "judge",
    pin: newPin
  }));
}

function resetRecords() {
  if (!loggedIn || !ws || ws.readyState !== WebSocket.OPEN) {
    alert("先に接続してください");
    return;
  }

  if (!confirm("記録を全消去しますか？")) return;

  ws.send(JSON.stringify({
    type: "reset_records"
  }));
}

function renderAll(records) {
  renderSummary(records);
  renderList(records);
}

function renderSummary(records) {
  const warningCount = records.filter(r => r.action === "warning").length;
  const redCount = records.filter(r => r.action === "red").length;
  summaryEl.textContent = `全 ${records.length} 件 / 警告 ${warningCount} 件 / 赤カード ${redCount} 件`;
}

function renderList(records) {
  listEl.innerHTML = "";

  if (records.length === 0) {
    listEl.textContent = "まだ記録はありません";
    return;
  }

  const reversed = [...records].reverse();

  reversed.forEach((r) => {
    const row = document.createElement("div");
    row.className = "row";

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = r.time || "";

    const main = document.createElement("div");
    main.className = "main " + (r.action || "");
    main.textContent = `No.${r.bib} / ${labelAction(r.action)} / ${r.mode || ""}`;

    row.appendChild(time);
    row.appendChild(main);
    listEl.appendChild(row);
  });
}

function labelAction(action) {
  if (action === "warning") return "警告";
  if (action === "red") return "赤カード";
  return action || "";
}

function toWsUrl(raw) {
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) return raw;
  if (raw.startsWith("https://")) return raw.replace("https://", "wss://");
  if (raw.startsWith("http://")) return raw.replace("http://", "ws://");
  return "ws://" + raw;
}
