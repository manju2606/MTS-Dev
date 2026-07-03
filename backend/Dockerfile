FROM python:3.11-slim AS base
WORKDIR /app
COPY pyproject.toml .

# Dev: includes test/lint tools, mounts source via volume for hot-reload
FROM base AS dev
RUN pip install --no-cache-dir -e ".[dev]"
COPY . .
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"]

# Prod: lean image, no dev tools, 1 worker (K8s memory limit is 512Mi)
FROM base AS prod
RUN pip install --no-cache-dir -e "."
COPY . .
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
