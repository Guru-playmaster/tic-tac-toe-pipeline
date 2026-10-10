    const cells = [...document.querySelectorAll(".cell")];
    const statusText = document.querySelector("#status");
    const resetButton = document.querySelector("#reset");
    const winningLines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];

    let board = Array(9).fill("");
    let currentPlayer = "X";
    let gameOver = false;

    function playTurn(index) {
      if (gameOver || board[index]) return;

      board[index] = currentPlayer;
      cells[index].textContent = currentPlayer;
      cells[index].classList.add(currentPlayer.toLowerCase());
      cells[index].disabled = true;
      cells[index].setAttribute("aria-label", `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}, ${currentPlayer}`);

      if (winningLines.some(line => line.every(square => board[square] === currentPlayer))) {
        statusText.textContent = `Player ${currentPlayer} wins!`;
        gameOver = true;
        cells.forEach(cell => cell.disabled = true);
      } else if (board.every(Boolean)) {
        statusText.textContent = "It's a draw!";
        gameOver = true;
      } else {
        currentPlayer = currentPlayer === "X" ? "O" : "X";
        statusText.textContent = `Player ${currentPlayer}'s turn`;
      }
    }

    function startNewGame() {
      board = Array(9).fill("");
      currentPlayer = "X";
      gameOver = false;
      statusText.textContent = "Player X's turn";
      cells.forEach((cell, index) => {
        cell.textContent = "";
        cell.disabled = false;
        cell.classList.remove("x", "o");
        cell.setAttribute("aria-label", `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}`);
      });
    }

    cells.forEach((cell, index) => cell.addEventListener("click", () => playTurn(index)));
    resetButton.addEventListener("click", startNewGame);