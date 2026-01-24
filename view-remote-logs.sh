#!/bin/bash

# Script to view remote server logs
# Usage: ./view-remote-logs.sh [lines]
# Example: ./view-remote-logs.sh 50    (show last 50 lines)
#          ./view-remote-logs.sh        (show last 30 lines)

LINES=${1:-30}

echo "📋 Viewing last $LINES lines of remote server logs..."
echo ""

expect << EOF
set timeout 30
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker logs chess-stockfish-server --tail $LINES"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF
