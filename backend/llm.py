"""
LLM layer — Groq + chain-of-thought IRAC legal reasoning
"""
import os
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")

_client = None

def get_client(api_key: str = "") -> AsyncGroq:
    global _client
    key = api_key or os.getenv("GROQ_API_KEY", "")
    if not key:
        raise ValueError("GROQ_API_KEY not set")
    # Always create fresh client if key provided at runtime
    if api_key or _client is None:
        _client = AsyncGroq(api_key=key)
    return _client


async def call_llm(messages: list[dict], api_key: str = "", max_tokens: int = 1024) -> str:
    client = get_client(api_key)
    resp = await client.chat.completions.create(
        model=LLM_MODEL,
        messages=messages,
        temperature=0.4,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content


# ── IRAC chain-of-thought prompt builder ────────────────────────────────────
ANGLE_SYSTEM_PROMPTS = {
    "statutory": "You are a statutory law analyst specializing in identifying and interpreting applicable statutes and regulations.",
    "caselaw":   "You are a case law analyst specializing in identifying relevant precedents and judicial trends.",
    "practical": "You are a practical legal advisor focused on real-world compliance, risk, and actionable guidance.",
    "counterargument": "You are a devil's advocate legal analyst identifying exceptions, weaknesses, and opposing arguments.",
    "recent":    "You are a legal trends analyst focused on recent legislative and judicial developments.",
}

def build_angle_prompt(angle_id: str, question: str, jurisdiction: str, rag_chunks: list[dict], web_sources: str) -> list[dict]:
    """Build IRAC chain-of-thought prompt with RAG context."""
    system = ANGLE_SYSTEM_PROMPTS.get(angle_id, "You are a legal analyst.")

    # Format RAG chunks
    rag_context = ""
    if rag_chunks:
        rag_context = "\n\n--- RETRIEVED LEGAL DOCUMENTS (from ChromaDB) ---\n"
        for i, chunk in enumerate(rag_chunks, 1):
            meta = chunk.get("metadata", {})
            rag_context += f"\n[R{i}] {meta.get('case_name','Unknown')} ({meta.get('decision_date','')}) — {meta.get('court','')}\n"
            rag_context += f"Citation: {meta.get('citation','N/A')} | Score: {chunk.get('score',0)}\n"
            rag_context += f"{chunk['text']}\n"

    user_content = f"""Use the IRAC framework to analyze this legal question:

**Issue:** {question}
**Jurisdiction:** {jurisdiction}

{rag_context}

--- WEB SOURCES ---
{web_sources}

Apply IRAC reasoning:
1. ISSUE — Precisely state the legal issue
2. RULE — Identify the applicable law/statute/precedent (cite sources inline as [R1], [R2] for RAG docs or [1],[2] for web sources)
3. APPLICATION — Apply the rule to the facts
4. CONCLUSION — State the conclusion clearly

Be specific with citations. Flag any uncertainty."""

    return [{"role": "system", "content": system}, {"role": "user", "content": user_content}]


def build_memo_prompt(question: str, jurisdiction: str, angle_results: list[dict]) -> list[dict]:
    angles_text = "\n\n".join(f"=== {a['label']} ===\n{a['text']}" for a in angle_results)
    return [{
        "role": "user",
        "content": f"""You are a senior legal analyst. Draft a comprehensive legal research memo using IRAC reasoning throughout.

Legal Question: {question}
Jurisdiction: {jurisdiction}

Research Angles:
{angles_text}

Write a formal memo with:
## MEMORANDUM
## TO / FROM / DATE / RE
## Executive Summary
## Issue Presented
## Short Answer
## Applicable Law (with citations [1],[2] etc.)
## Analysis (IRAC structure)
## Counter-Arguments & Risks
## Recent Developments
## Conclusion & Recommendations
## Disclaimer

Use inline citations [1],[2] referencing the sources. End with: this is not legal advice."""
    }]


def build_accuracy_prompt(question: str, jurisdiction: str, source_text: str, angle_results: list[dict]) -> list[dict]:
    angles = "\n\n".join(f"=== {a['label']} ===\n{a['text']}" for a in angle_results)
    return [{
        "role": "user",
        "content": f"""You are a legal fact-checker. Assess accuracy and reliability.

Legal Question: {question}
Jurisdiction: {jurisdiction}
Sources: {source_text}
Analysis: {angles}

Respond ONLY with JSON (no markdown):
{{
  "confidence": "high"|"medium"|"low",
  "verdict": "2-3 sentence direct answer",
  "source_agreement": {{"score": 0-100, "note": "..."}},
  "legal_certainty": {{"score": 0-100, "note": "..."}},
  "jurisdiction_clarity": {{"score": 0-100, "note": "..."}},
  "recency": {{"score": 0-100, "note": "..."}},
  "caveats": "key warnings"
}}"""
    }]
