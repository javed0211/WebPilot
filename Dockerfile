FROM python:3.12-slim

WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY webpilot ./webpilot
COPY framework ./framework
COPY core ./core
COPY config ./config
COPY prompts ./prompts
COPY tests ./tests

RUN pip install --no-cache-dir -e . \
    && python -m playwright install --with-deps chromium

ENTRYPOINT ["webpilot"]
CMD ["doctor"]
