#!/usr/bin/env python3
#Daily database-only backup and a non-destructive recovery check.
import argparse
from contextlib import closing
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from tempfile import TemporaryDirectory

stateFolder = Path.home() / ".local/share/infrasight-cloud-backup"
remote = "infrasight-crypt:"
filePattern = re.compile(r"PMSB-[0-9]{8}T[0-9]{12}Z-([a-f0-9]{64})\.db")
authTables = ("sessions", "emailCodes", "authRateLimits")
requiredTables = ("users", "frames", "readings", "predictions", "forecasts")
service = """[Unit]
Description=InfraSight encrypted database backup

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 %h/.local/share/infrasight-cloud-backup/backup.py run
UMask=0077
TimeoutStartSec=25min
"""
timer = """[Unit]
Description=Run the InfraSight database backup each evening

[Timer]
OnCalendar=*-*-* 20:00:00
Persistent=true

[Install]
WantedBy=timers.target
"""


def utcNow():
    return datetime.now(timezone.utc)


def rclone(*args):
    return subprocess.run(
        ["rclone", *args], check=True, text=True, stdout=subprocess.PIPE,
        stdin=subprocess.DEVNULL, timeout=1200,
    ).stdout


def checkRemote():
    # Check the backend type, without displaying or copying the rclone config.
    for line in rclone("listremotes", "--long").splitlines():
        if line.split() == [remote, "crypt"]:
            return
    raise ValueError("Configure infrasight-crypt as an rclone crypt remote first.")


def transfer(source, destination):
    # Force content encryption for the crypt backend used by this process.
    rclone("copyto", str(source), str(destination), "--immutable",
           "--crypt-no-data-encryption=false", "--retries", "3", "--stats", "0")


def openReadOnly(path):
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=15)


def verifySnapshot(path):
    with closing(openReadOnly(path)) as database:
        database.execute("PRAGMA trusted_schema=OFF")
        database.execute("PRAGMA query_only=ON")
        if database.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed.")
        if database.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("SQLite foreign-key check failed.")
        tables = {row[0] for row in database.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        for table in requiredTables:
            if table not in tables:
                raise ValueError("Database is missing the InfraSight table: " + table)
        for table in authTables:
            if table in tables and database.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone():
                raise ValueError("Transient authentication data remains in the copy.")


def makeSnapshot(source, snapshot):
    with closing(openReadOnly(source)) as database:
        database.execute("VACUUM INTO ?", (str(snapshot),))
    with closing(sqlite3.connect(snapshot)) as copy:
        copy.execute("PRAGMA trusted_schema=OFF")
        tables = {row[0] for row in copy.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        for table in authTables:
            if table in tables:
                copy.execute(f'DELETE FROM "{table}"')
        copy.commit()
        copy.execute("VACUUM")
    verifySnapshot(snapshot)


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def saveJson(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def install(source):
    if not source.is_file():
        raise ValueError("Database file not found. Run from the project root or pass --database.")
    units = Path.home() / ".config/systemd/user"
    units.mkdir(parents=True, exist_ok=True)
    (stateFolder / "backup.py").write_text(Path(__file__).read_text())
    saveJson(stateFolder / "settings.json", {"database": str(source)})
    (units / "infrasight-cloud-backup.service").write_text(service)
    (units / "infrasight-cloud-backup.timer").write_text(timer)
    print("Installed backup files. Follow READ_ME.md to configure Drive and start the timer.")


def backup():
    statusFile = stateFolder / "status.json"
    status = json.loads(statusFile.read_text()) if statusFile.exists() else {}
    status["lastAttemptUtc"] = utcNow().isoformat()
    status["result"] = "running"
    saveJson(statusFile, status)
    try:
        checkRemote()
        settings = json.loads((stateFolder / "settings.json").read_text())
        source = Path(settings["database"])
        with TemporaryDirectory(prefix="infrasight-backup-") as folder:
            snapshot = Path(folder) / "PMSB.db"
            makeSnapshot(source, snapshot)
            stamp = utcNow().strftime("%Y%m%dT%H%M%S%fZ")
            name = f"PMSB-{stamp}-{checksum(snapshot)}.db"
            transfer(snapshot, remote + name)
        status.update(result="success", lastSuccessUtc=utcNow().isoformat(), lastFile=name)
        print("Encrypted backup uploaded: " + name)
    except Exception:
        status["result"] = "failed"
        raise
    finally:
        saveJson(statusFile, status)


def restoreCheck(name):
    match = filePattern.fullmatch(name)
    if match is None:
        raise ValueError("Use a backup filename from the encrypted remote listing.")
    checkRemote()
    with TemporaryDirectory(prefix="infrasight-recovery-") as folder:
        snapshot = Path(folder) / "PMSB.db"
        transfer(remote + name, snapshot)
        if checksum(snapshot) != match[1]:
            raise ValueError("Downloaded copy does not match its SHA-256 checksum.")
        verifySnapshot(snapshot)
    print("Recovery check passed: SHA-256, SQLite integrity and foreign keys. Live database untouched.")


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="action", required=True)
    installer = commands.add_parser("install")
    installer.add_argument("--database", type=Path, default=Path("data/PMSB.db"))
    commands.add_parser("run")
    commands.add_parser("list")
    checker = commands.add_parser("restore-check")
    checker.add_argument("filename")
    args = parser.parse_args()
    os.umask(0o077)
    stateFolder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.action in ("install", "run"):
        with (stateFolder / "backup.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.action == "install":
                install(args.database.expanduser().resolve())
            else:
                backup()
    elif args.action == "list":
        checkRemote()
        print(rclone("lsf", remote, "--files-only", "--crypt-no-data-encryption=false"), end="")
    else:
        restoreCheck(args.filename)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, subprocess.SubprocessError) as error:
        raise SystemExit(f"Backup command failed: {error}")