#!/usr/bin/env bash
# SeaSentinel startup helper script
set -e

# Navigate to project directory
cd "$(dirname "$0")"

# Activate virtualenv if present
if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
fi

# Run with python or python3
if command -v python &>/dev/null; then
    exec python main.py "$@"
elif command -v python3 &>/dev/null; then
    exec python3 main.py "$@"
else
    echo "Error: Python is not installed or not on PATH."
    exit 1
fi
