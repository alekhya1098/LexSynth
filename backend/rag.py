"""
RAG layer — ChromaDB vector store with Groq-compatible embeddings
Uses chromadb's built-in embedding function to avoid torch dependency issues.
"""
import os
from pathlib import Path
from dotenv import load_dotenv
import chromadb
from chromadb.utils import embedding_functions

load_dotenv()

CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_db")
COLLECTION  = "legal_docs"

_client = None
_collection = None


def _get_ef():
    """Use chromadb's default sentence-transformers embedding function (no torch needed directly)."""
    return embedding_functions.DefaultEmbeddingFunction()


def get_collection():
    global _client, _collection
    if _collection is None:
        Path(CHROMA_PATH).mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=CHROMA_PATH)
        _collection = _client.get_or_create_collection(
            name=COLLECTION,
            embedding_function=_get_ef(),
        )
    return _collection


def add_documents(docs: list[dict]) -> int:
    col = get_collection()
    ids       = [d["id"] for d in docs]
    texts     = [d["text"] for d in docs]
    metadatas = [d.get("metadata", {}) for d in docs]

    # Upsert in batches of 50
    batch = 50
    for i in range(0, len(docs), batch):
        col.upsert(
            ids=ids[i:i+batch],
            documents=texts[i:i+batch],
            metadatas=metadatas[i:i+batch],
        )
    return len(docs)


def retrieve(query: str, top_k: int = 6) -> list[dict]:
    col = get_collection()
    if col.count() == 0:
        return []
    results = col.query(query_texts=[query], n_results=min(top_k, col.count()))
    chunks = []
    for i, doc in enumerate(results["documents"][0]):
        meta  = results["metadatas"][0][i] if results["metadatas"] else {}
        dist  = results["distances"][0][i] if results["distances"] else 0
        score = round(1 - dist, 4)  # convert distance → similarity
        chunks.append({"text": doc, "metadata": meta, "score": score})
    return chunks


def collection_count() -> int:
    return get_collection().count()
