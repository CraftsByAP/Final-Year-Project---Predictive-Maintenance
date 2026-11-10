
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from tempfile import TemporaryDirectory

import backup

with TemporaryDirectory(prefix="infrasight-test-") as temp:
    root = Path(temp)
    source = root / "live.db"
    # Leave the writer open so committed data is still in the WAL.
    with closing(sqlite3.connect(source)) as writer:
        writer.execute("PRAGMA journal_mode=WAL")
        for name in backup.requiredTables + backup.authTables:
            writer.execute(f'CREATE TABLE "{name}" (value TEXT)')
            writer.execute(f'INSERT INTO "{name}" VALUES (?)', ("test data",))
        writer.commit()
        assert source.with_name("live.db-wal").exists()

        encrypted = root / "encrypted"
        encrypted.mkdir()
        password = subprocess.check_output(["rclone", "obscure", "throwaway-test-passphrase"], text=True).strip()
        config = root / "rclone.conf"
        config.write_text(f"[infrasight-crypt]\ntype = crypt\nremote = {encrypted}\nfilename_encryption = standard\nno_data_encryption = true\npassword = {password}\n")
        os.environ["RCLONE_CONFIG"] = str(config)
        backup.stateFolder = root / "state"
        backup.stateFolder.mkdir()
        backup.saveJson(backup.stateFolder / "settings.json", {"database": str(source)})

        backup.backup()
        status = json.loads((backup.stateFolder / "status.json").read_text())
        assert status["result"] == "success"
        name = status["lastFile"]
        [ciphertext] = list(encrypted.iterdir())
        assert ciphertext.name != name
        assert not ciphertext.read_bytes().startswith(b"SQLite format 3")
        assert writer.execute("SELECT count(*) FROM sessions").fetchone() == (1,)

        backup.restoreCheck(name)
        with TemporaryDirectory() as restoreDir:
            copy = Path(restoreDir) / "restored.db"
            backup.transfer(backup.remote + name, copy)
            with closing(backup.openReadOnly(copy)) as recovered:
                assert recovered.execute("SELECT value FROM readings").fetchone() == ("test data",)
                for table in backup.authTables:
                    assert recovered.execute(f'SELECT count(*) FROM "{table}"').fetchone() == (0,)

        # Failure preserves the last good backup and records the failed attempt.
        backup.saveJson(backup.stateFolder / "settings.json", {"database": str(root / "missing.db")})
        try:
            backup.backup()
        except sqlite3.Error:
            pass
        else:
            raise AssertionError("Missing DB should fail")
        failed = json.loads((backup.stateFolder / "status.json").read_text())
        assert failed["result"] == "failed"
        assert failed["lastFile"] == name
        assert list(encrypted.iterdir()) == [ciphertext]

print("PASS: live WAL rows recovered, ciphertext uploaded and downloaded, auth cleared only from copy, failed run preserves previous backup.")