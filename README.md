# Tic-Tac-Toe

Choose **Play computer** for an offline game (you play X, the computer plays O), or **2 players / room** to create or join an online room. The computer uses optimal moves. Use **Play again** after a result. Switching modes clears the board and disconnects the current room; you can rejoin using its code.

Players can join the same six-character room from separate browsers or origins. The Node.js server serves the page and owns the room state; moves are shared over WebSockets and checked by the server.

After a win, the winning three squares are highlighted and the winner starts the next round. After a draw, the starting player alternates.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm test
PORT=8080 npm start
```

Open `http://localhost:8080`, create a room, and share its invite link or room code. A second player can open the link or enter the room code.

## Players on different origins

Both clients must connect to the same game server. In **Game server URL**, enter that server's origin (for example, `https://games.example.com`) on each site. The server URL must be reachable by both players and support WebSocket upgrades at `/ws`.

For production, expose the server through HTTPS/WSS and set `ALLOWED_ORIGINS` to a comma-separated list of allowed frontend origins, without trailing slashes. For example:

```sh
ALLOWED_ORIGINS=https://site-a.example,https://site-b.example
```

When the variable is unset in a standalone run, origin checks are disabled to make initial setup straightforward. The Jenkins deployment defaults it to `http://16.60.185.90`; configure the Jenkins agent/environment variable `ALLOWED_ORIGINS` to a comma-separated list to permit additional frontend origins. Configure an allowlist before exposing the game publicly. Rooms are held in server memory, so restarting the server ends current games.

## Docker and deployment

Build and run the application with:

```sh
docker build -t tic-tac-toe .
docker run --rm -p 8080:80 -e ALLOWED_ORIGINS=https://site-a.example,https://site-b.example tic-tac-toe
```

The Jenkins pipeline builds this image and checks `/healthz` after deployment.
