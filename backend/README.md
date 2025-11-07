# 🧠 Instalily Case Study – PartSelect Chat Assistant (Backend)

This is the **Node.js + Express backend** for the PartSelect Chat Assistant.  
It handles AI orchestration (OpenAI + DeepSeek), PostgreSQL product database queries, Redis memory context, telemetry, and API endpoints used by the React frontend.

---

## Quick Start

### Navigate to backend folder
```bash
cd backend
```

### Install dependencies
```bash
npm install
```

### Create `.env` file
Create a `.env` file inside the `backend` directory:

```bash
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/partselect
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-your-openai-key
DEEPSEEK_API_KEY=sk-your-deepseek-key
PORT=3001
```

### Setup database
Run PostgreSQL and create your database:
```bash
createdb partselect
psql partselect < schema.sql
psql partselect < seed.sql
```

### Start the server
```bash
npm run dev
```

Backend runs on **[http://localhost:3001](http://localhost:3001)**

---

## API Endpoints

| Method | Endpoint | Description |
|---------|-----------|-------------|
| `POST` | `/api/chat` | Main AI chat endpoint |
| `GET` | `/api/products/search?q=` | Search products by keyword or model |
| `POST` | `/api/compatibility/check` | Check part-model compatibility |
| `GET` | `/api/health` | Health check for monitoring |

---

## Core Components

| File | Description |
|------|--------------|
| `api.js` | Main Express API + AI orchestration logic |
| `db.js` | PostgreSQL connection via `pg` |
| `schema.sql` | Database schema for parts, compatibility, and conversations |
| `seed.sql` | Sample product data for demo |
| `tracing.js` | OpenTelemetry setup for performance tracing |
| `package.json` | Scripts and dependencies |

---

## Architecture

```
User Query → /api/chat → AgentOrchestrator
    ↳ IntentClassificationAgent
    ↳ ProductSearchAgent
    ↳ CompatibilityAgent
    ↳ TroubleshootingAgent
    ↳ InstallationAgent
    ↳ OrderSupportAgent
↓
AI Response → JSON with text, products, and actions
```

---

## Database Structure

- **parts** – stores product info & vector embeddings  
- **part_compatibility** – links parts to appliance models  
- **conversations** – stores chat sessions  
- **messages** – user + assistant messages  

---

## Tech Stack

| Component | Technology |
|------------|-------------|
| Runtime | Node.js 20 + Express |
| Database | PostgreSQL |
| Cache / Memory | Redis |
| AI Providers | OpenAI GPT-4o + DeepSeek |
| Monitoring | OpenTelemetry + Prometheus |
| Testing | Jest |

---

## Example `.env.example`

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/partselect
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-your-openai-key
DEEPSEEK_API_KEY=sk-your-deepseek-key
PORT=3001
```

---
