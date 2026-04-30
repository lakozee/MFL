# Windows 11 Deployment Instructions — Marching Fantasy League

These instructions are written for a Claude Code agent to execute on a Windows 11 machine.
Work through each step in order. Run all commands in **PowerShell** unless stated otherwise.

---

## Step 1 — Check and Install Prerequisites

### Node.js
```powershell
node --version
```
If the command fails or the version is below 18, install Node.js:
```powershell
winget install OpenJS.NodeJS.LTS
```
After installing, close and reopen PowerShell, then verify:
```powershell
node --version
npm --version
```

### Git
```powershell
git --version
```
If the command fails:
```powershell
winget install Git.Git
```
Close and reopen PowerShell, then verify:
```powershell
git --version
```

### PostgreSQL
```powershell
psql --version
```
If the command fails, install PostgreSQL 17:
```powershell
winget install PostgreSQL.PostgreSQL.17
```
The installer will prompt for a superuser password for the `postgres` account — **set it to `postgres`** (used in Step 3). After installing, add PostgreSQL to your PATH. The default install location is `C:\Program Files\PostgreSQL\17\bin`. Add it to the system PATH:
```powershell
$env:PATH += ";C:\Program Files\PostgreSQL\17\bin"
[System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\Program Files\PostgreSQL\17\bin", "Machine")
```
Close and reopen PowerShell, then verify:
```powershell
psql --version
```

### Windows Build Tools (required for the `bcrypt` package)
Check if already installed:
```powershell
npm list -g node-gyp
```
If not present, install Visual Studio Build Tools. First check if `npm install` in Step 4 succeeds without this — if bcrypt fails to compile, run:
```powershell
npm install -g windows-build-tools
```
Or install Visual Studio Build Tools manually and select "Desktop development with C++".

---

## Step 2 — Clone the Repository

```powershell
cd C:\Users\$env:USERNAME\Desktop
git clone git@github.com:lakozee/MFL.git
cd MFL\dci-betting
```

If SSH access is not configured, set it up first:
```powershell
ssh-keygen -t ed25519 -C "your-email@example.com"
cat ~/.ssh/id_ed25519.pub
```
Add the output public key to GitHub under Settings → SSH and GPG keys, then retry the clone.

---

## Step 3 — Set Up the PostgreSQL Database

Make sure the PostgreSQL service is running:
```powershell
Start-Service postgresql-x64-17
```
If the service name differs, find it with:
```powershell
Get-Service | Where-Object { $_.DisplayName -like "*postgres*" }
```

Create the database user and database (run as the postgres superuser). When prompted for a password, enter `postgres`:
```powershell
psql -U postgres -h localhost -c "CREATE USER fantasy_user WITH PASSWORD 'fantasy_dci_2024';"
psql -U postgres -h localhost -c "CREATE DATABASE fantasy_dci OWNER fantasy_user;"
psql -U postgres -h localhost -c "GRANT ALL PRIVILEGES ON DATABASE fantasy_dci TO fantasy_user;"
```

Run the schema (creates all tables and inserts sample corps stats):
```powershell
$env:PGPASSWORD = "fantasy_dci_2024"
psql -U fantasy_user -h localhost -d fantasy_dci -f database\schema.sql
```

Verify the tables were created:
```powershell
psql -U fantasy_user -h localhost -d fantasy_dci -c "\dt"
```
You should see tables: `users`, `leagues`, `league_members`, `draft_picks`, `corps_stats`, `league_invites`, `competitions`, `competition_scores`, `draft_sessions`.

---

## Step 4 — Create the `.env` File

In the `dci-betting` directory, create a file named `.env` with the following content.
Generate a random JWT secret by running:
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output and use it as `JWT_SECRET` below.

Create the `.env` file:
```powershell
@"
DATABASE_URL=postgresql://fantasy_user:fantasy_dci_2024@localhost:5432/fantasy_dci
JWT_SECRET=PASTE_YOUR_GENERATED_SECRET_HERE
PORT=3000
NODE_ENV=development
"@ | Out-File -FilePath .env -Encoding utf8
```

---

## Step 5 — Install Dependencies

From inside the `dci-betting` directory:
```powershell
npm install
```

If `bcrypt` fails to compile, install build tools and retry:
```powershell
npm install -g node-gyp
npm install --build-from-source
```
If it still fails, as a last resort you can swap `bcrypt` for the pure-JS equivalent:
```powershell
npm uninstall bcrypt
npm install bcryptjs
```
Then in `server/routes/auth.js`, change `require('bcrypt')` to `require('bcryptjs')` — the API is identical.

---

## Step 6 — Start the Server

```powershell
npm start
```

You should see:
```
✓ Connected to PostgreSQL database
✓ Fantasy DCI server running on http://localhost:3000
✓ Environment: development
```

Open a browser and navigate to `http://localhost:3000` — the site should load.

---

## Step 7 — Verify Everything Works

- Visit `http://localhost:3000` — landing page loads
- Visit `http://localhost:3000/auth` — login/register page loads
- Create a test account and log in
- Create a league — confirm it appears in the dashboard

---

## Running the Server Automatically

To start the server automatically in the background (optional), use:
```powershell
npm install -g pm2
pm2 start server/server.js --name mfl
pm2 save
pm2 startup
```
Follow the output instructions from `pm2 startup` to register it as a Windows service.

To stop: `pm2 stop mfl`
To restart: `pm2 restart mfl`
To view logs: `pm2 logs mfl`

---

## Updating When Code Changes

When changes are pushed to the GitHub repo:
```powershell
cd C:\Users\$env:USERNAME\Desktop\MFL\dci-betting
git pull
npm install
npm start   # or: pm2 restart mfl
```

---

## Troubleshooting

**"Cannot connect to PostgreSQL"**
- Check the service is running: `Get-Service | Where-Object { $_.DisplayName -like "*postgres*" }`
- Start it: `Start-Service postgresql-x64-17`
- Verify the `DATABASE_URL` in `.env` matches the credentials created in Step 3

**"Port 3000 already in use"**
- Find what's using it: `netstat -ano | findstr :3000`
- Kill the process: `taskkill /PID <pid> /F`
- Or change `PORT=3000` in `.env` to another port (e.g. `3001`)

**"bcrypt" errors on startup**
- Follow the bcrypt fallback steps in Step 5

**Page loads but API calls fail (CORS errors)**
- Confirm `NODE_ENV=development` is set in `.env` — the server allows `localhost:3000` in development mode
