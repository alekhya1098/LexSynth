# ⚖️ LexSynth — Multi-Model Legal Research Synthesizer

A full-stack AI legal research tool that takes a legal question, searches the web, retrieves relevant case law via RAG, analyzes from multiple angles using IRAC reasoning, and synthesizes everything into a structured legal memo.

Live Application Link: https://lex-synth.vercel.app/
-------
Video Demo of Application: https://drive.google.com/file/d/19CPwTJ2AoxSqGc9iMViXh2NImjB_DPyl/view?usp=sharing
---

## Architecture

```
Browser (HTML/CSS/JS)
  │
  ├── WebSocket streaming  ──►  FastAPI Backend (Python)
  │                                  │
  │                                  ├── Groq LLM (llama-3.3-70b)
  │                                  ├── ChromaDB (vector store)
  │                                  ├── BGE-M3 embeddings (via chromadb default EF)
  │                                  ├── CaseLaw Access Project API
  │                                  ├── CourtListener API
  │                                  └── SQLite (session history)
  │
  └── Direct mode (fallback when backend offline)
        └── Groq API directly from browser
```

---

## Features

| Feature | Description |
|---|---|
| Multi-angle analysis | 5 IRAC-structured angles: Statutory, Case Law, Practical, Counter-Arguments, Recent Developments |
| RAG pipeline | ChromaDB + BGE-M3 embeddings, retrieves real case law chunks |
| WebSocket streaming | Angles appear live as each completes |
| Contradiction detector | LLM pass flags disagreements between angles |
| Accuracy assessment | 4-metric confidence scoring with visual bars |
| RAGAS evaluation | LLM-based faithfulness, relevancy, context precision scoring |
| Query history | SQLite persistence, reload any past session |
| Confidence trend chart | Canvas chart of accuracy scores over time |
| Multi-question compare | Side-by-side comparison of two legal questions |
| Follow-up questions | Chat interface using memo as context |
| Plain English summary | Rewrites memo for non-lawyers |
| Speech to text | Web Speech API, continuous mode with auto-restart |
| Jurisdiction auto-detect | Detects jurisdiction keywords in the question |
| PDF export | Print-formatted memo via window.print() |
| Share link | Base64-encoded memo in URL hash, no backend needed |
| Dark / light mode | Persisted to localStorage |
| API key persistence | Optional localStorage save |
| Mobile responsive | Full mobile layout |

---

## Stack

**Frontend**
- Vanilla HTML/CSS/JS — no framework, no build step
- Web Speech API for voice input
- Canvas API for trend chart
- WebSocket for streaming

**Backend**
- FastAPI + uvicorn
- Groq SDK (llama-3.3-70b-versatile)
- ChromaDB (persistent vector store)
- SQLite via Python stdlib
- httpx for async HTTP

**Data Sources**
- [CaseLaw Access Project](https://case.law) — 6M+ US court opinions (free API)
- [CourtListener](https://www.courtlistener.com) — federal and state court opinions (free)
- [Serper.dev](https://serper.dev) — Google search API (optional, 2500 free/month)

---

## Setup

### 1. Backend

```bash
cd legal-synthesizer/backend
cp .env.example .env
# Edit .env — add your GROQ_API_KEY
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend

```bash
open legal-synthesizer/index.html
```

No build step. Open directly in Chrome or Edge.

### 3. API Keys

| Key | Where to get | Required? |
|---|---|---|
| Groq API key (`gsk_...`) | [console.groq.com](https://console.groq.com) | Yes |
| Serper API key | [serper.dev](https://serper.dev) | No (falls back to LLM-simulated sources) |
| CaseLaw API key | [case.law](https://case.law/user/register/) | No (anonymous access works, limited) |

---

## Environment Variables

```env
GROQ_API_KEY=gsk_...
CASELAW_API_KEY=...        # optional
CHROMA_PATH=./chroma_db    # where ChromaDB stores vectors
EMBED_MODEL=BAAI/bge-m3    # embedding model
LLM_MODEL=llama-3.3-70b-versatile
HISTORY_DB=./history.db    # SQLite path
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | Health check + vector DB stats |
| POST | `/api/research` | Full RAG pipeline (REST fallback) |
| WS | `/ws/research` | Streaming research via WebSocket |
| POST | `/api/ingest` | Fetch + index legal docs into ChromaDB |
| POST | `/api/plain-english` | Simplify memo for non-lawyers |
| POST | `/api/followup` | Answer follow-up using memo context |
| POST | `/api/evaluate` | RAGAS-style evaluation |
| GET | `/api/history` | List past sessions |
| GET | `/api/history/{id}` | Get a specific session |
| DELETE | `/api/history/{id}` | Delete a session |

---

## How RAG Works

1. User enters a legal question
2. Backend fetches relevant cases from CaseLaw + CourtListener
3. Cases are chunked (~800 chars with overlap) and upserted into ChromaDB
4. At query time, ChromaDB retrieves top-k semantically similar chunks
5. Retrieved chunks are injected into each angle's IRAC prompt as `[R1]`, `[R2]` citations
6. The LLM grounds its analysis in real retrieved documents rather than hallucinating

---

## License

MIT — free to use, modify, and build on.

> ⚠️ This tool is for research and educational purposes only. It does not constitute legal advice. Always consult a licensed attorney for legal matters.
