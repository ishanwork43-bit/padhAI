# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 HF_HOME=/opt/padhai-model \
    HF_HUB_DISABLE_TELEMETRY=1 ANONYMIZED_TELEMETRY=False \
    TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 \
    API_DATABASE_PATH=/data/padhai.sqlite3 PORT=8000
# .dockerignore is an explicit allowlist of public runtime sources only.
COPY . /app/
WORKDIR /app
# One dependency/model layer also works on VFS builders with limited disk space.
# Cache only public, pinned model weights. No notes or credentials enter the image.
RUN useradd --create-home --uid 10001 padhai && \
    mkdir -p /data /opt/padhai-model && \
    python -m pip install --upgrade pip && \
    python -m pip install "torch>=2.6,<3" --index-url https://download.pytorch.org/whl/cpu && \
    python -m pip install -r requirements-api.txt && python -m pip check && \
    python -c "from src.embeddings import LocalEmbedder; LocalEmbedder()" && \
    chown -R padhai:padhai /data /opt/padhai-model
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
USER padhai
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/api/health',timeout=3)"
CMD ["sh", "-c", "exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --no-access-log --no-proxy-headers --timeout-keep-alive 5 --timeout-graceful-shutdown 30"]
