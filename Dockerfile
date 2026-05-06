FROM python:3.12-slim AS builder

WORKDIR /build

COPY pyproject.toml .
COPY src/ src/

RUN pip wheel . --no-deps -w /dist


FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /dist /dist
RUN pip install /dist/*.whl

RUN mkdir -p /data

ENV CABINET_DATA_DIR=/data
ENV CABINET_LOG_LEVEL=INFO
ENV CABINET_LOG_FORMAT=json
ENV CABINET_OTLP_ENDPOINT=
ENV CABINET_PROMETHEUS_PORT=9090

EXPOSE 8000
EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

ENTRYPOINT ["cabinet", "serve", "--host", "0.0.0.0", "--port", "8000", "--data-dir", "/data"]
