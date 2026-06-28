FROM python:3.11-slim

WORKDIR /app

# Install deps first for layer caching
COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[dev]"

COPY . .

# Run Alembic migrations then start server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
