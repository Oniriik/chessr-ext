#!/bin/bash

# Script to update remote server from Git repository
# Usage: ./update-remote-server.sh

set -e

SERVER_IP="135.125.201.246"
SERVER_USER="ubuntu"
SERVER_DIR="/home/ubuntu/chess-server"
GIT_REPO="git@github.com:Oniriik/chessr-ext.git"

echo "🔄 Updating remote server from Git repository..."
echo "📍 Server: $SERVER_IP"
echo "📂 Directory: $SERVER_DIR"
echo "🔗 Repository: $GIT_REPO"
echo ""

# Check if Git is configured
echo "🔍 Checking if Git is configured on remote server..."
GIT_CHECK=$(expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "\[ -d /home/ubuntu/chess-server/.git \] && echo 'GIT_OK' || echo 'GIT_NOT_CONFIGURED'"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF
)

if ! echo "$GIT_CHECK" | grep -q "GIT_OK"; then
    echo ""
    echo "❌ Git repository not configured on remote server!"
    echo ""
    echo "Please run the setup script first:"
    echo "   ./setup-git-remote.sh"
    echo ""
    exit 1
fi

echo "✅ Git repository found"
echo ""

# Step 1: Check Git repository status
echo "📋 Step 1/4: Checking Git repository status..."
expect << 'EOF'
set timeout 30
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "cd /home/ubuntu/chess-server && git remote -v && git status"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF
echo ""

# Step 2: Pull latest changes from Git
echo "📥 Step 2/4: Pulling latest changes from Git..."
expect << 'EOF'
set timeout 60
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "cd /home/ubuntu/chess-server && git fetch origin && git pull origin master"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect {
            "Already up to date" {
                puts "\n✅ Repository is already up to date"
            }
            "Updating" {
                puts "\n✅ Changes pulled successfully"
            }
            eof
        }
    }
    eof
}
EOF
echo ""

# Step 3: Rebuild and restart Docker containers
echo "🐳 Step 3/4: Rebuilding and restarting Docker containers..."
expect << 'EOF'
set timeout 120
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "cd /home/ubuntu/chess-server && sudo docker compose down && sudo docker compose up --build -d"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect {
            "Started" {
                puts "\n✅ Containers restarted successfully"
            }
            eof
        }
    }
    eof
}
EOF
echo ""

# Step 4: Verify deployment
echo "✅ Step 4/4: Verifying deployment..."
sleep 5

expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker ps && echo '\n--- Recent logs ---' && sudo docker logs chess-stockfish-server --tail 20"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo ""
echo "🎉 Update complete!"
echo "🔗 Server is running at wss://ws.chessr.io"
echo "🧪 Test with: node test-remote-debug.js"
echo ""
echo "💡 Tip: Run './view-remote-logs.sh' to see full logs"
echo "💡 Tip: Run './check-server-status.sh' to verify status"
echo ""
