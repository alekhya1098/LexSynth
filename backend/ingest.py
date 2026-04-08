"""
Legal data ingestion — CaseLaw Access Project + CourtListener APIs
Fetches cases, chunks them, and indexes into ChromaDB via RAG layer.
"""
import os
import re
import hashlib
import httpx
from dotenv import load_dotenv
from rag import add_documents

load_dotenv()

CASELAW_API_KEY  = os.getenv("CASELAW_API_KEY", "")
CASELAW_BASE     = "https://api.case.law/v1"
COURTLISTENER_BASE = "https://www.courtlistener.com/api/rest/v3"

CHUNK_SIZE = 800   # characters per chunk
CHUNK_OVERLAP = 100


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks."""
    text = re.sub(r'\s+', ' ', text).strip()
    chunks, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        chunks.append(text[start:end])
        start += size - overlap
    return chunks


def make_id(source: str, idx: int) -> str:
    return hashlib.md5(f"{source}_{idx}".encode()).hexdigest()


# ── CaseLaw Access Project ───────────────────────────────────────────────────
async def fetch_caselaw(query: str, jurisdiction: str = "", max_cases: int = 10) -> list[dict]:
    """Fetch cases from case.law API."""
    params = {"search": query, "page_size": max_cases, "full_case": "true"}
    if jurisdiction:
        params["jurisdiction"] = jurisdiction.lower().replace(" ", "-")

    headers = {}
    if CASELAW_API_KEY:
        headers["Authorization"] = f"Token {CASELAW_API_KEY}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{CASELAW_BASE}/cases/", params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    docs = []
    for case in data.get("results", []):
        # Extract opinion text
        opinions = case.get("casebody", {}).get("data", {}).get("opinions", [])
        full_text = " ".join(op.get("text", "") for op in opinions)
        if not full_text:
            full_text = case.get("name", "")

        meta = {
            "source": "caselaw",
            "case_name": case.get("name", ""),
            "citation": case.get("citations", [{}])[0].get("cite", ""),
            "court": case.get("court", {}).get("name", ""),
            "decision_date": case.get("decision_date", ""),
            "url": case.get("url", ""),
            "jurisdiction": case.get("jurisdiction", {}).get("name", ""),
        }

        for i, chunk in enumerate(chunk_text(full_text)):
            docs.append({
                "id": make_id(case.get("id", case.get("name", "")), i),
                "text": chunk,
                "metadata": {**meta, "chunk": i},
            })

    return docs


# ── CourtListener ────────────────────────────────────────────────────────────
async def fetch_courtlistener(query: str, max_results: int = 10) -> list[dict]:
    """Fetch opinions from CourtListener (no API key needed for basic search)."""
    params = {"q": query, "type": "o", "order_by": "score desc", "page_size": max_results}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{COURTLISTENER_BASE}/search/",
            params=params,
            headers={"User-Agent": "LexSynth/1.0 legal-research-tool"}
        )
        resp.raise_for_status()
        data = resp.json()

    docs = []
    for result in data.get("results", []):
        text = result.get("snippet", "") or result.get("caseName", "")
        meta = {
            "source": "courtlistener",
            "case_name": result.get("caseName", ""),
            "citation": result.get("citation", [""])[0] if result.get("citation") else "",
            "court": result.get("court", ""),
            "decision_date": result.get("dateFiled", ""),
            "url": f"https://www.courtlistener.com{result.get('absolute_url', '')}",
            "jurisdiction": result.get("court", ""),
        }
        for i, chunk in enumerate(chunk_text(text)):
            docs.append({
                "id": make_id(result.get("id", result.get("caseName", "")), i),
                "text": chunk,
                "metadata": {**meta, "chunk": i},
            })

    return docs


# ── Main ingest entry point ──────────────────────────────────────────────────
async def ingest_for_query(query: str, jurisdiction: str = "", max_per_source: int = 8) -> dict:
    """
    Fetch from both sources and index into ChromaDB.
    Returns summary of what was ingested.
    """
    all_docs = []
    errors = []

    try:
        cl_docs = await fetch_caselaw(query, jurisdiction, max_per_source)
        all_docs.extend(cl_docs)
        print(f"[Ingest] CaseLaw: {len(cl_docs)} chunks")
    except Exception as e:
        errors.append(f"CaseLaw: {e}")
        print(f"[Ingest] CaseLaw error: {e}")

    try:
        court_docs = await fetch_courtlistener(query, max_per_source)
        all_docs.extend(court_docs)
        print(f"[Ingest] CourtListener: {len(court_docs)} chunks")
    except Exception as e:
        errors.append(f"CourtListener: {e}")
        print(f"[Ingest] CourtListener error: {e}")

    if not all_docs:
        return {"indexed": 0, "errors": errors}

    indexed = add_documents(all_docs)
    return {"indexed": indexed, "sources": len(set(d["metadata"]["source"] for d in all_docs)), "errors": errors}
