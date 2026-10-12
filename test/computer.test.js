"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup(random = () => 0.99, dependencies = {}) {
  const elements = new Map();
  function element() {
    const classes = new Set();
    return {
      textContent: "", value: "", hidden: false, disabled: false, attributes: {}, events: {},
      classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
        remove(...names) { names.forEach(name => classes.delete(name)); }, contains: name => classes.has(name) },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
      click() { if (!this.disabled) this.events.click(); }
    };
  }
  const cells = Array.from({ length: 9 }, element);
  const timers = new Map();
  let nextTimer = 0;
  const context = {
    document: {
      querySelectorAll: () => cells,
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      }
    },
    window: { location: { origin: "http://localhost", search: "", href: "http://localhost" } },
    localStorage: { getItem: () => null, setItem() {} }, console, URL, URLSearchParams,
    Math: Object.assign(Object.create(Math), { random }),
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    ...dependencies
  };
  const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
  vm.runInNewContext(source.replace("  lockBoard();\n\n  createButton", "  globalThis.ai = { bestComputerMove, chooseComputerMove, evaluateBoard };\n  lockBoard();\n\n  createButton"), context);
  return { context, cells, elements, timers, tick() {
    const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn());
  } };
}

test("computer play locks turns, finishes a game, resets, and cancels on mode change", () => {
  const game = setup();
  const { cells, elements, timers } = game;
  elements.get("#mode-computer").click();
  assert.equal(elements.get("#lobby").hidden, true);
  assert.equal(elements.get("#room").hidden, true);
  assert.equal(elements.get("#status").textContent, "Your turn (X)");
  cells[0].click();
  assert.equal(cells[0].textContent, "X");
  assert.ok(cells.every(cell => cell.disabled));
  game.tick();
  assert.equal(cells[4].textContent, "O");
  while (cells.some(cell => !cell.disabled)) {
    cells.find(cell => !cell.disabled).click();
    game.tick();
  }
  assert.match(elements.get("#status").textContent, /wins!|You win!|draw/);
  assert.equal(elements.get("#reset").hidden, false);
  elements.get("#reset").click();
  assert.ok(cells.every(cell => !cell.textContent && !cell.disabled));
  cells[0].click();
  assert.equal(timers.size, 1);
  elements.get("#mode-room").click();
  game.tick();
  assert.equal(timers.size, 0);
  assert.ok(cells.every(cell => !cell.textContent && cell.disabled));
  assert.equal(elements.get("#lobby").hidden, false);
});

test("computer takes wins, blocks threats, and cannot lose against any human moves", () => {
  const { ai } = setup().context;
  assert.equal(ai.bestComputerMove(["O", "O", "", "X", "X", "", "", "", ""]), 2);
  assert.equal(ai.bestComputerMove(["X", "X", "", "", "O", "", "", "", ""]), 2);
  function visit(board, turn) {
    const result = ai.evaluateBoard(board);
    assert.notEqual(result.winner, "X");
    if (result.gameOver) return;
    if (turn === "O") {
      const copy = [...board];
      const index = ai.bestComputerMove(board);
      assert.deepEqual(board, copy);
      board[index] = "O";
      visit(board, "X");
      board[index] = "";
    } else {
      board.forEach((mark, index) => {
        if (mark) return;
        board[index] = "X";
        visit(board, "O");
        board[index] = "";
      });
    }
  }
  visit(Array(9).fill(""), "X");
});

test("single computer mode varies openings but still takes wins and blocks threats", () => {
  const { ai } = setup().context;
  const opening = ["X", "", "", "", "", "", "", "", ""];
  const original = [...opening];
  assert.equal(ai.chooseComputerMove(opening, () => 0), 1);
  assert.equal(ai.chooseComputerMove(opening, () => 0.99), 4);
  assert.deepEqual(opening, original);
  assert.equal(ai.chooseComputerMove(["O", "O", "", "X", "X", "", "", "", ""], () => 0), 2);
  assert.equal(ai.chooseComputerMove(["X", "X", "", "", "O", "", "", "", ""], () => 0), 2);
  assert.equal(ai.chooseComputerMove(["X", "X", "X", "O", "O", "", "", "", ""]), null);
});

test("varied computer play allows human wins as well as computer wins and draws", () => {
  const { ai } = setup().context;
  const outcomes = new Set();
  function visit(board, turn) {
    const result = ai.evaluateBoard(board);
    if (result.gameOver) { outcomes.add(result.winner || "draw"); return; }
    const moves = turn === "X"
      ? board.flatMap((mark, index) => mark ? [] : [index])
      : [...new Set([0, 0.1, 0.2, 0.34, 0.5, 0.75, 0.99]
          .map(value => ai.chooseComputerMove(board, () => value)))];
    for (const index of moves) {
      assert.equal(board[index], "");
      board[index] = turn;
      visit(board, turn === "X" ? "O" : "X");
      board[index] = "";
      if (outcomes.size === 3) return;
    }
  }
  visit(Array(9).fill(""), "X");
  assert.deepEqual([...outcomes].sort(), ["O", "X", "draw"]);
});

test("connection setup failure keeps the lobby usable and computer mode available", () => {
  class BlockedSocket { constructor() { throw new Error("Browser blocked this connection"); } }
  const { elements } = setup(undefined, {
    WebSocket: BlockedSocket,
    crypto: require("node:crypto").webcrypto
  });
  elements.get("#create-room").click();
  assert.match(elements.get("#status").textContent, /Could not connect/);
  assert.equal(elements.get("#lobby").hidden, false);
  assert.equal(elements.get("#create-room").disabled, false);
  assert.equal(elements.get("#join-room").disabled, false);
  elements.get("#mode-computer").click();
  assert.equal(elements.get("#status").textContent, "Your turn (X)");
});

test("room play waits for server acknowledgement and pauses replay on disconnect", () => {
  const sockets = [];
  class FakeSocket {
    static OPEN = 1; static CLOSED = 3;
    constructor() { this.readyState = 1; this.events = {}; this.sent = []; sockets.push(this); }
    addEventListener(name, fn) { this.events[name] = fn; }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.events.close?.(); }
    state(value) { this.events.message({ data: JSON.stringify(value) }); }
  }
  const { elements, cells } = setup(undefined, { WebSocket: FakeSocket, crypto: require("node:crypto").webcrypto });
  elements.get("#create-room").click();
  const socket = sockets[0];
  const state = { type: "state", roomCode: "ABCDEF", playerMark: "X", board: Array(9).fill(""),
    currentPlayer: "X", players: { X: true, O: true }, winner: null, winningLine: null, gameOver: false };
  socket.state(state);
  assert.equal(elements.get("#status").textContent, "Player X's turn - your move");
  cells[0].click(); cells[1].click();
  assert.equal(socket.sent.length, 1);
  assert.ok(cells.every(cell => cell.disabled));
  socket.state({ type: "error", message: "Move rejected" });
  assert.ok(cells.every(cell => !cell.disabled));
  socket.state({ ...state, gameOver: true });
  assert.equal(elements.get("#reset").disabled, false);
  socket.close();
  assert.equal(elements.get("#reset").disabled, true);
  elements.get("#reset").click();
  assert.equal(socket.sent.length, 1);
});
