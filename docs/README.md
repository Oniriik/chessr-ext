# Chessr Documentation

Welcome to the Chessr project documentation. This guide covers all aspects of deploying, operating, and maintaining the Chessr chess analysis infrastructure.

## Quick Links

| Document | Description |
|----------|-------------|
| [Architecture](architecture/ARCHITECTURE.md) | Server infrastructure overview |
| [Quick Start](deployment/QUICK-START.md) | Get started in 5 minutes |
| [Docker Deployment](deployment/DOCKER.md) | Deploy with Docker Compose |
| [SSL & Domain Setup](deployment/SSL.md) | Configure HTTPS and custom domains |
| [Server Operations](operations/SERVER-MANAGEMENT.md) | Day-to-day server management |
| [Troubleshooting](operations/TROUBLESHOOTING.md) | Common issues and solutions |
| [Scripts Reference](scripts/SCRIPTS-REFERENCE.md) | All available scripts |

## Project Structure

```
chessr/
├── server/              # WebSocket server with Stockfish
├── dashboard/           # Admin dashboard (Next.js)
├── extension/           # Chrome extension
├── landing/             # Landing page
├── nginx/               # Nginx configuration
├── scripts/             # Deployment & utility scripts
└── docs/                # Documentation (you are here)
    ├── architecture/    # System design docs
    ├── deployment/      # Setup & deployment guides
    ├── operations/      # Day-to-day operations
    └── scripts/         # Script documentation
```

## Services Overview

| Service | URL | Description |
|---------|-----|-------------|
| WebSocket Server | `wss://ws.chessr.io` | Stockfish analysis API |
| Admin Dashboard | `https://admin.chessr.io` | Monitoring & management |
| Server IP | `135.125.201.246` | OVH VPS |

## Getting Started

### For New Deployments

1. **Read the [Architecture](architecture/ARCHITECTURE.md)** to understand the system
2. **Follow [Quick Start](deployment/QUICK-START.md)** for initial setup
3. **Configure SSL** using [SSL & Domain Setup](deployment/SSL.md)

### For Operations

1. **Use [Server Management](operations/SERVER-MANAGEMENT.md)** for daily tasks
2. **Check [Troubleshooting](operations/TROUBLESHOOTING.md)** if issues arise

## Credentials & Access

| Resource | Location |
|----------|----------|
| Server SSH | `ubuntu@135.125.201.246` |
| Supabase | [ratngdlkcvyfdmidtenx.supabase.co](https://ratngdlkcvyfdmidtenx.supabase.co) |
| GitHub | [Oniriik/chessr-ext](https://github.com/Oniriik/chessr-ext) |
| Admin Emails | `oniriik.dev@gmail.com` |

## Technology Stack

- **Server**: Node.js 20, TypeScript, WebSocket, Stockfish 16.1
- **Dashboard**: Next.js 15, React 19, shadcn/ui, Tailwind CSS
- **Infrastructure**: Docker, Nginx, Let's Encrypt
- **Auth**: Supabase (JWT)
- **Hosting**: OVH VPS (Ubuntu)
