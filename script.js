(() => {
  const cells = [...document.querySelectorAll(".cell")];
  const statusText = document.querySelector("#status");
  const resetButton = document.querySelector("#reset");
  const lobby = document.querySelector("#lobby");
  const roomPanel = document.querySelector("#room");
  const serverInput = document.querySelector("#server-url");
  const roomInput = document.querySelector("#room-input");
  const createButton = document.querySelector("#create-room");
  const joinButton = document.querySelector("#join-room");
  const roomCodeText = document.querySelector("#room-code");
  const playerInfo = document.querySelector("#player-info");
  const copyInviteButton = document.querySelector("#copy-invite");
  const reconnectButton = document.querySelector("#reconnect");
  const storageKey = "tic-tac-toe-online-room";

  let socket = null;
  let savedRoom = null;
  let gameState = null;
  let playerToken = null;
  let connected = false;
  let expectedRoomCode = null;

  function setStatus(message) {
    statusText.textContent = message;
  }

  function createPlayerToken() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function readSavedRoom() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        saved &&
        typeof saved.roomCode === "string" &&
        typeof saved.token === "string" &&
        typeof saved.serverUrl === "string"
      ) {
        return saved;
      }
    } catch (error) {
      console.warn("Could not read the saved online room.", error);
    }
    return null;
  }

  function saveRoom(roomCode, token, serverUrl) {
    savedRoom = { roomCode, token, serverUrl };
    try {
      localStorage.setItem(storageKey, JSON.stringify(savedRoom));
    } catch (error) {
      console.warn("Could not save the online room for reconnecting.", error);
    }
  }

  function getServerAddress() {
    let serverUrl;
    try {
      serverUrl = new URL(serverInput.value.trim() || window.location.origin);
    } catch {
      throw new Error("Enter a valid game server URL.");
    }

    if (!["http:", "https:"].includes(serverUrl.protocol)) {
      throw new Error("The game server URL must start with http:// or https://.");
    }
    if (serverUrl.pathname !== "/" || serverUrl.search || serverUrl.hash) {
      throw new Error("Enter only the game server origin, without a path or query.");
    }
    return serverUrl;
  }

  function setLobbyEnabled(enabled) {
    createButton.disabled = !enabled;
    joinButton.disabled = !enabled;
    serverInput.disabled = !enabled;
    roomInput.disabled = !enabled;
  }

  function lockBoard() {
    cells.forEach(cell => {
      cell.disabled = true;
    });
  }

  function connectToRoom(action, roomCode, token) {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }

    let serverUrl;
    try {
      serverUrl = getServerAddress();
    } catch (error) {
      setStatus(error.message);
      return;
    }

    const websocketUrl = new URL(serverUrl);
    websocketUrl.protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:";
    websocketUrl.pathname = "/ws";

    playerToken = token;
    expectedRoomCode = roomCode || null;
    gameState = null;
    connected = false;
    lobby.hidden = true;
    roomPanel.hidden = false;
    reconnectButton.hidden = true;
    resetButton.hidden = true;
    lockBoard();
    setLobbyEnabled(false);
    setStatus("Connecting to the game server...");

    const activeSocket = new WebSocket(websocketUrl);
    let connectionError = null;
    socket = activeSocket;

    activeSocket.addEventListener("open", () => {
      if (socket !== activeSocket) return;
      const message = { type: action, token };
      if (roomCode) message.roomCode = roomCode;
      activeSocket.send(JSON.stringify(message));
    });

    activeSocket.addEventListener("message", event => {
      if (socket !== activeSocket) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        console.error("Received an invalid message from the game server.", error);
        setStatus("The game server sent an invalid response.");
        return;
      }

      if (message.type === "error") {
        connectionError = message.message;
        setStatus(message.message);
        if (!gameState) {
          activeSocket.close();
        }
        return;
      }
      if (message.type !== "state") return;

      connected = true;
      gameState = message;
      saveRoom(message.roomCode, token, serverUrl.origin);
      roomInput.value = message.roomCode;
      renderGame();
    });

    activeSocket.addEventListener("error", error => {
      console.error("Could not connect to the game server.", error);
      if (socket === activeSocket) {
        connectionError = "Could not connect. Check the server URL and try again.";
        setStatus(connectionError);
      }
    });

    activeSocket.addEventListener("close", () => {
      if (socket !== activeSocket) return;
      connected = false;
      lockBoard();
      if (gameState) {
        reconnectButton.hidden = false;
        setStatus("Connection lost. Reconnect to continue this game.");
      } else {
        roomPanel.hidden = true;
        lobby.hidden = false;
        setLobbyEnabled(true);
        setStatus(connectionError || "Could not join that room. Check the code and server URL.");
      }
    });
  }

  function renderGame() {
    const state = gameState;
    if (!state) return;

    connected = true;
    lobby.hidden = true;
    roomPanel.hidden = false;
    reconnectButton.hidden = true;
    resetButton.hidden = !state.gameOver;
    roomCodeText.textContent = state.roomCode;
    const opponentsConnected = state.players[state.playerMark === "X" ? "O" : "X"];
    playerInfo.textContent = `You are Player ${state.playerMark}. ${opponentsConnected ? "Both players are connected." : "Waiting for the other player..."}`;

    state.board.forEach((mark, index) => {
      const cell = cells[index];
      cell.textContent = mark;
      cell.classList.toggle("x", mark === "X");
      cell.classList.toggle("o", mark === "O");
      cell.classList.toggle("winning", state.winningLine?.includes(index) || false);
      cell.setAttribute(
        "aria-label",
        `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}${mark ? `, ${mark}` : ""}${state.winningLine?.includes(index) ? ", part of winning line" : ""}`
      );
      cell.disabled =
        !connected ||
        !opponentsConnected ||
        state.gameOver ||
        state.currentPlayer !== state.playerMark ||
        Boolean(mark);
    });

    if (state.winner) {
      setStatus(`Player ${state.winner} wins!`);
    } else if (state.gameOver) {
      setStatus("It's a draw!");
    } else if (!opponentsConnected) {
      setStatus("Waiting for the other player to join...");
    } else if (state.currentPlayer === state.playerMark) {
      setStatus(`Player ${state.playerMark}'s turn — your move`);
    } else {
      setStatus(`Player ${state.currentPlayer}'s turn`);
    }
  }

  function sendMessage(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !connected) {
      setStatus("You are not connected to the game server.");
      return;
    }
    socket.send(JSON.stringify(message));
  }

  lockBoard();

  createButton.addEventListener("click", () => {
    connectToRoom("create", null, createPlayerToken());
  });

  joinButton.addEventListener("click", () => {
    const roomCode = roomInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
      setStatus("Enter the six-character room code.");
      return;
    }
    let serverUrl;
    try {
      serverUrl = getServerAddress().origin;
    } catch (error) {
      setStatus(error.message);
      return;
    }
    const token =
      savedRoom && savedRoom.roomCode === roomCode && savedRoom.serverUrl === serverUrl
        ? savedRoom.token
        : createPlayerToken();
    connectToRoom("join", roomCode, token);
  });

  cells.forEach((cell, index) => {
    cell.addEventListener("click", () => sendMessage({ type: "move", index }));
  });

  resetButton.addEventListener("click", () => sendMessage({ type: "reset" }));

  reconnectButton.addEventListener("click", () => {
    if (savedRoom) {
      connectToRoom("join", savedRoom.roomCode, savedRoom.token);
    }
  });

  copyInviteButton.addEventListener("click", async () => {
    if (!gameState) return;
    try {
      const serverUrl = getServerAddress();
      const invite = new URL(window.location.href);
      invite.search = "";
      invite.searchParams.set("room", gameState.roomCode);
      invite.searchParams.set("server", serverUrl.origin);
      await navigator.clipboard.writeText(invite.toString());
      setStatus("Invite link copied.");
    } catch (error) {
      console.error("Could not copy the invite link.", error);
      setStatus("Could not copy the invite link. You can share the room code manually.");
    }
  });

  const query = new URLSearchParams(window.location.search);
  const invitedRoom = query.get("room");
  const invitedServer = query.get("server");
  savedRoom = readSavedRoom();
  if (invitedServer) {
    serverInput.value = invitedServer;
  } else if (savedRoom) {
    serverInput.value = savedRoom.serverUrl;
  }
  if (invitedRoom) {
    roomInput.value = invitedRoom.toUpperCase();
  } else if (savedRoom) {
    connectToRoom("join", savedRoom.roomCode, savedRoom.token);
  }
})();
