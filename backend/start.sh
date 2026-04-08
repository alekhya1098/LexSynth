#!/bin/bash
# LexSynth Backend Startup Script

echo "🔧 Setting up LexSynth RAG backend..."

# Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 Created .env — add your GROQ_API_KEY to it"
fi

# Install dependencies
echo "📦 Installing dependencies..."
pip install -r requirements.txt

# Start server
echo "🚀 Starting FastAPI server on http://localhost:8000"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
