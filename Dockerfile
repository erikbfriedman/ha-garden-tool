ARG BUILD_FROM=ghcr.io/hassio-addons/base:latest
FROM $BUILD_FROM

# Install Python 3 and pip
RUN apk add --no-cache python3 py3-pip

WORKDIR /app

# Install Python dependencies first (layer-cached until requirements change)
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r backend/requirements.txt

# Copy application files
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
