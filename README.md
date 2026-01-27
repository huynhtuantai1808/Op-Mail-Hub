# Hướng dẫn sử dụng Mail Server Hub với Stalwart

## Tổng quan

Hệ thống Mail Server Hub này bao gồm:
- **Stalwart Mail Server**: Mail server chính xử lý SMTP/IMAP
- **API Gateway**: REST API để các cluster khác gửi email qua HTTP

## Cài đặt từ đầu

### 1. Yêu cầu hệ thống

- Docker và Docker Compose
- Ít nhất 2GB RAM
- 10GB dung lượng đĩa
- Domain name (cho production)

### 2. Chạy script cài đặt

```bash
chmod +x setup.sh
./setup.sh
```

### 3. Copy các file API Gateway

```bash
cd stalwart-hub/api-gateway

# Copy các file từ artifacts:
# - server.js
# - package.json  
# - Dockerfile
```

### 4. Cấu hình domain (Optional cho production)

Sửa file `config/config.toml` và `docker-compose.yml`:
```toml
[server]
hostname = "mail.yourdomain.com"  # Thay bằng domain của bạn
```

### 5. Khởi động services

```bash
./scripts/start.sh
```

## Sử dụng API

### Authentication

Tất cả API endpoints đều yêu cầu API key trong header:
```bash
X-API-Key: your-api-key-here
```

API keys được generate tự động và lưu trong file `.api-keys`.

### 1. Gửi email đơn

**Endpoint:** `POST /api/send`

**Ví dụ với curl:**
```bash
curl -X POST http://localhost:3000/api/send \
  -H "X-API-Key: abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "sender@yourdomain.com",
    "to": "recipient@example.com",
    "subject": "Test Email",
    "html": "<h1>Hello</h1><p>This is a test.</p>"
  }'
```

**Response:**
```json
{
  "success": true,
  "messageId": "<unique-id@yourdomain.com>",
  "response": "250 2.0.0 OK"
}
```

### 2. Gửi email hàng loạt

**Endpoint:** `POST /api/send-bulk`

**Ví dụ:**
```bash
curl -X POST http://localhost:3000/api/send-bulk \
  -H "X-API-Key: abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "newsletter@yourdomain.com",
    "recipients": [
      {
        "email": "user1@example.com",
        "data": {"name": "John", "code": "ABC123"}
      },
      {
        "email": "user2@example.com",
        "data": {"name": "Jane", "code": "DEF456"}
      }
    ],
    "subject": "Hello {{name}}",
    "template": "<h1>Hi {{name}}!</h1><p>Your code: {{code}}</p>"
  }'
```

### 3. Gửi báo cáo định kỳ

**Endpoint:** `POST /api/send-report`

**Ví dụ gửi báo cáo hàng ngày:**
```bash
curl -X POST http://localhost:3000/api/send-report \
  -H "X-API-Key: abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "reportType": "Daily System Report",
    "cluster": "Production Cluster 1",
    "recipients": ["admin@example.com", "ops@example.com"],
    "data": {
      "metrics": {
        "CPU Usage": "45%",
        "Memory Usage": "67%",
        "Disk Usage": "34%",
        "Active Users": "142"
      },
      "details": [
        {"Service": "Web", "Status": "Running", "Memory": "2.3GB"},
        {"Service": "Database", "Status": "Running", "Memory": "4.1GB"}
      ]
    }
  }'
```

## Tích hợp với các Cluster khác

### Python Integration

```python
import requests

class MailClient:
    def __init__(self, api_url, api_key):
        self.api_url = api_url
        self.headers = {'X-API-Key': api_key}
    
    def send_daily_report(self, cluster_name, metrics):
        response = requests.post(
            f'{self.api_url}/api/send-report',
            headers=self.headers,
            json={
                'reportType': 'Daily Report',
                'cluster': cluster_name,
                'recipients': ['admin@example.com'],
                'data': {'metrics': metrics}
            }
        )
        return response.json()

# Usage
client = MailClient('http://mail-hub:3000', 'your-api-key')
client.send_daily_report('Cluster-1', {'CPU': '50%', 'RAM': '70%'})
```

### Node.js Integration

```javascript
const axios = require('axios');

async function sendReport(metrics) {
  const response = await axios.post(
    'http://mail-hub:3000/api/send-report',
    {
      reportType: 'Hourly Metrics',
      cluster: 'API Cluster',
      recipients: ['ops@example.com'],
      data: { metrics }
    },
    {
      headers: { 'X-API-Key': 'your-api-key' }
    }
  );
  return response.data;
}

sendReport({ requests: 1234, errors: 5 });
```

### Bash/Shell Script

```bash
#!/bin/bash

API_URL="http://mail-hub:3000"
API_KEY="your-api-key"

# Collect metrics
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
MEM=$(free | grep Mem | awk '{print ($3/$2) * 100.0}')

# Send report
curl -X POST "$API_URL/api/send-report" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"reportType\": \"System Health\",
    \"cluster\": \"$(hostname)\",
    \"recipients\": [\"admin@example.com\"],
    \"data\": {
      \"metrics\": {
        \"CPU Usage\": \"$CPU%\",
        \"Memory Usage\": \"$MEM%\"
      }
    }
  }"
```

## Cron Jobs cho báo cáo tự động

### Daily Report (Linux/Mac)

```bash
# Edit crontab
crontab -e

# Thêm dòng này để gửi report lúc 8h sáng mỗi ngày
0 8 * * * /path/to/send-daily-report.sh
```

### Hourly Report

```bash
# Gửi report mỗi giờ
0 * * * * /path/to/send-hourly-report.sh
```

### Weekly Report

```bash
# Gửi report vào 9h sáng Thứ Hai hàng tuần
0 9 * * 1 /path/to/send-weekly-report.sh
```

## Monitoring và Troubleshooting

### Kiểm tra logs

```bash
# Tất cả services
./scripts/logs.sh

# Chỉ API Gateway
./scripts/logs.sh api-gateway

# Chỉ Stalwart
./scripts/logs.sh stalwart
```

### Kiểm tra status

```bash
./scripts/status.sh
```

### Health check

```bash
curl http://localhost:3000/health
```

### Queue status

```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/queue/status
```

## Security Best Practices

### 1. Bảo vệ API Keys

- Không commit API keys vào Git
- Rotate keys định kỳ
- Sử dụng environment variables
- Giới hạn permissions per key

### 2. Rate Limiting

API đã có rate limiting mặc định:
- 100 requests / 15 phút mỗi IP
- Có thể tùy chỉnh trong `.env`

### 3. Firewall Rules

```bash
# Chỉ cho phép các IP cụ thể truy cập API
sudo ufw allow from 10.0.0.0/8 to any port 3000

# Block public access
sudo ufw deny 3000
```

### 4. TLS/SSL

Trong production, luôn sử dụng HTTPS:
- Setup reverse proxy (Nginx/Traefik)
- Cài đặt Let's Encrypt certificates
- Force HTTPS redirect

## Performance Tuning

### Connection Pooling

API Gateway sử dụng connection pooling mặc định:
- `maxConnections: 5`
- `maxMessages: 100`

Có thể tăng trong `server.js` nếu cần xử lý nhiều email hơn.

### Queue Management

Stalwart tự động retry emails thất bại:
- Retry intervals: 2m, 5m, 10m, 15m, 30m, 1h, 2h
- Expire sau 5 ngày

## Backup và Recovery

### Backup data

```bash
# Backup toàn bộ data directory
tar -czf stalwart-backup-$(date +%Y%m%d).tar.gz data/

# Backup configuration
tar -czf config-backup-$(date +%Y%m%d).tar.gz config/
```

### Restore

```bash
# Stop services
./scripts/stop.sh

# Restore data
tar -xzf stalwart-backup-YYYYMMDD.tar.gz

# Start services
./scripts/start.sh
```

## FAQ

**Q: Làm sao để thêm domain mới?**
A: Cập nhật `config/config.toml` và restart services.

**Q: Email không được gửi đi?**
A: Kiểm tra logs, queue status, và DNS records (SPF, DKIM, DMARC).

**Q: Làm sao để tăng rate limit?**
A: Sửa `RATE_LIMIT_MAX_REQUESTS` trong `api-gateway/.env`.

**Q: API key bị lộ, phải làm sao?**
A: Generate key mới, cập nhật `.env`, restart API gateway.

## Support

- Stalwart Documentation: https://stalw.art/docs
- GitHub Issues: https://github.com/stalwartlabs/stalwart/issues
- API Gateway source: Xem file `server.js`