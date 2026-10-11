"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { once } = require("node:events");
const test = require("node:test");
const { WebSocket } = require("ws");
const { createGameServer } = require("../server");

function waitForMessage(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for a WebSocket message."));
    }, 2000);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeListener("message", onMessage);
      socket.removeListener("error", onError);
    }

    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  return socket;
}

function sendAndWait(socket, message, predicate) {
  const response = waitForMessage(socket, predicate);
  socket.send(JSON.stringify(message));
  return response;
}

test("rooms synchronize players, validate turns, detect wins, and reset", async t => {
  const gameServer = createGameServer();
  const clients = new Set();
  gameServer.server.listen(0, "127.0.0.1");
  await once(gameServer.server, "listening");

  const address = gameServer.server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const websocketUrl = `ws://127.0.0.1:${address.port}/ws`;
  t.after(async () => {
    clearInterval(gameServer.cleanupTimer);
    for (const client of clients) client.terminate();
    await new Promise(resolve => gameServer.server.close(resolve));
  });

  const healthResponse = await fetch(`${origin}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.equal(await healthResponse.text(), "ok\n");
  assert.equal((await fetch(origin)).status, 200);

  const xPlayer = await connect(websocketUrl);
  clients.add(xPlayer);
  const xToken = crypto.randomUUID();
  const created = await sendAndWait(
    xPlayer,
    { type: "create", token: xToken },
    message => message.type === "state"
  );
  assert.match(created.roomCode, /^[A-Z0-9]{6}$/);
  assert.equal(created.playerMark, "X");
  assert.equal(created.players.X, true);
  assert.equal(created.players.O, false);

  const oPlayer = await connect(websocketUrl);
  clients.add(oPlayer);
  const oToken = crypto.randomUUID();
  const xJoined = waitForMessage(
    xPlayer,
    message => message.type === "state" && message.players.O
  );
  const oJoined = await sendAndWait(
    oPlayer,
    { type: "join", roomCode: created.roomCode, token: oToken },
    message => message.type === "state"
  );
  assert.equal(oJoined.playerMark, "O", JSON.stringify(oJoined));
  assert.equal((await xJoined).players.O, true);

  const thirdPlayer = await connect(websocketUrl);
  clients.add(thirdPlayer);
  const fullRoomError = await sendAndWait(
    thirdPlayer,
    { type: "join", roomCode: created.roomCode, token: crypto.randomUUID() },
    message => message.type === "error"
  );
  assert.match(fullRoomError.message, /two players/);

  const outOfTurn = await sendAndWait(
    oPlayer,
    { type: "move", index: 3 },
    message => message.type === "error"
  );
  assert.match(outOfTurn.message, /other player's turn/);

  const moves = [
    [xPlayer, 0],
    [oPlayer, 3],
    [xPlayer, 1],
    [oPlayer, 4],
    [xPlayer, 2]
  ];
  let finalXState;
  let finalOState;
  for (const [client, index] of moves) {
    const xState = waitForMessage(xPlayer, message => message.type === "state");
    const oState = waitForMessage(oPlayer, message => message.type === "state");
    client.send(JSON.stringify({ type: "move", index }));
    [finalXState, finalOState] = await Promise.all([xState, oState]);
  }
  assert.equal(finalXState.winner, "X");
  assert.equal(finalOState.winner, "X");
  assert.equal(finalXState.gameOver, true);

  const resetXState = waitForMessage(xPlayer, message => message.type === "state");
  const resetOState = sendAndWait(
    oPlayer,
    { type: "reset" },
    message => message.type === "state"
  );
  const [xReset, oReset] = await Promise.all([resetXState, resetOState]);
  assert.deepEqual(xReset.board, Array(9).fill(""));
  assert.deepEqual(oReset.board, Array(9).fill(""));
  assert.equal(xReset.currentPlayer, "X");

  const oDisconnected = waitForMessage(
    xPlayer,
    message => message.type === "state" && !message.players.O
  );
  oPlayer.close();
  await oDisconnected;
  clients.delete(oPlayer);

  const reconnectedO = await connect(websocketUrl);
  clients.add(reconnectedO);
  const restoredState = await sendAndWait(
    reconnectedO,
    { type: "join", roomCode: created.roomCode, token: oToken },
    message => message.type === "state"
  );
  assert.equal(restoredState.playerMark, "O");
  assert.equal(restoredState.players.O, true);
});

test("rejects WebSocket connections from origins outside the configured allowlist", async t => {
  const gameServer = createGameServer({ allowedOrigins: ["https://allowed.example"] });
  gameServer.server.listen(0, "127.0.0.1");
  await once(gameServer.server, "listening");
  t.after(async () => {
    clearInterval(gameServer.cleanupTimer);
    await new Promise(resolve => gameServer.server.close(resolve));
  });

  const { port } = gameServer.server.address();
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: "https://other.example"
  });
  const [error] = await once(rejected, "error");
  assert.ok(error);

  const allowed = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: "https://allowed.example"
  });
  await once(allowed, "open");
  allowed.terminate();
});
