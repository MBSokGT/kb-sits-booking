# 🚀 Production Deployment Guide

## Quick Start

### Prerequisites
- Ubuntu 20.04+ / Debian 11+
- PostgreSQL 14+
- Nginx
- Docker & Docker Compose
- SSL Certificate

### 1. Clone Repository
```bash
git clone https://github.com/MBSokGT/kb-sits-booking.git
cd kb-sits-booking
```

### 2. Setup Supabase (Self-Hosted)
```bash
git clone https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
nano .env  # Configure your settings
docker-compose up -d
```

### 3. Initialize Database
```bash
psql -U postgres -d postgres -f supabase-schema.sql
```

### 4. Configure Application
Edit `config.js`:
```javascript
const SUPABASE_CONFIG = {
  url: 'https://your-api.company.com',
  anonKey: 'your-jwt-key'
};
```

### 5. Deploy Frontend
```bash
sudo cp -r . /var/www/kb-sits
sudo chown -R www-data:www-data /var/www/kb-sits
```

### 6. Configure Nginx
```nginx
server {
    listen 443 ssl http2;
    server_name coworking.company.com;
    
    ssl_certificate /etc/letsencrypt/live/coworking.company.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/coworking.company.com/privkey.pem;
    
    root /var/www/kb-sits;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

### 7. Enable & Restart
```bash
sudo ln -s /etc/nginx/sites-available/kb-sits /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## System Requirements

**Minimum:**
- 2 CPU cores
- 4GB RAM
- 20GB SSD

**Recommended:**
- 4 CPU cores
- 8GB RAM
- 50GB SSD

## Security Checklist
- [ ] SSL/TLS enabled
- [ ] Firewall configured
- [ ] Strong database passwords
- [ ] JWT tokens configured
- [ ] CORS properly set
- [ ] Demo accounts removed/changed

## Demo Accounts
```
Admin: admin@demo.ru / admin123
Manager: manager@demo.ru / pass123
Employee: user@demo.ru / pass123
```

**⚠️ Change passwords before production!**

## Support
- GitHub: https://github.com/MBSokGT/kb-sits-booking
- Issues: https://github.com/MBSokGT/kb-sits-booking/issues
