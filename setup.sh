#!/bin/bash
set -e

echo "=========================================="
echo "Stalwart Mail Server Hub Setup"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    print_error "Please do not run as root"
    exit 1
fi

# Check prerequisites
print_info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi
print_success "Docker found"

if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi
print_success "Docker Compose found"

# Create directory structure
print_info "Creating directory structure..."
mkdir -p stalwart-hub/{data,config,api-gateway,scripts}
cd stalwart-hub

# Generate API keys
print_info "Generating API keys..."
API_KEY1=$(openssl rand -hex 32)
API_KEY2=$(openssl rand -hex 32)
SMTP_PASS=$(openssl rand -base64 24)

print_success "API Key 1: $API_KEY1"
print_success "API Key 2: $API_KEY2"
print_success "SMTP Password: $SMTP_PASS"

# Create .env file
print_info "Creating environment file..."
cat > api-gateway/.env << EOF
PORT=3000
NODE_ENV=production

SMTP_HOST=stalwart
SMTP_PORT=587
SMTP_USER=api@yourdomain.com
SMTP_PASS=$SMTP_PASS

API_KEYS=$API_KEY1,$API_KEY2

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF
print_success "Environment file created"

# Save API keys to a secure file
cat > .api-keys << EOF
===========================================
API Keys - Keep these secure!
===========================================
API Key 1: $API_KEY1
API Key 2: $API_KEY2
SMTP Password: $SMTP_PASS
===========================================
Generated: $(date)
EOF
chmod 600 .api-keys
print_success "API keys saved to .api-keys file"

# Create docker-compose.yml
print_info "Creating Docker Compose configuration..."
cat > docker-compose.yml << 'EOF'
services:
  stalwart:
    image: stalwartlabs/stalwart:latest
    container_name: stalwart-mail
    hostname: mail.yourdomain.com
    ports:
      - "25:25"
      - "587:587"
      - "465:465"
      - "143:143"
      - "993:993"
      - "4190:4190"
      - "8080:8080"
    volumes:
      - ./data:/opt/stalwart-mail
      - ./config:/opt/stalwart-mail/etc
    environment:
      - HOSTNAME=mail.yourdomain.com
    restart: unless-stopped
    networks:
      - mail-network

  api-gateway:
    build: ./api-gateway
    container_name: mail-api-gateway
    ports:
      - "3000:3000"
    env_file:
      - ./api-gateway/.env
    depends_on:
      - stalwart
    restart: unless-stopped
    networks:
      - mail-network
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

networks:
  mail-network:
    driver: bridge

EOF
print_success "Docker Compose configuration created"

# Create basic Stalwart config
print_info "Creating Stalwart configuration..."
cat > config/config.toml << 'EOF'
[server]
hostname = "mail.yourdomain.com"

[server.listener.smtp]
bind = ["0.0.0.0:25"]
protocol = "smtp"

[server.listener.submission]
bind = ["0.0.0.0:587"]
protocol = "smtp"
tls.implicit = false

[server.listener.submissions]
bind = ["0.0.0.0:465"]
protocol = "smtp"
tls.implicit = true

[server.listener.imap]
bind = ["0.0.0.0:143"]
protocol = "imap"

[server.listener.imaps]
bind = ["0.0.0.0:993"]
protocol = "imap"
tls.implicit = true

[server.listener.http]
bind = ["0.0.0.0:8080"]
protocol = "http"

[storage]
data = "sqlite"
blob = "sqlite"
lookup = "sqlite"
fts = "sqlite"

[storage.sqlite]
path = "/opt/stalwart-mail/data/index.sqlite3"

[session.auth]
mechanisms = ["plain", "login"]
require = true

[session.ehlo]
require = true

[queue]
path = "/opt/stalwart-mail/queue"
hash = 64

[queue.schedule]
retry = ["2m", "5m", "10m", "15m", "30m", "1h", "2h"]
notify = ["1d", "3d"]
expire = "5d"

[report]
path = "/opt/stalwart-mail/reports"
hash = 64
EOF
print_success "Stalwart configuration created"

# Create API Gateway files
print_info "Setting up API Gateway..."
# (The server.js, package.json, and Dockerfile content should be copied here)
# For brevity, instructing manual copy

cat > api-gateway/README.md << 'EOF'
# API Gateway Files Required

Please copy the following files into this directory:
1. server.js (from artifact)
2. package.json (from artifact)
3. Dockerfile (from artifact)

These files are provided in the artifacts.
EOF
print_success "API Gateway directory ready (manual file copy needed)"

# Create management scripts
print_info "Creating management scripts..."

# Start script
cat > scripts/start.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/.."
echo "Starting Stalwart Mail Server Hub..."
docker-compose up -d
echo "Services started!"
echo "API Gateway: http://localhost:3000"
echo "Stalwart Management: http://localhost:8080"
EOF
chmod +x scripts/start.sh

# Stop script
cat > scripts/stop.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/.."
echo "Stopping Stalwart Mail Server Hub..."
docker-compose down
echo "Services stopped!"
EOF
chmod +x scripts/stop.sh

# Status script
cat > scripts/status.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/.."
docker-compose ps
EOF
chmod +x scripts/status.sh

# Logs script
cat > scripts/logs.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")/.."
if [ -z "$1" ]; then
    docker-compose logs -f
else
    docker-compose logs -f "$1"
fi
EOF
chmod +x scripts/logs.sh

print_success "Management scripts created"

# Create test script
cat > scripts/test-api.sh << EOF
#!/bin/bash
echo "Testing Mail API Gateway..."

API_URL="http://localhost:3000"
API_KEY="$API_KEY1"

echo "1. Health check..."
curl -s "\$API_URL/health" | jq .

echo -e "\n2. Send test email..."
curl -s -X POST "\$API_URL/api/send" \\
  -H "X-API-Key: \$API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "test@yourdomain.com",
    "to": "recipient@example.com",
    "subject": "Test Email",
    "text": "This is a test email from Mail API Gateway"
  }' | jq .

echo -e "\nAPI test completed!"
EOF
chmod +x scripts/test-api.sh

print_success "Test script created"

# Create README
cat > README.md << 'EOF'
# Stalwart Mail Server Hub

This is a complete mail server hub setup with API gateway for receiving reports from multiple clusters.

## Directory Structure

```
stalwart-hub/
├── data/                 # Stalwart data directory
├── config/              # Stalwart configuration
├── api-gateway/         # API Gateway application
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   └── .env
├── scripts/             # Management scripts
│   ├── start.sh
│   ├── stop.sh
│   ├── status.sh
│   ├── logs.sh
│   └── test-api.sh
└── docker-compose.yml
```

## Quick Start

1. Start the services:
   ```bash
   ./scripts/start.sh
   ```

2. Check status:
   ```bash
   ./scripts/status.sh
   ```

3. View logs:
   ```bash
   ./scripts/logs.sh        # All services
   ./scripts/logs.sh stalwart  # Specific service
   ```

4. Test API:
   ```bash
   ./scripts/test-api.sh
   ```

5. Stop services:
   ```bash
   ./scripts/stop.sh
   ```

## API Endpoints

- `GET /health` - Health check
- `POST /api/send` - Send single email
- `POST /api/send-bulk` - Send bulk emails
- `POST /api/send-report` - Send formatted report
- `GET /api/queue/status` - Check queue status

## Access Points

- API Gateway: http://localhost:3000
- Stalwart Web UI: http://localhost:8080
- SMTP Submission: localhost:587
- IMAP: localhost:143

## API Keys

Your API keys are stored in `.api-keys` file (keep it secure!).

## Next Steps

1. Configure your domain and DNS records
2. Set up TLS certificates
3. Create email accounts in Stalwart
4. Configure SPF, DKIM, and DMARC
5. Test email sending and receiving
6. Set up monitoring and alerts

## Documentation

- Stalwart: https://github.com/stalwartlabs/stalwart
- API Documentation: See server.js for endpoint details
EOF

print_success "README created"

# Final instructions
echo ""
echo "=========================================="
print_success "Setup completed!"
echo "=========================================="
echo ""
print_info "Next steps:"
echo "1. Copy API Gateway files (server.js, package.json, Dockerfile) to api-gateway/"
echo "2. Update domain name in config/config.toml and docker-compose.yml"
echo "3. Run: ./scripts/start.sh"
echo ""
print_info "Important files:"
echo "- API Keys: .api-keys (keep this secure!)"
echo "- Environment: api-gateway/.env"
echo "- Configuration: config/config.toml"
echo ""
print_success "Installation directory: $(pwd)"
echo "=========================================="