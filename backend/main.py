"""
LexSynth Backend — FastAPI v3
New: WebSocket streaming, SQLite history, contradiction detection, dedup
"""
from __future__ import annotations
import json, asyncio, os, re
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from rag import retrieve, collection_count, add_documents
    from ingest import ingest_for_query
    RAG_AVAILABLE = True
except Exception as e:
    print(f"[RAG] Unavailable: {e}")
    RAG_AVAILABLE = False
    def retrieve(*a, **k): return []
    def collection_count(): return 0
    async def ingest_for_query(*a, **k): return {"indexed": 0, "errors": ["RAG unavailable"]}

from llm import call_llm, build_angle_prompt, build_memo_prompt, build_accuracy_prompt, get_client
from evaluate import evaluate_rag
from history import save_session, list_sessions, get_session, delete_session

load_dotenv()

app = FastAPI(title="LexSynth API", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ANGLE_LABELS = {
    "statutory":       "📜 Statutory",
    "caselaw":         "⚖️ Case Law",
    "practical":       "🏢 Practical",
    "counterargument": "🔄 Counter-Arguments",
    "recent":          "🆕 Recent Developments",
}

# ── Models ───────────────────────────────────────────────────────────────────
class ResearchRequest(BaseModel):
    question: str
    jurisdiction: str = "General / Federal (US)"
    angles: list[str] = ["statutory", "caselaw", "practical", "counterargument", "recent"]
    web_sources: list[dict] = []
    api_key: str = ""
    top_k: int = 6

class IngestRequest(BaseModel):
    query: str
    jurisdiction: str = ""
    max_per_source: int = 8

class EvaluateRequest(BaseModel):
    question: str
    answer: str
    contexts: list[str]
    ground_truth: str = ""
    api_key: str = ""

class PlainEnglishRequest(BaseModel):
    memo: str
    question: str
    api_key: str = ""

class ContradictionRequest(BaseModel):
    angles: list[dict]
    api_key: str = ""

class FollowupRequest(BaseModel):
    question: str
    memo: str
    followup: str
    jurisdiction: str = ""
    api_key: str = ""

# ── Request queue (prevents simultaneous Groq calls hitting TPM) ─────────────
import asyncio as _asyncio
_queue: _asyncio.Queue = _asyncio.Queue()
_queue_worker_started = False

async def _queue_worker():
    while True:
        fn = await _queue.get()
        try:
            await fn()
        except Exception:
            pass
        finally:
            _queue.task_done()

@app.on_event("startup")
async def startup():
    global _queue_worker_started
    if not _queue_worker_started:
        _asyncio.create_task(_queue_worker())
        _queue_worker_started = True

# ── Health ───────────────────────────────────────────────────────────────────
@app.get("/api/status")
async def status():
    try: count = collection_count()
    except Exception: count = 0
    return {
        "status": "ok",
        "vector_db": "pure-python (numpy)",
        "embed_model": "bag-of-words (no external model)",
        "llm_model": os.getenv("LLM_MODEL", "llama-3.3-70b-versatile"),
        "indexed_chunks": count,
        "rag_available": RAG_AVAILABLE,
    }

# ── Ingest ───────────────────────────────────────────────────────────────────
@app.post("/api/ingest")
async def ingest(req: IngestRequest):
    return await ingest_for_query(req.query, req.jurisdiction, req.max_per_source)

# ── REST research (non-streaming fallback) ───────────────────────────────────
@app.post("/api/research")
async def research(req: ResearchRequest):
    if not req.api_key and not os.getenv("GROQ_API_KEY"):
        raise HTTPException(400, "Groq API key required")
    if not req.question or len(req.question.strip()) < 10:
        raise HTTPException(422, "Question must be at least 10 characters")
    if len(req.question) > 2000:
        raise HTTPException(422, "Question must be under 2000 characters")
    if not req.angles:
        raise HTTPException(422, "At least one research angle required")

    source_text = "\n\n".join(
        f"[{s['num']}] {s['title']}\n{s['url']}\n{s.get('snippet','')}"
        for s in req.web_sources
    )
    try: rag_chunks = retrieve(req.question, top_k=req.top_k)
    except Exception: rag_chunks = []

    angle_results = []
    for angle_id in req.angles:
        messages = build_angle_prompt(angle_id, req.question, req.jurisdiction, rag_chunks, source_text)
        try: text = await call_llm(messages, req.api_key, max_tokens=1024)
        except Exception as e: text = f"Analysis unavailable: {e}"
        angle_results.append({"id": angle_id, "label": ANGLE_LABELS.get(angle_id, angle_id), "text": text})
        await asyncio.sleep(4)

    acc_messages = build_accuracy_prompt(req.question, req.jurisdiction, source_text, angle_results)
    try:
        acc_raw = await call_llm(acc_messages, req.api_key, max_tokens=512)
        accuracy = json.loads(_strip_json(acc_raw))
    except Exception: accuracy = _fallback_accuracy()

    memo_messages = build_memo_prompt(req.question, req.jurisdiction, angle_results)
    try: memo = await call_llm(memo_messages, req.api_key, max_tokens=2048)
    except Exception as e: memo = f"Memo generation failed: {e}"

    session_id = save_session(req.question, req.jurisdiction, memo, accuracy, angle_results, req.web_sources)

    return {
        "angles": angle_results, "accuracy": accuracy, "memo": memo,
        "rag_chunks": rag_chunks, "rag_count": len(rag_chunks),
        "session_id": session_id,
    }

# ── WebSocket streaming research ─────────────────────────────────────────────
@app.websocket("/ws/research")
async def ws_research(websocket: WebSocket):
    await websocket.accept()
    try:
        raw = await websocket.receive_text()
        req = ResearchRequest(**json.loads(raw))

        async def send(event: str, data: dict):
            await websocket.send_text(json.dumps({"event": event, **data}))

        api_key = req.api_key or os.getenv("GROQ_API_KEY", "")
        if not api_key:
            await send("error", {"message": "Groq API key required"})
            return

        source_text = "\n\n".join(
            f"[{s['num']}] {s['title']}\n{s['url']}\n{s.get('snippet','')}"
            for s in req.web_sources
        )

        await send("step", {"step": "search", "state": "done", "detail": f"{len(req.web_sources)} sources"})
        await send("step", {"step": "extract", "state": "done"})

        # RAG
        try: rag_chunks = retrieve(req.question, top_k=req.top_k)
        except Exception: rag_chunks = []
        if rag_chunks:
            await send("rag_chunks", {"chunks": rag_chunks})

        # Angles — stream each one as it completes
        await send("step", {"step": "angles", "state": "active"})
        angle_results = []
        for i, angle_id in enumerate(req.angles):
            await send("angle_progress", {"done": i, "total": len(req.angles)})
            messages = build_angle_prompt(angle_id, req.question, req.jurisdiction, rag_chunks, source_text)
            try: text = await call_llm(messages, api_key, max_tokens=1024)
            except Exception as e: text = f"Analysis unavailable: {e}"
            result = {"id": angle_id, "label": ANGLE_LABELS.get(angle_id, angle_id), "text": text}
            angle_results.append(result)
            await send("angle_done", {"angle": result, "done": i + 1, "total": len(req.angles)})
            if i < len(req.angles) - 1:
                await asyncio.sleep(4)

        await send("step", {"step": "angles", "state": "done", "detail": f"{len(req.angles)} angles"})

        # Contradiction detection
        contradictions = await _detect_contradictions(angle_results, api_key)
        if contradictions:
            await send("contradictions", {"items": contradictions})

        # Accuracy
        await send("step", {"step": "accuracy", "state": "active"})
        acc_messages = build_accuracy_prompt(req.question, req.jurisdiction, source_text, angle_results)
        try:
            acc_raw = await call_llm(acc_messages, api_key, max_tokens=512)
            accuracy = json.loads(_strip_json(acc_raw))
        except Exception: accuracy = _fallback_accuracy()
        await send("accuracy", {"data": accuracy})
        await send("step", {"step": "accuracy", "state": "done"})

        # Memo
        await send("step", {"step": "memo", "state": "active"})
        memo_messages = build_memo_prompt(req.question, req.jurisdiction, angle_results)
        try: memo = await call_llm(memo_messages, api_key, max_tokens=2048)
        except Exception as e: memo = f"Memo generation failed: {e}"
        await send("step", {"step": "memo", "state": "done"})

        session_id = save_session(req.question, req.jurisdiction, memo, accuracy, angle_results, req.web_sources)
        await send("done", {"memo": memo, "session_id": session_id})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try: await websocket.send_text(json.dumps({"event": "error", "message": str(e)}))
        except Exception: pass

# ── Plain English summary ─────────────────────────────────────────────────────
@app.post("/api/plain-english")
async def plain_english(req: PlainEnglishRequest):
    api_key = req.api_key or os.getenv("GROQ_API_KEY", "")
    prompt = f"""Rewrite the following legal research memo in plain, simple English for someone with no legal background.
Use short sentences. Avoid jargon. Explain what it means practically for the person asking.
Keep it under 300 words. Start with a one-sentence direct answer.

Original question: {req.question}

Memo:
{req.memo[:3000]}"""
    try:
        text = await call_llm([{"role": "user", "content": prompt}], api_key, max_tokens=512)
        return {"summary": text}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Contradiction detection ───────────────────────────────────────────────────
@app.post("/api/contradictions")
async def contradictions(req: ContradictionRequest):
    api_key = req.api_key or os.getenv("GROQ_API_KEY", "")
    items = await _detect_contradictions(req.angles, api_key)
    return {"contradictions": items}

async def _detect_contradictions(angle_results: list[dict], api_key: str) -> list[dict]:
    if len(angle_results) < 2:
        return []
    angles_text = "\n\n".join(f"=== {a['label']} ===\n{a['text'][:600]}" for a in angle_results)
    prompt = f"""You are a legal analyst. Review these research angles and identify any direct contradictions or significant disagreements between them.

{angles_text}

Respond ONLY with a JSON array (empty array if no contradictions):
[{{"angle1":"label","angle2":"label","issue":"what they disagree on","severity":"high"|"medium"|"low"}}]"""
    try:
        raw = await call_llm([{"role": "user", "content": prompt}], api_key, max_tokens=512)
        return json.loads(raw.strip().lstrip("```json").rstrip("```").strip())
    except Exception:
        return []

# ── History endpoints ─────────────────────────────────────────────────────────
@app.get("/api/history")
async def get_history(limit: int = 50):
    return {"sessions": list_sessions(limit)}

@app.get("/api/history/{session_id}")
async def get_history_session(session_id: int):
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session

@app.delete("/api/history/{session_id}")
async def delete_history_session(session_id: int):
    delete_session(session_id)
    return {"ok": True}

# ── Follow-up questions ───────────────────────────────────────────────────────
@app.post("/api/followup")
async def followup(req: FollowupRequest):
    api_key = req.api_key or os.getenv("GROQ_API_KEY", "")
    if not api_key:
        raise HTTPException(400, "API key required")
    prompt = f"""You are a legal research assistant. The user has read the following legal research memo and has a follow-up question.

Original question: {req.question}
Jurisdiction: {req.jurisdiction}

Memo summary (first 2000 chars):
{req.memo[:2000]}

Follow-up question: {req.followup}

Answer the follow-up question directly and concisely, referencing the memo context where relevant. Be specific."""
    try:
        text = await call_llm([{"role": "user", "content": prompt}], api_key, max_tokens=768)
        return {"answer": text}
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Evaluate ─────────────────────────────────────────────────────────────────
@app.post("/api/evaluate")
async def evaluate(req: EvaluateRequest):
    return await evaluate_rag(req.question, req.answer, req.contexts, req.ground_truth, req.api_key)

# ── Helpers ───────────────────────────────────────────────────────────────────
def _strip_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()

def _fallback_accuracy():
    return {
        "confidence": "medium", "verdict": "Accuracy assessment unavailable.",
        "source_agreement": {"score": 50, "note": "N/A"},
        "legal_certainty": {"score": 50, "note": "N/A"},
        "jurisdiction_clarity": {"score": 50, "note": "N/A"},
        "recency": {"score": 50, "note": "N/A"},
        "caveats": "Consult a licensed attorney.",
    }
