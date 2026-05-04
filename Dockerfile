ARG BUILD_FROM
FROM $BUILD_FROM

# Install Python 3
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Install dependencies in a venv (avoids PEP 668 externally-managed-env errors)
COPY backend/requirements.txt ./backend/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r backend/requirements.txt

# Copy application
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
