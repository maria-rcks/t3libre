FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

FROM base AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential gcc \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml .
COPY ipilot/ ./ipilot/
RUN pip install --no-cache-dir .

FROM base AS production
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos '' appuser
COPY --from=build /usr/local /usr/local
RUN ldd /usr/local/bin/ipilot 2>/dev/null || true
USER appuser
ENTRYPOINT ["tini", "--"]
CMD ["ipilot", "--help"]
