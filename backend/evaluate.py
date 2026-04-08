"""
RAGAS evaluation — lightweight version using Groq LLM only (no torch required)
Scores: faithfulness, answer_relevancy (LLM-based)
"""
import os
import json
from dotenv import load_dotenv

load_dotenv()


async def evaluate_rag(
    question: str,
    answer: str,
    contexts: list[str],
    ground_truth: str = "",
    groq_api_key: str = "",
) -> dict:
    """LLM-based RAG evaluation without torch/RAGAS dependency."""
    try:
        from groq import AsyncGroq
        key = groq_api_key or os.getenv("GROQ_API_KEY", "")
        if not key:
            return {"status": "error", "reason": "No API key provided"}

        client = AsyncGroq(api_key=key)
        context_text = "\n\n".join(f"[{i+1}] {c}" for i, c in enumerate(contexts[:4]))

        prompt = f"""You are a RAG evaluation expert. Score the following on a 0.0-1.0 scale.

Question: {question}

Retrieved Contexts:
{context_text}

Answer: {answer}

Evaluate and respond ONLY with JSON (no markdown):
{{
  "faithfulness": <0.0-1.0, is the answer grounded in the contexts?>,
  "answer_relevancy": <0.0-1.0, does the answer address the question?>,
  "context_precision": <0.0-1.0, are the retrieved contexts relevant to the question?>,
  "reasoning": "one sentence explanation"
}}"""

        resp = await client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "llama-3.3-70b-versatile"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=256,
        )
        raw = resp.choices[0].message.content
        scores = json.loads(raw.strip().lstrip("```json").rstrip("```"))
        return {
            "faithfulness":      round(float(scores.get("faithfulness", 0)), 3),
            "answer_relevancy":  round(float(scores.get("answer_relevancy", 0)), 3),
            "context_precision": round(float(scores.get("context_precision", 0)), 3),
            "reasoning":         scores.get("reasoning", ""),
            "status": "ok",
        }
    except Exception as e:
        return {"status": "error", "reason": str(e)}
