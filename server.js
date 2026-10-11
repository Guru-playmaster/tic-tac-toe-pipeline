"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");

const ROOT = __dirname;
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 6;
const ROOM_IDLE_LIMIT_MS = 6 * 60 * 60 * 1000;
const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]]
]);

function createGameServer(options = {}) {
  const rooms = new Map();
  const allowedOrigins = new Set(options.allowedOrigins || []);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;

    if (pathname === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok\n");
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }

    const file = STATIC_FILES.get(pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }

    const [filename, contentType] = file;
    fs.readFile(path.join(ROOT, filename), (error, contents) => {
      if (error) {
        console.error(`Unable to read ${filename}:`, error);
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("Server error\n");
        return;
      }
      response.writeHead(200, {
        "content-type": contentType,
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin"
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    });
  });
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const origin = request.headers.origin;
    if (
      pathname !== "/ws" ||
      (allowedOrigins.size > 0 && (!origin || !allowedOrigins.has(origin)))
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, websocket => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", socket => {
    let room = null;
    let player = null;

    socket.on("message", rawMessage => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        sendError(socket, "Message must be valid JSON.");
        return;
      }

      if (!message || typeof message !== "object" || Array.isArray(message)) {
        sendError(socket, "Message must be a JSON object.");
        return;
      }

      if (message.type === "create") {
        if (room) {
          sendError(socket, "You are already in a room.");
          return;
        }
        if (!isValidToken(message.token)) {
          sendError(socket, "A valid player token is required.");
          return;
        }
        room = createRoom(rooms);
        player = { token: message.token, mark: "X", socket };
        room.players.set(player.token, player);
        room.updatedAt = Date.now();
        sendState(room, player);
        return;
      }

      if (message.type === "join") {
        if (room) {
          sendError(socket, "You are already in a room.");
          return;
        }
        if (!isValidToken(message.token)) {
          sendError(socket, "A valid player token is required.");
          return;
        }
        const roomCode = typeof message.roomCode === "string"
          ? message.roomCode.toUpperCase()
          : "";
        const requestedRoom = rooms.get(roomCode);
        if (!requestedRoom) {
          sendError(socket, "That room was not found. Check the code and try again.");
          return;
        }

        room = requestedRoom;
        player = room.players.get(message.token) || null;
        if (!player) {
          if (room.players.size >= 2) {
            room = null;
            sendError(socket, "That room already has two players.");
            return;
          }
          const mark = [...room.players.values()].some(
            participant => participant.mark === "X"
          ) ? "O" : "X";
          player = { token: message.token, mark, socket };
          room.players.set(player.token, player);
        } else {
          if (player.socket && player.socket !== socket) {
            player.socket.close(4001, "Player reconnected in another tab");
          }
          player.socket = socket;
        }
        room.updatedAt = Date.now();
        broadcastState(room);
        return;
      }

      if (!room || !player || player.socket !== socket) {
        sendError(socket, "Join a room before sending game actions.");
        return;
      }
      room.updatedAt = Date.now();

      if (message.type === "move") {
        if (
          !Number.isInteger(message.index) ||
          message.index < 0 ||
          message.index > 8
        ) {
          sendError(socket, "The selected square is invalid.");
          return;
        }
        if (room.gameOver) {
          sendError(socket, "This game is over. Start a new game to keep playing.");
          return;
        }
        if (room.currentPlayer !== player.mark) {
          sendError(socket, "It is the other player's turn.");
          return;
        }
        if (room.board[message.index]) {
          sendError(socket, "That square is already taken.");
          return;
        }

        room.board[message.index] = player.mark;
        room.winner = WINNING_LINES.some(line =>
          line.every(index => room.board[index] === player.mark)
        ) ? player.mark : null;
        room.gameOver = Boolean(room.winner) || room.board.every(Boolean);
        if (!room.gameOver) {
          room.currentPlayer = player.mark === "X" ? "O" : "X";
        }
        broadcastState(room);
        return;
      }

      if (message.type === "reset") {
        room.board = Array(9).fill("");
        room.currentPlayer = "X";
        room.winner = null;
        room.gameOver = false;
        broadcastState(room);
        return;
      }

      sendError(socket, "Unknown game action.");
    });

    socket.on("close", () => {
      if (room && player && player.socket === socket) {
        player.socket = null;
        room.updatedAt = Date.now();
        broadcastState(room);
      }
    });

    socket.on("error", error => {
      console.error("WebSocket connection error:", error);
    });
  });

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [roomCode, room] of rooms) {
      const hasConnectedPlayer = [...room.players.values()].some(
        participant => participant.socket?.readyState === WebSocket.OPEN
      );
      if (!hasConnectedPlayer && now - room.updatedAt > ROOM_IDLE_LIMIT_MS) {
        rooms.delete(roomCode);
      }
    }
  }, 30 * 60 * 1000);
  cleanupTimer.unref();

  return { server, websocketServer, rooms, cleanupTimer };
}

function isValidToken(token) {
  return typeof token === "string" && /^[a-f0-9-]{36}$/i.test(token);
}

function createRoom(rooms) {
  let code;
  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
      ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)]
    ).join("");
  } while (rooms.has(code));

  const room = {
    code,
    board: Array(9).fill(""),
    currentPlayer: "X",
    winner: null,
    gameOver: false,
    players: new Map(),
    updatedAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function sendError(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message }));
  }
}

function sendState(room, player) {
  if (player.socket?.readyState !== WebSocket.OPEN) return;
  player.socket.send(JSON.stringify({
    type: "state",
    roomCode: room.code,
    playerMark: player.mark,
    board: room.board,
    currentPlayer: room.currentPlayer,
    winner: room.winner,
    gameOver: room.gameOver,
    players: Object.fromEntries(
      ["X", "O"].map(mark => [
        mark,
        [...room.players.values()].some(
          participant =>
            participant.mark === mark &&
            participant.socket?.readyState === WebSocket.OPEN
        )
      ])
    )
  }));
}

function broadcastState(room) {
  for (const player of room.players.values()) {
    sendState(room, player);
  }
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || "80", 10);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  const { server } = createGameServer({ allowedOrigins });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Tic-Tac-Toe server listening on port ${port}`);
    if (allowedOrigins.length > 0) {
      console.log(`WebSocket origins allowed: ${allowedOrigins.join(", ")}`);
    } else {
      console.warn("WebSocket origin checks are disabled; set ALLOWED_ORIGINS for production.");
    }
  });
  server.on("error", error => {
    console.error("HTTP server failed:", error);
    process.exitCode = 1;
  });
}

module.exports = { createGameServer };
