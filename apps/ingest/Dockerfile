FROM python:3.11-slim

# libmagic1 — python-magic (sniff.py) shells out to libmagic for file-type
# detection; it isn't a pure-Python dependency.
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY ingest ./ingest
RUN pip install --no-cache-dir .

CMD ["python", "-m", "ingest.worker"]
