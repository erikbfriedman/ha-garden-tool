#!/usr/bin/with-contenv bashio

ANTHROPIC_KEY=$(bashio::config 'anthropic_api_key' '')

export PROJECTS_DIR="/data/projects"
mkdir -p "$PROJECTS_DIR"

if [ -n "$ANTHROPIC_KEY" ]; then
  export ANTHROPIC_API_KEY="$ANTHROPIC_KEY"
  bashio::log.info "Anthropic API key configured — AI art generation enabled"
else
  bashio::log.info "No Anthropic API key — AI art generation disabled"
fi

bashio::log.info "Starting Garden Tool on port 8099"
cd /app && exec /opt/venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8099
