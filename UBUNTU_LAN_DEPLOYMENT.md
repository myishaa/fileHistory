# Ubuntu LAN Deployment Guide

This guide explains how to build Recordkeeper on a machine with internet access, copy the compiled app to an Ubuntu server, and host it on your local network.

Replace this example IP everywhere with your Ubuntu server LAN IP:

```text
192.168.1.50
```

## 1. Prepare The Frontend Environment

In the repo root, edit the frontend `.env` file:

```text
.env
```

Set the API URL to the Ubuntu server LAN address:

```env
VITE_API_BASE_URL=http://192.168.1.50
```

Important: this value is baked into the frontend when you run `npm run build`. If the IP changes, update `.env` and rebuild the frontend.

## 2. Build On A Machine With Internet

From the repo root:

```bash
npm install
npm run build
```

Build the backend:

```bash
cd backend
npm install
npm run build
npm install --omit=dev
cd ..
```

After this:

- Frontend build is in `dist/client`
- Backend compiled files are in `backend/dist`
- Backend production dependencies are in `backend/node_modules`

## 3. Create A Release Folder

From the repo root:

```bash
mkdir recordkeeper-release
cp -r dist recordkeeper-release/
cp -r backend/dist recordkeeper-release/backend-dist
cp -r backend/node_modules recordkeeper-release/backend-node_modules
cp backend/package.json recordkeeper-release/backend-package.json
cp -r database recordkeeper-release/
cp backend/.env.example recordkeeper-release/backend.env.example
```

Copy `recordkeeper-release` to the Ubuntu server using USB, SCP, or any file transfer method.

## 4. Install Ubuntu Packages

On the Ubuntu server:

```bash
sudo apt update
sudo apt install nginx postgresql postgresql-contrib nodejs npm
```

Check Node is installed:

```bash
node -v
```

Node.js 20 or newer is recommended.

## 5. Create The PostgreSQL Database

On the Ubuntu server:

```bash
sudo -u postgres createdb recordkeeper
```

If needed, set the PostgreSQL password:

```bash
sudo -u postgres psql
```

Inside `psql`:

```sql
ALTER USER postgres WITH PASSWORD 'postgres';
\q
```

Run the migrations from inside the copied release folder:

```bash
cd recordkeeper-release

for file in database/*.sql; do
  psql "postgresql://postgres:postgres@localhost:5432/recordkeeper" -f "$file"
done
```

## 6. Install App Files

Create app folders:

```bash
sudo mkdir -p /opt/recordkeeper/backend
sudo mkdir -p /var/www/recordkeeper
```

Copy the frontend:

```bash
sudo cp -r dist/client/* /var/www/recordkeeper/
```

Copy the backend:

```bash
sudo cp -r backend-dist /opt/recordkeeper/backend/dist
sudo cp -r backend-node_modules /opt/recordkeeper/backend/node_modules
sudo cp backend-package.json /opt/recordkeeper/backend/package.json
```

## 7. Configure Backend Environment

Create the backend production environment file:

```bash
sudo nano /opt/recordkeeper/backend/.env
```

Use this, replacing the IP if needed:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/recordkeeper
FRONTEND_ORIGIN=http://192.168.1.50
NODE_ENV=production
SESSION_COOKIE_SAMESITE=lax
```

## 8. Create Backend Systemd Service

Create the service file:

```bash
sudo nano /etc/systemd/system/recordkeeper-backend.service
```

Paste:

```ini
[Unit]
Description=Recordkeeper Backend
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/recordkeeper/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Start the backend:

```bash
sudo systemctl daemon-reload
sudo systemctl enable recordkeeper-backend
sudo systemctl start recordkeeper-backend
sudo systemctl status recordkeeper-backend
```

Test it:

```bash
curl http://localhost:3000/api/health
```

## 9. Configure Nginx

Create the Nginx site:

```bash
sudo nano /etc/nginx/sites-available/recordkeeper
```

Paste:

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/recordkeeper;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/recordkeeper /etc/nginx/sites-enabled/recordkeeper
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

## 10. Allow LAN Access

If UFW firewall is enabled:

```bash
sudo ufw allow 80/tcp
```

You usually do not need to expose port `3000` because Nginx talks to the backend locally.

## 11. Open The App

From another computer on the same LAN:

```text
http://192.168.1.50
```

Initial login after a fresh seed:

```text
Username: ovais
Password: ovais123
```

Change this password immediately after the first real login.

## Updating The App Later

On the internet-connected build machine:

```bash
npm install
npm run build

cd backend
npm install
npm run build
npm install --omit=dev
cd ..
```

Create a new `recordkeeper-release` folder and copy it to the Ubuntu server.

On the Ubuntu server:

```bash
sudo cp -r dist/client/* /var/www/recordkeeper/
sudo rm -rf /opt/recordkeeper/backend/dist
sudo rm -rf /opt/recordkeeper/backend/node_modules
sudo cp -r backend-dist /opt/recordkeeper/backend/dist
sudo cp -r backend-node_modules /opt/recordkeeper/backend/node_modules
sudo systemctl restart recordkeeper-backend
sudo systemctl restart nginx
```

If new SQL files were added in the `database` folder, run only the new migrations that have not already been applied.

## Troubleshooting

Check backend logs:

```bash
sudo journalctl -u recordkeeper-backend -f
```

Check Nginx:

```bash
sudo nginx -t
sudo systemctl status nginx
```

Check backend directly:

```bash
curl http://localhost:3000/api/health
```

Check from another LAN computer:

```text
http://192.168.1.50
```

If the frontend loads but API calls fail, confirm the frontend was built with:

```env
VITE_API_BASE_URL=http://192.168.1.50
```

Then rebuild and redeploy the frontend.
