import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "data.json");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.get("/", (req, res) => {
  res.send("racewalk server running");
});

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function nowText() {
  return new Date().toLocaleString("ja-JP");
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function broadcast(obj) {
  const text = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(text);
    }
  });
}

wss.on("connection", (ws) => {
  ws.userMode = null;
  ws.loggedIn = false;

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      send(ws, { type: "error", message: "JSONエラー" });
      return;
    }

    const data = loadData();

    if (msg.type === "login") {
      const mode = msg.mode;
      const pin = msg.pin;

      if (!data.pins[mode]) {
        send(ws, { type: "error", message: "不明なモードです" });
        return;
      }

      if (data.pins[mode] !== pin) {
        send(ws, { type: "error", message: "PINが違います" });
        return;
      }

      ws.loggedIn = true;
      ws.userMode = mode;

      send(ws, {
        type: "login_ok",
        records: data.records
      });
      return;
    }

    if (!ws.loggedIn) {
      send(ws, { type: "error", message: "先にログインしてください" });
      return;
    }

    if (msg.type === "record") {
      if (ws.userMode !== "judge" && ws.userMode !== "chief") {
        send(ws, { type: "error", message: "このモードでは入力できません" });
        return;
      }

      const bib = String(msg.bib || "").trim();
      const action = String(msg.action || "").trim();

      if (!bib) {
        send(ws, { type: "error", message: "ナンバーが空です" });
        return;
      }

      if (!["warning", "red"].includes(action)) {
        send(ws, { type: "error", message: "判定が不正です" });
        return;
      }

      data.records.push({
        bib,
        action,
        mode: ws.userMode,
        time: nowText()
      });

      saveData(data);

      broadcast({
        type: "update",
        records: data.records
      });
      return;
    }

    if (msg.type === "set_pin") {
      if (ws.userMode !== "host") {
        send(ws, { type: "error", message: "hostのみ設定変更できます" });
        return;
      }

      const target = String(msg.target || "").trim();
      const pin = String(msg.pin || "").trim();

      if (!data.pins[target]) {
        send(ws, { type: "error", message: "対象モードが不正です" });
        return;
      }

      if (!pin) {
        send(ws, { type: "error", message: "PINが空です" });
        return;
      }

      data.pins[target] = pin;
      saveData(data);

      send(ws, { type: "saved_pin" });
      return;
    }

    if (msg.type === "reset_records") {
      if (ws.userMode !== "host") {
        send(ws, { type: "error", message: "hostのみ全消去できます" });
        return;
      }

      data.records = [];
      saveData(data);

      broadcast({
        type: "reset_done"
      });

      broadcast({
        type: "update",
        records: []
      });
      return;
    }

    send(ws, { type: "error", message: "未対応の命令です" });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
