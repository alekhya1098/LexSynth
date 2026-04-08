"""
Pure-Python RAG — no chromadb, no onnxruntime, no torch.
Uses Groq's llama model to generate embeddings via a prompt trick,
and numpy cosine similarity for retrieval.
Persists to a simple JSON file.
"""
import os, json, hashlib
import numpy as np
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

STORE_PATH = os.getenv("VECTOR_STORE_PATH", "./vector_store.json")
_store: list[dict] = []   # [{id, text, metadata, embedding}]
_loaded = False


def _load():
    global _store, _loaded
    if _loaded:
        return
    p = Path(STORE_PATH)
    if p.exists():
        try:
            _store = json.loads(p.read_text())
        except Exception:
            _store = []
    _loaded = True


def _save():
    Path(STORE_PATH).parent.mkdir(parents=True, exist_ok=True)
    Path(STORE_PATH).write_text(json.dumps(_store))


def _embed_text(text: str) -> list[float]:
    """
    Simple TF-IDF-style bag-of-words embedding (no external model needed).
    Fast, deterministic, works offline.
    """
    import re
    words = re.findall(r'\b[a-z]{3,}\b', text.lower())
    vocab: dict[str, float] = {}
    for w in words:
        vocab[w] = vocab.get(w, 0) + 1
    if not vocab:
        return [0.0] * 128
    # Hash each word to a 128-dim bucket
    vec = [0.0] * 128
    for w, count in vocab.items():
        idx = int(hashlib.md5(w.encode()).hexdigest(), 16) % 128
        vec[idx] += count
    # L2 normalize
    norm = sum(x*x for x in vec) ** 0.5
    if norm > 0:
        vec = [x / norm for x in vec]
    return vec


def _cosine(a: list[float], b: list[float]) -> float:
    na, nb = np.array(a), np.array(b)
    denom = np.linalg.norm(na) * np.linalg.norm(nb)
    if denom == 0:
        return 0.0
    return float(np.dot(na, nb) / denom)


def add_documents(docs: list[dict]) -> int:
    _load()
    existing_ids = {d["id"] for d in _store}
    added = 0
    for doc in docs:
        if doc["id"] in existing_ids:
            continue
        embedding = _embed_text(doc["text"])
        _store.append({
            "id": doc["id"],
            "text": doc["text"],
            "metadata": doc.get("metadata", {}),
            "embedding": embedding,
        })
        added += 1
    if added:
        _save()
    return added


def retrieve(query: str, top_k: int = 6) -> list[dict]:
    _load()
    if not _store:
        return []
    q_emb = _embed_text(query)
    scored = [
        (d, _cosine(q_emb, d["embedding"]))
        for d in _store
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [
        {"text": d["text"], "metadata": d["metadata"], "score": round(score, 4)}
        for d, score in scored[:top_k]
        if score > 0.05
    ]


def collection_count() -> int:
    _load()
    return len(_store)
