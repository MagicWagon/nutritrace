# NutriTrace

**Trace Every Bite** — A self-hosted personal nutrition tracker built for privacy and full data ownership.

NutriTrace runs entirely in a single Docker container on your own hardware. No accounts on external services, no data leaving your network, no subscriptions.

---

## Features

### Diary
- Daily food diary with configurable meals (Breakfast, Lunch, Dinner, Snacks, or fully custom)
- Quick-add foods, meals, and recipes with portion scaling
- Nutrition bar with macro summary and per-meal breakdowns
- Body stats tracking (weight, measurements, and more) with customizable fields
- Water intake tracking with configurable containers and daily goal
- Long-press (mobile) or right-click (desktop) for edit/move/delete actions

### Foods & Meals
- Personal food database with photos, barcodes, categories, and custom labels
- Barcode scanner (camera) for quick food lookup via Open Food Facts
- Meal and recipe builder with drag-to-reorder ingredients
- Proportional nutrition scaling when editing serving size
- Import foods from Open Food Facts, USDA FoodData Central, or Mealie (recipe manager)

### Statistics
- Charts for any tracked nutrient or body stat over time
- Bar and line chart modes; average, trend, and goal overlay lines
- Configurable date ranges

### Goals
- Calorie and nutrient goals with template support
- Wizard calculates TDEE (Mifflin-St Jeor) and water goal from body stats and activity level

### Settings & Customization
- Light / dark / system theme
- Custom accent color (presets or full hex color picker)
- Configurable navigation style (bottom bar, sidebar, or both)
- Custom nutriment visibility and display order
- Custom body stat fields and display order
- Date and time format options (US / ISO / EU / Natural)
- Unit system: weight, height, length, distance

### Multi-User Support
- Optional user management — runs perfectly as a single-user app with no login required
- Admin can invite additional users via email or shareable link
- All data is scoped per user
- Configurable session timeout

### AI Assistant (FitBot)
- Optional AI chat assistant for nutrition questions and logging help
- Supports Claude (Anthropic), OpenAI, and OpenRouter
- Bring your own API key

### Backup & Restore
- Full backup: ZIP archive of all database tables + uploaded images, stored on the server
- Download backups to your device or restore from a previously saved backup
- Upload and restore from a backup file taken on another instance
- Portable JSON export/import (foods, meals, diary, settings — no images)
- CSV diary export
- Import from Waistline (Android nutrition app)

---

## Self-Hosting with Docker

### Quick Start

1. Copy `.env.example` to `.env` and fill in your paths:

```env
DATA_DB_PATH=/your/host/path/db
DATA_UPLOADS_PATH=/your/host/path/uploads
JWT_SECRET=your-long-random-secret

# Optional — SMTP for password reset emails and user invites
# If omitted, invites fall back to a copyable link instead of email
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=you@example.com
# SMTP_PASS=your-password
# SMTP_FROM=NutriTrace <noreply@example.com>
```

Generate a JWT secret:
```bash
openssl rand -base64 48
```

2. The included `docker-compose.yml` pulls the latest image from GitHub Container Registry and mounts your two data directories. No changes to the compose file are needed — everything is driven by `.env`. If you want to pin to a specific version, change the image tag from `latest` to a release tag.

3. Start the container:

```bash
docker compose up -d
```

4. Open `http://localhost:3000` in your browser.

On first launch, a setup wizard walks you through enabling user management and creating your admin account. If you skip user management, the app runs in single-user mode with no login required.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATA_DB_PATH` | Yes | — | Host path for the SQLite database directory |
| `DATA_UPLOADS_PATH` | Yes | — | Host path for uploaded images and backups |
| `JWT_SECRET` | If using users | — | Secret key for signing auth tokens. Use a long random string. |
| `SMTP_HOST` | No | — | SMTP server hostname (for password reset & invites) |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_SECURE` | No | `false` | `true` for SSL (port 465), `false` for STARTTLS |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | — | From address, e.g. `NutriTrace <noreply@example.com>` |

SMTP can also be configured (and tested) in the Settings UI. Environment variables take priority over UI-configured values.

---

## Data Persistence

Two host directories must be bind-mounted:

- **Database** (`DATA_DB_PATH`) — SQLite file. Survives container restarts and redeployments.
- **Uploads** (`DATA_UPLOADS_PATH`) — Food/meal photos and server-side backups (stored in `uploads/backups/`). Survives container restarts and redeployments.

Nothing else needs to persist — the container is stateless beyond these two volumes.

---

## Updating

```bash
docker compose pull
docker compose up -d
```

The database schema migrates automatically on startup.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Svelte 4, svelte-spa-router, Vite, PWA (service worker) |
| Backend | Node.js, Express, better-sqlite3 |
| Auth | JWT (httpOnly cookie), bcryptjs |
| Container | Docker, multi-stage Dockerfile |
| CI/CD | GitHub Actions → GitHub Container Registry |

---

## API Integrations

All external API calls are proxied server-side — no keys are exposed to the browser.

- **[Open Food Facts](https://world.openfoodfacts.org/)** — free barcode/food search (no key required)
- **[USDA FoodData Central](https://fdc.nal.usda.gov/)** — US food database (free API key required)
- **[Mealie](https://mealie.io/)** — self-hosted recipe manager integration

---

## License

MIT
