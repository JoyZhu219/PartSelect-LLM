# Instalily Case Study – PartSelect Chat Assistant

This project is an intelligent appliance parts assistant that helps users find, verify, and install replacement parts for refrigerators and dishwashers.  
It integrates a conversational AI (OpenAI + DeepSeek fallback), PostgreSQL vector search for products, Redis context memory, and a responsive React frontend with product cards and action buttons.

---

## Quick Start

### Clone the repo
```bash
git clone https://github.com/JoyZhu219/PartSelect-LLM.git
cd partselect-assistant
```

### Setup environment
Create `.env` files for both `backend/`:

**backend/.env**
```
DATABASE_URL=postgresql://user:password@localhost:5432/partselect
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-your-key
PORT=3001
```
---

### Start backend
```bash
cd backend
npm install
npm run dev
```
Server runs on [http://localhost:3001](http://localhost:3001)

### Start frontend
```bash
cd frontend
npm install
npm start
```
App runs on [http://localhost:3000](http://localhost:3000)

---

## Features

- Conversational AI assistant powered by OpenAI + DeepSeek
- Multi-agent orchestration (intent, product, compatibility, troubleshooting, installation, order support)
- Context-aware Redis memory for continuity
- PostgreSQL product + vector search with embeddings
- OpenTelemetry + Prometheus metrics
- Modern React UI with live chat, product cards, and actionable prompts

---

## Demo Use Cases

| Query | What happens |
|-------|---------------|
| “Find parts for my Whirlpool WDT780SAEM1” | Detects model → returns matching parts |
| “Is PS11752778 compatible with WDT780SAEM1?” | Runs DB compatibility check |
| “My ice maker isn’t working” | Runs troubleshooting agent |
| “How do I install PS11757304?” | Returns installation guide, tools, and video |

---

## Tech Stack

| Layer | Tools |
|--------|--------|
| Frontend | React 18, Marked, Framer Motion |
| Backend | Node.js (Express), PostgreSQL, Redis |
| AI | OpenAI GPT-4o, DeepSeek fallback |
| Observability | OpenTelemetry, Prometheus |
| DevOps | Nodemon, Jest tests, Docker optional |

---

## System Design Overview

The system follows a modular, microservice-inspired architecture:

- **Frontend (React)** handles user interaction, chat streaming, and product rendering.  
- **Backend (Express + Node.js)** orchestrates multiple AI agents (intent, product search, troubleshooting) and manages context through Redis.
- **Database Layer (PostgreSQL)** stores structured product, compatibility, and conversation data.
- **AI Layer (OpenAI + DeepSeek)** powers dynamic reasoning, with a fallback mechanism for cost efficiency.
- **Telemetry Layer (OpenTelemetry + Prometheus)** provides distributed tracing and performance metrics.

This design enables real-time, conversational part discovery with a resilient, observable backend.

---

## Contributors

- **Joy (Yizhi) Zhu** — Full-Stack Developer  
- Instalily Case Study for **PartSelect** AI integration

---
