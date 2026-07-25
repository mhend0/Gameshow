#!/bin/bash
# Double-click this file to start Trivia Night.
# It launches a tiny local web server and opens the CONTROL window.

cd "$(dirname "$0")" || exit 1
PORT=8777

# Start the server only if it isn't already running on this port.
if ! curl -s "http://localhost:$PORT/index.html" >/dev/null 2>&1; then
  echo "Starting local server on port $PORT..."
  # Prefer python3, fall back to python
  if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server $PORT >/dev/null 2>&1 &
  else
    python -m SimpleHTTPServer $PORT >/dev/null 2>&1 &
  fi
  sleep 1
else
  echo "Server already running."
fi

# Open the Game Show Studio home screen in the default browser.
open "http://localhost:$PORT/home.html"

echo ""
echo "======================================================"
echo "  Trivia Night is running."
echo "  Control window opened in your browser."
echo ""
echo "  Click 'Open TV Display' to open the TV window,"
echo "  then drag it to your TV and press Fullscreen."
echo ""
echo "  You can CLOSE this Terminal window when you're"
echo "  completely finished (it stops the server)."
echo "======================================================"
