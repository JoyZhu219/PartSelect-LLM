# Instalily Case Study – PartSelect Chat Assistant (Frontend)

This is the **React-based frontend** for the PartSelect Chat Assistant.  
It provides a conversational UI that communicates with the Node.js backend, displays interactive responses, renders product cards, and supports dynamic user prompts.

---

## Quick Start

### Navigate to frontend folder
```bash
cd frontend
```

### Install dependencies
```bash
npm install
```

### Start the development server
```bash
npm start
```

Frontend runs on **[http://localhost:3000](http://localhost:3000)**

---

## Core Components

| File | Description |
|------|--------------|
| `App.js` | Main application entry point and header layout |
| `components/ChatWindow.js` | Core chat UI component with messages and input |
| `components/ActionButtons.js` | Renders interactive suggestions and input prompts |
| `components/ProductCard.js` | Displays product details (image, rating, compatibility) |
| `api.js` | Handles communication with backend endpoints |

---

## Features

- Interactive chat with typing indicator  
- Dynamic action buttons and prompts  
- Product card grid with “Add to Cart” buttons  
- Context-aware chat session using `sessionId`  
- Markdown rendering with `marked`  
- Smooth animations with `Framer Motion`  
- Local `userId` persistence via `localStorage`  

---

## API Calls

The frontend communicates with the backend using `frontend/src/api.js`:

| Function | Description |
|-----------|--------------|
| `getAIMessage()` | Sends user query to backend `/api/chat` |
| `searchProducts()` | Direct search for parts |
| `checkCompatibility()` | Verifies part ↔ model |
| `healthCheck()` | Confirms backend availability |

---

## Folder Structure

```
frontend/
├── src/
│   ├── App.js / App.css
│   ├── components/
│   │   ├── ChatWindow.js / ChatWindow.css
│   │   ├── ProductCard.js / ProductCard.css
│   │   ├── ActionButtons.js / ActionButtons.css
│   └── api.js
├── public/
└── package.json
```

---

## Example Flow

1. User opens chat → greeted by assistant  
2. User sends “Find parts for my model”  
3. Backend asks for model number → `ActionButtons` shows input  
4. User enters “WDT780SAEM1” → backend returns matching products  
5. UI displays `ProductCard` results dynamically  

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | React 18 |
| Styling | CSS Modules |
| Markdown | Marked |
| Animations | Framer Motion |
| Testing | Jest + React Testing Library |

---