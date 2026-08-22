# syntax=docker/dockerfile:1.7

FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

FROM base AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential gcc \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

FROM base AS production
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos '' appuser
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app
COPY . .
RUN chown -R appuser:appuser /app
USER appuser
EXPOSE 8500
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${GITOPS_WEBHOOK_PORT:-8500}/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["python", "main.py"]
