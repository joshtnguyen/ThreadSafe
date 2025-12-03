# Backend Dockerfile
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/
COPY run.py .
COPY relay_server_TLS.py .
COPY scheduler.py .

# Create instance directory for SQLite database
RUN mkdir -p instance

# Expose ports
EXPOSE 5000 5001

# Default command (can be overridden in docker-compose)
CMD ["python", "run.py"]
