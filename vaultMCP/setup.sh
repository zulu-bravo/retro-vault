#!/bin/bash
set -e

# Always run from the directory this script lives in
cd "$(dirname "$0")"

PYTHON=$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)

if [ -z "$PYTHON" ]; then
  echo "ERROR: Python 3.10+ not found."
  exit 1
fi

VERSION=$($PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "Using Python $VERSION at $PYTHON"

# Create virtual environment if it doesn't exist
if [ ! -d .venv ]; then
  $PYTHON -m venv .venv
  echo "Virtual environment created."
fi

# Install dependencies
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install "mcp[cli]" requests python-dotenv
echo "Dependencies installed."

# Copy .env if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "Created .env from .env.example — open it and fill in your Vault credentials."
else
  echo ".env already exists, skipping."
fi

echo "Setup complete."
