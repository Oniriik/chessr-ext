#!/bin/bash

# Script to setup Git access on the remote server
# Usage: ./setup-git-remote.sh

set -e

SERVER_IP="135.125.201.246"
SERVER_USER="ubuntu"
SERVER_DIR="/home/ubuntu/chess-server"
GIT_REPO="git@github.com:Oniriik/chessr-ext.git"

echo "🔧 Setting up Git access on remote server..."
echo "📍 Server: $SERVER_IP"
echo "🔗 Repository: $GIT_REPO"
echo ""

# Step 1: Install Git if not present
echo "📦 Step 1/5: Installing Git (if needed)..."
expect << 'EOF'
set timeout 30
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "sudo apt-get update && sudo apt-get install -y git"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF
echo "✅ Git installed"
echo ""

# Step 2: Generate SSH key if not exists
echo "🔑 Step 2/5: Generating SSH key for GitHub access..."
expect << 'EOF'
set timeout 30
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "if \[ ! -f ~/.ssh/id_ed25519 \]; then ssh-keygen -t ed25519 -C 'ubuntu@chess-server' -f ~/.ssh/id_ed25519 -N ''; else echo 'SSH key already exists'; fi"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF
echo "✅ SSH key ready"
echo ""

# Step 3: Display public key
echo "📋 Step 3/5: Displaying public SSH key..."
echo ""
echo "⚠️  IMPORTANT: Copy this SSH key and add it to GitHub:"
echo "   1. Go to: https://github.com/settings/keys"
echo "   2. Click 'New SSH key'"
echo "   3. Title: 'Chess Server (135.125.201.246)'"
echo "   4. Paste the key below:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

expect << 'EOF'
set timeout 15
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "cat ~/.ssh/id_ed25519.pub"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect eof
    }
    eof
}
EOF

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Press ENTER once you have added the SSH key to GitHub..."
echo ""

# Step 4: Test GitHub connection
echo "🧪 Step 4/5: Testing GitHub connection..."
expect << 'EOF'
set timeout 30
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "ssh -T git@github.com -o StrictHostKeyChecking=no || true"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect {
            "successfully authenticated" {
                puts "\n✅ GitHub connection successful"
            }
            eof
        }
    }
    eof
}
EOF
echo ""

# Step 5: Clone or configure repository
echo "📥 Step 5/5: Setting up repository..."
expect << 'EOF'
set timeout 60
spawn ssh -o StrictHostKeyChecking=no ubuntu@135.125.201.246 "if \[ -d /home/ubuntu/chess-server/.git \]; then echo 'Repository exists, configuring remote...'; cd /home/ubuntu/chess-server && git remote set-url origin git@github.com:Oniriik/chessr-ext.git && git fetch origin; else echo 'Cloning repository...'; git clone git@github.com:Oniriik/chessr-ext.git /home/ubuntu/chess-server; fi"

expect {
    "password:" {
        send "Chess2026SecurePass!\r"
        expect {
            "Cloning into" {
                puts "\n✅ Repository cloned successfully"
            }
            "Repository exists" {
                puts "\n✅ Repository configured"
            }
            eof
        }
    }
    eof
}
EOF
echo ""

# Verify setup
echo "✅ Verifying Git setup..."
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
echo "🎉 Git setup complete!"
echo ""
echo "📝 Summary:"
echo "   - Git installed on remote server"
echo "   - SSH key configured for GitHub"
echo "   - Repository cloned/configured at: $SERVER_DIR"
echo "   - Remote origin set to: $GIT_REPO"
echo ""
echo "🚀 You can now use: ./update-remote-server.sh"
echo ""
