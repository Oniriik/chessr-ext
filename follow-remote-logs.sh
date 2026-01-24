#!/bin/bash

# Script to follow remote server logs in real-time
# Usage: ./follow-remote-logs.sh
# Press Ctrl+C to stop

echo "📋 Following remote server logs (Ctrl+C to stop)..."
echo ""

expect << 'EOF'
set timeout -1
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker logs chess-stockfish-server -f"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        interact
    }
    eof
}
EOF
