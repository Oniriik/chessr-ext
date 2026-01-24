#!/bin/bash

# Script to restart the remote chess server
# Usage: ./restart-remote-server.sh

set -e

SERVER_IP="135.125.201.246"
SERVER_USER="ubuntu"
SERVER_DIR="/home/ubuntu/chess-server"

echo "🔄 Restarting remote server at $SERVER_IP..."
echo ""

# Use expect to handle SSH password
expect << 'EOF'
set timeout 60
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "cd /home/ubuntu/chess-server && sudo docker compose restart"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo ""
echo "✅ Server restart command sent!"
echo ""
echo "Waiting 5 seconds for server to start..."
sleep 5

echo ""
echo "📊 Checking server status..."

expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker ps | grep chess-stockfish"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo ""
echo "📋 Recent logs:"

expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker logs chess-stockfish-server --tail 10"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo ""
echo "✅ Done! Server should be running now."
echo "🔗 Test with: node test-remote-debug.js"
