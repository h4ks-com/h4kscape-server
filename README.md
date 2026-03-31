# h4kscape-server

RuneScape 2 (2004Scape) game server. Handles game logic, player data, cache
packing, OAuth authentication, and serves game data files over HTTP + WebSocket.

Forked from [2004scape/Server](https://github.com/2004scape/Server) (Lost City).

The web client lives in a separate repository:
[h4ks-com/h4kscape-client](https://github.com/h4ks-com/h4kscape-client)

## Docker

The image is published to Docker Hub on every push to `main`:

```
docker pull mattfly/h4kscape-server:latest
```

### Ports

| Port | Protocol | Purpose |
|-------|----------|------------------------------------------|
| 80 | HTTP/WS | Game data files, OAuth, WebSocket upgrade |
| 43594 | TCP | Java client connections |
| 8898 | HTTP | Prometheus metrics |

### Volumes

Mount these for data persistence across container restarts and updates:

| Container Path | Purpose |
|--------------------------|--------------------------------------|
| `/app/data/players` | Player save files |
| `/app/.db` | SQLite database |

### Running

```bash
docker run -d \
  --name h4kscape \
  -p 80:80 \
  -p 43594:43594 \
  -v h4kscape-players:/app/data/players \
  -v h4kscape-db:/app/.db \
  -e CLIENT_ORIGIN=https://scape.h4ks.com \
  -e OAUTH_ENABLED=true \
  -e OAUTH_LOGTO_ENDPOINT=https://auth.h4ks.com \
  -e OAUTH_LOGTO_APP_ID=bc40c9vfeg5i43m9j8bws \
  -e OAUTH_CALLBACK_URL=https://scape.h4ks.com/auth/callback \
  -e HEAD_ADMIN=valware \
  -e BUILD_STARTUP=true \
  -e BUILD_STARTUP_UPDATE=true \
  mattfly/h4kscape-server:latest
```

### Environment Variables

Copy `.env.example` to `.env` or pass via `-e` flags / Docker Compose.

Key variables:

| Variable | Default | Description |
|------------------|---------|----------------------------------------------|
| `WEB_PORT` | `80` | HTTP + WebSocket listen port |
| `NODE_PORT` | `43594` | TCP game port |
| `CLIENT_ORIGIN` | (empty) | Client URL for CORS (e.g. `https://scape.h4ks.com`) |
| `HEAD_ADMIN` | `valware`| Username that receives dev powers at login |
| `OAUTH_ENABLED` | `false` | Enable OAuth2 login via Logto |
| `BUILD_STARTUP` | `false` | Pack game cache on startup |

See `.env.example` for the full list.

## CI/CD

The GitHub Actions workflow (`.github/workflows/docker.yml`) builds and pushes
the Docker image on every push to `main`. It requires:

- **Repository secret**: `DOCKERHUB_TOKEN` — a Docker Hub access token for the
  `mattfly` account.

## Local Development

```bash
npm install
cp .env.example .env   # edit as needed
npm run dev
```

## License

MIT — see [LICENSE](LICENSE). Originally by [Lost City / 2004scape](https://github.com/2004scape/Server).
