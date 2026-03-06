// server.js  (FULL REPLACE)
// Node: express + ws
// Run: node server.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// =====================================================
// Config / Files
// =====================================================
const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, "data");
const ROSTER_FILE = (g) => path.join(DATA_DIR, `roster_g${g}.json`);
const PINS_FILE = path.join(DATA_DIR, "pins.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// =====================================================
// Utilities
// =====================================================
function safeGroup(g) {
  const n = parseInt(g, 10);
  return [1, 2, 3, 4, 5].includes(n) ? n : 1;
}

function isHalfWidthDigits(s) {
  return /^\d+$/.test(String(s ?? "").trim());
}

function hhmmNow() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function localIPv4Candidates() {
  const ifs = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(ifs)) {
    for (const x of ifs[name] || []) {
      if (x.family === "IPv4" && !x.internal) out.push(x.address);
    }
  }
  return out;
}

// =====================================================
// PIN auth (pins.json)
// =====================================================
function readPins() {
  if (!fs.existsSync(PINS_FILE)) return {};
  try {
    const v = JSON.parse(fs.readFileSync(PINS_FILE, "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function pinOkFor(role, judgeId, pin) {
  const pins = readPins();
  const p = String(pin || "");

  if (role === "judge") {
    if (!judgeId) return false;
    return p && pins[String(judgeId)] === p; // J1..J5
  }
  if (role === "chiefjudge") return p && pins["CJ"] === p;
  if (role === "recorder") return p && pins["REC"] === p;
  if (role === "chief") return p && pins["CHIEF"] === p;
  if (role === "board") return p && pins["BOARD"] === p;
  if (role === "host") return p && pins["HOST"] === p;

  return false;
}

function requiredRole(op) {
  // opごとに許可するroleをサーバ側で固定
  if (op === "LOAD_ROSTER" || op === "SAVE_ROSTER" || op === "CLEAR_ROSTER" || op === "APPLY_GROUP") return ["host"];
  if (op === "CONFIRM") return ["recorder"];          // 記録係だけ
  if (op === "RESET") return ["chief"];               // 記録主任だけ
  if (op === "NEW_CAUTION" || op === "NEW_WARNING") return ["judge"];
  if (op === "NEW_CHIEF") return ["chiefjudge"];
  return null; // HELLO / その他
}

// =====================================================
// Roster IO
// =====================================================
function readRoster(group) {
  const f = ROSTER_FILE(group);
  if (!fs.existsSync(f)) return [];
  try {
    const v = JSON.parse(fs.readFileSync(f, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeRoster(group, roster) {
  const f = ROSTER_FILE(group);
  fs.writeFileSync(f, JSON.stringify(roster, null, 2), "utf8");
}

// =====================================================
// Runtime State (1大会/1PC)
//
// ★重要ルール（修正版）
// 1) 同一審判は「同一競技者×同一反則×同一区分」を2回出せない
//    → key に judgeId を含める
// 2) 審判員は「警告を出した選手」にはその後 注意/警告を出せない
//    ただし他の選手には出せる
//    → judgeLaneWarnLock（raceId|judgeId|lane）
// =====================================================
const state = {
  raceId: String(Date.now()),
  seq: 1,
  currentGroup: 1,

  rosterByLane: {},

  // infractions
  byId: {},

  // key = raceId|judgeId|lane|type|level  （pending/confirmed のみ登録）
  activeKeyToId: {},

  // key = raceId|judgeId|lane -> true（そのレーンに警告を出したら、そのレーンは以後ロック。pendingでもロック）
  judgeLaneWarnLock: {},

  clients: new Set(),
};

function nextId() {
  return `INF-${String(state.seq++).padStart(5, "0")}`;
}

function keyOf(raceId, judgeId, lane, type, level) {
  return `${raceId}|${judgeId}|${lane}|${type}|${level}`;
}

function lockKey(raceId, judgeId, lane) {
  return `${raceId}|${judgeId}|${lane}`;
}

function ensureLaneRegistered(lane) {
  return !!state.rosterByLane[String(lane)];
}

function resetLogKeepRoster() {
  state.raceId = String(Date.now());
  state.seq = 1;
  state.byId = {};
  state.activeKeyToId = {};
  state.judgeLaneWarnLock = {};
}

function applyGroup(group) {
  const g = safeGroup(group);
  state.currentGroup = g;

  const roster = readRoster(g);
  const map = {};
  for (const a of roster) {
    const lane = String(a.lane || "").trim();
    const name = String(a.name || "").trim();
    if (!lane || !name) continue;
    if (!isHalfWidthDigits(lane)) continue;

    map[lane] = {
      lane,
      bib: String(a.bib || ""),
      name,
      team: String(a.team || ""),
    };
  }
  state.rosterByLane = map;

  // グループ切替時はログ初期化
  resetLogKeepRoster();
}

// 初期状態：グループ1を適用
applyGroup(1);

// =====================================================
// WebSocket send helpers
// =====================================================
function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {}
}

function reject(ws, reason) {
  send(ws, { op: "REJECT", reason });
}

function broadcast(obj) {
  const text = JSON.stringify(obj);
  for (const ws of [...state.clients]) {
    try {
      ws.send(text);
    } catch {
      state.clients.delete(ws);
    }
  }
}

function snapshotFor(role, judgeId) {
  let items = Object.values(state.byId);

  if (role === "board") {
    // 掲示板：確定した「警告」と「失格(2種)」だけ（告知・注意は出さない）
    items = items.filter(
      (x) =>
        x.status === "confirmed" &&
        (x.level === "warning" || x.level === "dsq1" || x.level === "dsq2")
    );
  } else if (role === "judge" && judgeId) {
    // 審判：自分の送信だけ
    items = items.filter((x) => x.judgeId === judgeId);
  } else if (role === "chiefjudge") {
    // 審判主任：自分の送信だけ
    items = items.filter((x) => x.judgeId === "CJ");
  } else if (role === "chief") {
    // 記録主任：確定済のみ
    items = items.filter((x) => x.status === "confirmed");
  } else {
    // recorder / host：全部（recorderは pending を確定する必要がある）
  }

  items.sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));

  return {
    op: "SNAPSHOT",
    raceId: state.raceId,
    currentGroup: state.currentGroup,
    roster: Object.values(state.rosterByLane),
    items,
  };
}

// =====================================================
// Server setup (HTTP + WS)
// =====================================================
const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.send("racewalk server running");
});
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws) => {
  state.clients.add(ws);

  let role = "judge";
  let judgeId = null;

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString("utf8"));
    } catch {
      return;
    }

    const op = msg.op;

    // -----------------------------
    // HELLO (PIN認証)
    // -----------------------------
    if (op === "HELLO") {
      const reqRole = String(msg.role || "judge");
      const reqJudgeId = msg.judgeId ? String(msg.judgeId) : null;
      const pin = String(msg.pin || "");

      if (!pinOkFor(reqRole, reqJudgeId, pin)) {
        send(ws, { op: "REJECT", reason: "PINが違うか、この役割の権限がありません" });
        try { ws.close(); } catch {}
        return;
      }

      role = reqRole;
      judgeId = reqJudgeId;

      send(ws, snapshotFor(role, judgeId));
      return;
    }

    // -----------------------------
    // role制限（HELLO以外）
    // -----------------------------
    const allowed = requiredRole(op);
    if (allowed && !allowed.includes(role)) {
      return reject(ws, "この操作は許可されていません（役割が違います）");
    }

    // -----------------------------
    // Host tools (PC設定係)
    // -----------------------------
    if (op === "LOAD_ROSTER") {
      const g = safeGroup(msg.group);
      const roster = readRoster(g);
      send(ws, { op: "ROSTER_DATA", group: g, roster });
      return;
    }

    if (op === "SAVE_ROSTER") {
      const g = safeGroup(msg.group);
      const roster = Array.isArray(msg.roster) ? msg.roster : [];
      const out = [];

      for (const a of roster) {
        const lane = String(a.lane || "").trim();
        const name = String(a.name || "").trim();

        if (!lane || !name) continue;
        if (!isHalfWidthDigits(lane)) continue;

        out.push({
          lane,
          bib: String(a.bib || ""),
          name,
          team: String(a.team || ""),
        });
      }

      writeRoster(g, out);
      send(ws, { op: "OK", kind: "SAVE_ROSTER", group: g });
      return;
    }

    if (op === "CLEAR_ROSTER") {
      const g = safeGroup(msg.group);
      writeRoster(g, []);
      send(ws, { op: "OK", kind: "CLEAR_ROSTER", group: g });
      return;
    }

    if (op === "APPLY_GROUP") {
      const g = safeGroup(msg.group);
      applyGroup(g);

      broadcast({
        op: "EVENT",
        kind: "RESET",
        raceId: state.raceId,
        currentGroup: state.currentGroup,
      });

      broadcast({
        op: "EVENT",
        kind: "ROSTER",
        roster: Object.values(state.rosterByLane),
      });

      broadcast(snapshotFor("recorder", null));

      send(ws, { op: "OK", kind: "APPLY_GROUP", group: g });
      return;
    }

    // -----------------------------
    // Recorder actions
    // -----------------------------
    if (op === "CONFIRM") {
      const id = String(msg.id || "");
      const inf = state.byId[id];
      if (!inf) return;

      inf.status = "confirmed";

      // activeKeyToId / judgeLaneWarnLock は維持（禁止・ロック継続）
      broadcast({ op: "EVENT", kind: "UPDATE", item: inf });
      return;
    }

    // -----------------------------
    // Chief actions（ログ初期化）
    // -----------------------------
    if (op === "RESET") {
      // role=chief しか来ない（上の制限で弾く）
      // PINも必須：CHIEFのPINでないと拒否
      const pin = String(msg.pin || "");
      if (!pinOkFor("chief", null, pin)) return reject(ws, "PINが違います");

      resetLogKeepRoster();
      broadcast({
        op: "EVENT",
        kind: "RESET",
        raceId: state.raceId,
        currentGroup: state.currentGroup,
      });
      broadcast(snapshotFor("recorder", null));
      return;
    }

    // =================================================
    // Judge actions（審判：注意/警告）
    // =================================================
    if (op === "NEW_CAUTION" || op === "NEW_WARNING") {
      // role=judge しか来ない（上の制限で弾く）
      const lane = String(msg.lane || "").trim();
      const type = msg.type === "loss" ? "loss" : "bent";

      // 審判IDは「接続時のjudgeId」を使う（偽装防止）
      const jId = String(judgeId || "").trim();

      if (!lane) return reject(ws, "レーンが空です");
      if (!isHalfWidthDigits(lane)) return reject(ws, "レーンは半角数字のみです");
      if (!ensureLaneRegistered(lane)) return reject(ws, "そのレーンは未登録です（設定係に確認）");
      if (!jId) return reject(ws, "審判IDが不明です");

      // ルール2（修正）：同一審判が「そのレーン」に警告を出していたら、そのレーンには以後 注意/警告を出せない
      const lk = lockKey(state.raceId, jId, lane);
      if (state.judgeLaneWarnLock[lk]) {
        return reject(ws, "この審判はこの競技者に既に警告を出しているため、以後は注意・警告を出せません");
      }

      const level = op === "NEW_CAUTION" ? "caution" : "warning";

      // ルール1：同一審判は同一(lane/type/level)を2回出せない
      // pending/confirmed が1つでもあれば不可
      const kThis = keyOf(state.raceId, jId, lane, type, level);
      if (state.activeKeyToId[kThis]) {
        return reject(ws, "同一審判は同一競技者に同じ注意・警告を2回出せません");
      }

      // 注意は即確定（記録が確定を押さない運用でも、主任に注意が出る）
      // 警告は pending（記録係が確定）
      const status = level === "caution" ? "confirmed" : "pending";

      const inf = {
        id: nextId(),
        raceId: state.raceId,
        group: state.currentGroup,
        lane,
        type,     // loss | bent
        level,    // caution | warning
        hhmm: hhmmNow(),
        tsMs: Date.now(),
        judgeId: jId,
        status,
      };

      state.byId[inf.id] = inf;
      state.activeKeyToId[kThis] = inf.id;

      // 警告は pending の時点で「そのレーン」をロック
      if (level === "warning") {
        state.judgeLaneWarnLock[lk] = true;
      }

      broadcast({ op: "EVENT", kind: "NEW", item: inf });
      return;
    }

    // =================================================
    // Chief Judge actions（審判主任：失格(2種)/告知）
    //  - pendingで作成 → 記録が CONFIRM
    // =================================================
    if (op === "NEW_CHIEF") {
      // role=chiefjudge しか来ない
      const lane = String(msg.lane || "").trim();
      const ctype =
        msg.type === "dsq1" ? "dsq1" :
        msg.type === "dsq2" ? "dsq2" : "notice";

      if (!lane) return reject(ws, "レーンが空です");
      if (!isHalfWidthDigits(lane)) return reject(ws, "レーンは半角数字のみです");
      if (!ensureLaneRegistered(lane)) return reject(ws, "そのレーンは未登録です（設定係に確認）");

      const inf = {
        id: nextId(),
        raceId: state.raceId,
        group: state.currentGroup,
        lane,
        type: ctype,   // dsq1 | dsq2 | notice
        level: ctype,  // dsq1 | dsq2 | notice
        hhmm: hhmmNow(),
        tsMs: Date.now(),
        judgeId: "CJ",
        status: "pending",
      };

      state.byId[inf.id] = inf;
      broadcast({ op: "EVENT", kind: "NEW", item: inf });
      return;
    }
  });

  ws.on("close", () => {
    state.clients.delete(ws);
  });
});

// =====================================================
// Listen
// =====================================================
server.listen(PORT, "0.0.0.0", () => {
  const ips = localIPv4Candidates();
  console.log(`Racewalk Web Host running: http://0.0.0.0:${PORT}`);
  if (ips.length) {
    console.log(`Try on phone: http://${ips[0]}:${PORT}/#/judge?jid=J1&pin=____`);
    console.log(`ChiefJudge:   http://${ips[0]}:${PORT}/#/chiefjudge?pin=____`);
    console.log(`Recorder:     http://${ips[0]}:${PORT}/#/recorder?pin=____`);
    console.log(`Chief(Reset): http://${ips[0]}:${PORT}/#/chief?pin=____`);
    console.log(`Board:        http://${ips[0]}:${PORT}/#/board?pin=____`);
    console.log(`Host(PC):     http://${ips[0]}:${PORT}/#/host?pin=____`);
  }
  console.log(`WS: ws://<PC-IP>:${PORT}/ws`);
});
