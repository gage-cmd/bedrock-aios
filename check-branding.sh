#!/bin/bash
BANNED="AI Agent|AI Bot|AI Assistant|AI Tool|AI Employee"
MATCHES=$(grep -rniE "$BANNED" apps/dashboard --exclude-dir=node_modules --exclude="client-facing-strings.json")
if [ -n "$MATCHES" ]; then
  echo "Banned client-facing terminology found:"
  echo "$MATCHES"
  exit 1
fi
echo "No banned terms found."
