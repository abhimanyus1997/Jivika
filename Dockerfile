# syntax=docker/dockerfile:1

# --- Frontend: site pages and app -> frontend/dist ---------------------------
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Build-time values baked into the HTML (defaults match frontend/.env).
ARG VITE_SITE_URL=https://jivika.abhimanyu.fyi
ARG VITE_CONTACT_EMAIL=abhimanyus1997@gmail.com
ARG VITE_COMPANY_NAME=Jivika
ENV VITE_SITE_URL=$VITE_SITE_URL VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL VITE_COMPANY_NAME=$VITE_COMPANY_NAME
RUN npm run build

# --- Runtime: FastAPI serving the API and the built frontend ----------------
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
WORKDIR /app
COPY pyproject.toml uv.lock ./
# WITH_DOCLING=1 adds layout-aware parsing (DOCX, image OCR); it makes the image much larger.
ARG WITH_DOCLING=0
RUN uv sync --frozen --no-dev --no-install-project $([ "$WITH_DOCLING" = "1" ] && echo "--extra docling")
COPY main.py ./
COPY jivika/ ./jivika/
COPY --from=frontend /src/frontend/dist ./frontend/dist

RUN useradd --system --uid 10001 --no-create-home jivika \
    && mkdir -p /data && chown jivika /data
USER jivika
VOLUME /data
ENV JIVIKA_DB_PATH=/data/jivika.db
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '8000') + '/api/health', timeout=4)"
# Shell form so platforms that set $PORT (Railway, Render) work without extra configuration.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
