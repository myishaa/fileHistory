# Recordkeeper Backup And Recovery Guide

This guide explains how to configure automatic PostgreSQL backups for the LAN deployment and how to restore the database if records are accidentally or maliciously deleted.

The commands below assume the production database is:

```text
recordkeeper
```

and the database URL is:

```text
postgresql://postgres:postgres@localhost:5432/recordkeeper
```

If your server uses a different PostgreSQL username, password, host, port, or database name, replace the URL everywhere in this guide.

## 1. What The Backup System Will Do

The recommended setup will:

- create one database backup every day at a fixed time
- store backups in `/opt/recordkeeper/backups`
- keep only the latest 7 daily backups
- write a small log file so backup success or failure can be checked
- allow recovery by restoring one selected backup into PostgreSQL

This backs up the PostgreSQL database only. It does not back up operating system files, Nginx config, app build files, or uploaded documents if those are added later.

## 2. Create The Backup Folder

Run this on the Ubuntu LAN server:

```bash
sudo mkdir -p /opt/recordkeeper/backups
sudo chown -R $USER:$USER /opt/recordkeeper/backups
chmod 700 /opt/recordkeeper/backups
```

The `chmod 700` command restricts access to the backup folder because database backups may contain sensitive office data.

## 3. Create The Backup Script

Create a script file:

```bash
nano /opt/recordkeeper/backup-recordkeeper.sh
```

Paste this:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/opt/recordkeeper/backups"
DB_URL="postgresql://postgres:postgres@localhost:5432/recordkeeper"
DATE="$(date +%F_%H-%M-%S)"
BACKUP_FILE="$BACKUP_DIR/recordkeeper_$DATE.sql"
LOG_FILE="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"

echo "[$(date '+%F %T')] Starting backup: $BACKUP_FILE" >> "$LOG_FILE"

pg_dump "$DB_URL" > "$BACKUP_FILE"

gzip "$BACKUP_FILE"

find "$BACKUP_DIR" -name "recordkeeper_*.sql.gz" -type f -mtime +6 -delete

echo "[$(date '+%F %T')] Backup completed successfully" >> "$LOG_FILE"
```

Save and close the file.

Make the script executable:

```bash
chmod +x /opt/recordkeeper/backup-recordkeeper.sh
```

## 4. Test The Backup Script Manually

Before scheduling it, run it once:

```bash
/opt/recordkeeper/backup-recordkeeper.sh
```

Check that a backup file was created:

```bash
ls -lh /opt/recordkeeper/backups
```

You should see a file like:

```text
recordkeeper_2026-06-24_20-00-00.sql.gz
```

Check the log:

```bash
tail -n 20 /opt/recordkeeper/backups/backup.log
```

If the script fails, fix the database URL or PostgreSQL permissions before continuing.

## 5. Schedule Daily Automatic Backups

Open the current user's crontab:

```bash
crontab -e
```

Add this line to run the backup every day at 8:00 PM:

```cron
0 20 * * * /opt/recordkeeper/backup-recordkeeper.sh >> /opt/recordkeeper/backups/cron.log 2>&1
```

Save and close.

To choose a different time, change the first two values:

```text
minute hour * * *
```

Examples:

```cron
# Every day at 1:30 PM
30 13 * * * /opt/recordkeeper/backup-recordkeeper.sh >> /opt/recordkeeper/backups/cron.log 2>&1

# Every day at 11:00 PM
0 23 * * * /opt/recordkeeper/backup-recordkeeper.sh >> /opt/recordkeeper/backups/cron.log 2>&1
```

## 6. Confirm The Schedule Is Installed

Run:

```bash
crontab -l
```

Confirm the backup line is visible.

After the scheduled time passes, check:

```bash
ls -lh /opt/recordkeeper/backups
tail -n 50 /opt/recordkeeper/backups/backup.log
tail -n 50 /opt/recordkeeper/backups/cron.log
```

## 7. How Retention Works

This line in the script removes old backups:

```bash
find "$BACKUP_DIR" -name "recordkeeper_*.sql.gz" -type f -mtime +6 -delete
```

Because the backup runs daily, this keeps roughly the latest 7 daily backups.

If you want to keep 14 days instead, change `+6` to `+13`.

If you want to keep 30 days, change `+6` to `+29`.

## 8. Recommended Extra Protection

Daily backups are helpful, but they are still on the same server. For better protection:

- copy backups to another computer or external drive regularly
- keep at least one weekly backup outside the server
- restrict access to `/opt/recordkeeper/backups`
- restrict who has admin access inside the app
- periodically test restoring a backup

If someone deletes data before the daily backup runs, restoring the previous backup may lose legitimate work done after that backup. For busy offices, consider two backups per day.

Example for 1:00 PM and 8:00 PM daily:

```cron
0 13 * * * /opt/recordkeeper/backup-recordkeeper.sh >> /opt/recordkeeper/backups/cron.log 2>&1
0 20 * * * /opt/recordkeeper/backup-recordkeeper.sh >> /opt/recordkeeper/backups/cron.log 2>&1
```

## 9. Recovery Scenario: Data Was Deleted

If someone signs in and deletes important data, act quickly.

### Step 1: Stop The Backend

Stop the app backend so users cannot continue changing data during recovery:

```bash
sudo systemctl stop recordkeeper-backend
```

Nginx can remain running, but the app will not work properly until the backend is started again.

### Step 2: Save The Damaged Database

Before restoring, save the current damaged database. This may help with investigation or manual recovery of records entered after the last good backup.

```bash
pg_dump "postgresql://postgres:postgres@localhost:5432/recordkeeper" > /opt/recordkeeper/backups/damaged_recordkeeper_$(date +%F_%H-%M-%S).sql
```

### Step 3: Choose The Backup To Restore

List available backups:

```bash
ls -lh /opt/recordkeeper/backups/recordkeeper_*.sql.gz
```

Choose the latest backup from before the deletion happened.

Example:

```text
/opt/recordkeeper/backups/recordkeeper_2026-06-24_20-00-00.sql.gz
```

### Step 4: Drop And Recreate The Database

This removes the damaged production database and creates a clean empty database.

```bash
sudo -u postgres dropdb recordkeeper
sudo -u postgres createdb recordkeeper
```

Only run these commands after you have selected the backup and saved the damaged database.

### Step 5: Restore The Selected Backup

Restore from the compressed backup:

```bash
gunzip -c /opt/recordkeeper/backups/recordkeeper_2026-06-24_20-00-00.sql.gz | psql "postgresql://postgres:postgres@localhost:5432/recordkeeper"
```

Replace the filename with the backup you selected.

### Step 6: Start The Backend

```bash
sudo systemctl start recordkeeper-backend
sudo systemctl status recordkeeper-backend
```

### Step 7: Verify The App

Open the LAN app in a browser and check:

- login works
- dashboard loads
- search shows expected records
- reports load
- add/edit workflow works
- admin settings load

Also check the backend health endpoint:

```bash
curl http://localhost:3000/api/health
```

## 10. Important Recovery Notes

Restoring a backup returns the database to the exact state at the backup time.

Example:

- backup time: 8:00 PM yesterday
- deletion time: 4:00 PM today
- restored backup: 8:00 PM yesterday

In this case, all legitimate work entered between 8:00 PM yesterday and 4:00 PM today will not be present after restore.

To preserve evidence or recover later entries manually, keep the damaged dump created in Step 2.

## 11. Test Restore Without Touching Production

A backup is only useful if it can be restored. Periodically test one backup into a separate test database:

```bash
sudo -u postgres dropdb --if-exists recordkeeper_restore_test
sudo -u postgres createdb recordkeeper_restore_test
gunzip -c /opt/recordkeeper/backups/recordkeeper_2026-06-24_20-00-00.sql.gz | psql "postgresql://postgres:postgres@localhost:5432/recordkeeper_restore_test"
```

Check tables exist:

```bash
psql "postgresql://postgres:postgres@localhost:5432/recordkeeper_restore_test" -c "\dt"
```

When finished:

```bash
sudo -u postgres dropdb recordkeeper_restore_test
```

## 12. Quick Emergency Checklist

Use this checklist during an actual deletion incident:

```text
1. Tell users to stop using the app.
2. Stop backend: sudo systemctl stop recordkeeper-backend
3. Dump damaged DB for investigation.
4. Pick latest good backup before deletion.
5. Drop and recreate recordkeeper database.
6. Restore selected backup.
7. Start backend.
8. Verify login, search, dashboard, reports, add/edit.
9. Preserve damaged dump until investigation is complete.
```

## 13. Full Disaster-Recovery Archive

The protected backup in Settings is an encrypted, portable application-data
backup. For a complete server recovery, also run the repository script
`scripts/backup-recordkeeper-disaster-recovery.sh` on the database/application
server:

```bash
DATABASE_URL="postgresql://.../recordkeeper" \
BACKUP_DIR="/opt/recordkeeper/backups" \
EXTERNAL_STORAGE_DIR="/opt/recordkeeper/uploads" \
bash scripts/backup-recordkeeper-disaster-recovery.sh
```

The script creates one protected archive containing:

- a `pg_dump` custom-format database dump, including schema, data, indexes,
  constraints, and sequences;
- a `pg_dumpall --globals-only` file containing PostgreSQL roles and global
  settings;
- an optional compressed external-storage archive; and
- a manifest and SHA-256 checksums.

Use a `.pgpass` file or another secure PostgreSQL authentication mechanism;
do not commit passwords or application secrets to the repository. Keep the
archive outside the application server as well as on it. Restore PostgreSQL
globals first, restore the database dump into a schema-compatible database,
then restore external storage and deployment secrets from their separately
protected locations.

The application restore now validates the complete table/column schema for
new backups, runs inside one transaction, and resets every identity/serial
sequence after inserting backed-up IDs. A schema mismatch is rejected before
existing data is truncated.

Restoring a local `.rbk` backup requires two separate credentials: the password
used to encrypt that backup file, and a restore-authorization password
configured in Settings. The authorization password is stored only as a hash
and is not included in the local application backup. The restore authorization
must be verified before the application enables file selection, and it changes
only when an Administrator explicitly saves a replacement.

The disposable QA destructive-settings audit also performs an export → restore
→ export round trip. The second export is intentional: it verifies that the
`protected_backup_log` identity sequence and every other restored sequence are
ready for the next write.

## 14. Settings: Full Recovery Package

An Administrator can download an encrypted full recovery package from
**Settings → Protected backup**. The download is an `.rkdr` file, named with
its creation timestamp, and is intended to be saved on a separate local
computer or secure storage. It contains:

- the encrypted application `.rbk` backup;
- a PostgreSQL custom-format database dump (`pg_dump`);
- PostgreSQL roles/globals (`pg_dumpall --globals-only`);
- a compressed archive of `EXTERNAL_STORAGE_DIR`, when configured;
- an explicitly configured deployment configuration file; and
- an explicitly configured deployment-secrets file, only when the
  administrator deliberately opts it in.

The package also includes a manifest, SHA-256 checksums, and a recovery README.
Environment variables and server secrets are **not** scraped automatically
into a browser download. If `RECORDKEEPER_BACKUP_SECRETS_FILE` is not
configured, the package records that secrets were intentionally excluded;
transfer them separately through the organisation's secure secret-management
process.

Optional server configuration:

```bash
EXTERNAL_STORAGE_DIR=/opt/recordkeeper/uploads
RECORDKEEPER_BACKUP_CONFIG_FILE=/etc/recordkeeper/deployment.env
RECORDKEEPER_BACKUP_SECRETS_FILE=/etc/recordkeeper/deployment.secrets
PG_DUMP_PATH=/usr/bin/pg_dump
PG_DUMPALL_PATH=/usr/bin/pg_dumpall
TAR_PATH=/usr/bin/tar
```

The Server Administrator can unpack an `.rkdr` package with the repository
helper. Keep the password out of shell history where possible:

```bash
RECOVERY_BACKUP_PASSWORD='use-the-backup-password' \
  node scripts/unpack-recordkeeper-disaster-recovery.mjs \
  recordkeeper-disaster-2026-10-31T12-00-00-000Z.rkdr \
  /secure/recovery/recordkeeper-2026-10-31
```

After extraction, restore PostgreSQL globals first, restore the database dump
into a schema-compatible database, restore external files and deployment
configuration/secrets, then start the matching application version and verify
login, search, reports, and Add/Edit. The `.rbk` file is retained for
application-level recovery and auditability; it is not a replacement for the
PostgreSQL dump when rebuilding a server.

## 15. Settings: Scheduled Server Backups

Administrators can enable and schedule encrypted full recovery packages from
**Settings → Protected backup → Scheduled server backups**. The On/Off switch
is stored in PostgreSQL and the backend performs the work on the server; a
browser does not need to remain open.

Configure the server-side password and the default destination in the backend
environment before enabling the switch:

```bash
RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD='use-a-long-server-side-password'
RECORDKEEPER_BACKUP_SCHEDULE_DIR=/opt/recordkeeper/backups
RECORDKEEPER_BACKUP_TIMEZONE=Asia/Kolkata
```

After changing these environment variables, restart the backend. In Settings,
choose daily or weekly frequency, time, destination directory, and the number
of packages to retain, then select **Save schedule** and turn the switch On.
The server password is never sent to or stored in the browser. The scheduled
package uses that password for AES-256-GCM encryption and includes the same
full recovery components as a manual `.rkdr` export, including explicitly
configured external files and deployment secrets.

The **Run backup now** button uses the saved server schedule configuration.
When the switch is Off, scheduled runs do not occur. A failed run is recorded
in Settings, and retention cleanup keeps the newest configured number of
scheduled `.rkdr` packages in the destination directory.

## 16. Backup health indicators

Settings → Protected backup keeps a persistent run record for local backups,
manual full-recovery packages, and scheduled server packages. Each tab shows
the latest run time and a status button: green for success, red for an issue,
amber while a run is in progress, and neutral **Not yet run** when no run has
been recorded. Selecting a status button shows the recorded error or package
details.

The Secret files indicator is green only when the configured secret-file path
was readable and the latest full-recovery package recorded that the file was
included. It is red when the path is not configured/readable or inclusion
failed, and it also identifies the package and inclusion time when successful.

