"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
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
    localStorage: { getItem: () => null }, console, URL, URLSearchParams,
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }
  };
  const source = fs.readFileSync(require.resolve("../script.js"), "utf8");
  vm.runInNewContext(source.replace("  lockBoard();\n\n  createButton", "  globalThis.ai = { bestComputerMove, evaluateBoard };\n  lockBoard();\n\n  createButton"), context);
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
  for (const index of [8, 6, 5, 1]) { cells[index].click(); game.tick(); }
  assert.equal(elements.get("#status").textContent, "Computer wins!");
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
