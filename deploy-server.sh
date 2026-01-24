#!/bin/bash

# Script to deploy server updates to remote server
# Usage: ./deploy-server.sh

set -e

SERVER_IP="135.125.201.246"
SERVER_USER="ubuntu"
SERVER_DIR="/home/ubuntu/chess-server"

echo "🚀 Deploying server to $SERVER_IP..."
echo ""

# Step 1: Build locally
echo "📦 Step 1/5: Building server locally..."
cd /Users/timothe/dev/chess/server
npm run build
echo "✅ Build complete"
echo ""

# Step 2: Create archive
echo "📦 Step 2/5: Creating deployment archive..."
tar -czf /tmp/server-deploy.tar.gz src/ dist/ package.json package-lock.json tsconfig.json
echo "✅ Archive created"
echo ""

# Step 3: Upload to server
echo "📤 Step 3/5: Uploading to server..."
expect << 'EOF'
set timeout 60
spawn scp -o StrictHostKeyChecking=no /tmp/server-deploy.tar.gz ubuntu@135.125.201.246:/tmp/

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF
echo "✅ Upload complete"
echo ""

# Step 4: Extract and rebuild on server
echo "🔧 Step 4/5: Extracting and rebuilding on server..."
expect << 'EOF'
set timeout 120
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "cd /home/ubuntu/chess-server && tar -xzf /tmp/server-deploy.tar.gz && sudo docker compose down && sudo docker compose up --build -d"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect {
            "Started" {
                puts "\n✅ Container started"
            }
            eof
        }
    }
    eof
}
EOF
echo ""

# Step 5: Verify deployment
echo "✅ Step 5/5: Verifying deployment..."
sleep 5

expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo docker logs chess-stockfish-server --tail 15"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo ""
echo "🎉 Deployment complete!"
echo "🔗 Server is running at wss://ws.chessr.io"
echo "🧪 Test with: node test-remote-debug.js"
echo ""

# Cleanup
rm -f /tmp/server-deploy.tar.gz
