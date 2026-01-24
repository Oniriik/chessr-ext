#!/bin/bash

# Script to check remote server status
# Usage: ./check-server-status.sh

set -e

echo "🔍 Checking remote server status..."
echo ""

# Check Docker container
echo "📦 Docker container status:"
expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker ps -a | grep chess"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo ""
echo "📊 Server health:"
expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker inspect chess-stockfish-server --format='Status: {{.State.Status}} | Health: {{.State.Health.Status}} | Uptime: {{.State.StartedAt}}'"

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
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker logs chess-stockfish-server --tail 5"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo ""
echo "🧪 Testing WebSocket connection..."
cd /Users/timothe/dev/chess
timeout 10s node test-remote-debug.js 2>&1 | head -20 || true

echo ""
echo "✅ Status check complete!"
