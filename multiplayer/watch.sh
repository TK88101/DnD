#!/bin/bash
INBOX="/Users/ibridgezhao/Documents/DnD/multiplayer/inbox-05084341.json"
LAST=""
while true; do
  CONTENT=$(cat "$INBOX" 2>/dev/null)
  if [ "$CONTENT" != "[]" ] && [ "$CONTENT" != "" ] && [ "$CONTENT" != "$LAST" ]; then
    LAST="$CONTENT"
    echo "NEW_MESSAGE"
    exit 0
  fi
  sleep 1
done
