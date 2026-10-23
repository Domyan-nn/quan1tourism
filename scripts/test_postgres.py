"""Run tests against a new loopback PostgreSQL cluster, never normal local/cloud data."""
import argparse
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin", default="", help="Directory containing initdb and pg_ctl")
    args = parser.parse_args()
    binary = Path(args.bin) if args.bin else Path(shutil.which("pg_ctl") or "C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe").parent
    suffix = ".exe" if os.name == "nt" else ""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    runtime = ROOT / ".runtime"
    runtime.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pg-ci-", dir=runtime) as directory:
        data = Path(directory) / "data"
        # pg_ctl can leave inherited pipe handles open in Windows background children.
        common = {"check": True, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                  "creationflags": subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0}
        subprocess.run([str(binary / ("initdb" + suffix)), "-D", str(data), "-U", "ci", "--auth=trust", "--encoding=UTF8", "--no-locale"], **common)
        ctl = [str(binary / ("pg_ctl" + suffix)), "-D", str(data)]
        subprocess.run([*ctl, "-l", str(Path(directory) / "postgres.log"), "-o", f"-h 127.0.0.1 -p {port}", "-w", "start"], **common)
        try:
            subprocess.run([str(binary / ("createdb" + suffix)), "-h", "127.0.0.1", "-p", str(port), "-U", "ci", "quan1_ci"], **common)
            environment = {**os.environ, "TEST_POSTGRES_URL": f"postgresql+psycopg://ci@127.0.0.1:{port}/quan1_ci",
                           "QUAN1_IGNORE_LOCAL_ENV": "1"}
            return subprocess.call([sys.executable, "-m", "pytest", "--postgres", "-q", "-s", "--tb=short", "--maxfail=3",
                                    "--basetemp", str(Path(directory) / "pytest"),
                                    "-o", "cache_dir=" + str(Path(directory) / "pytest-cache")],
                                   cwd=ROOT / "services/backend", env=environment)
        finally:
            subprocess.run([*ctl, "-m", "fast", "-w", "stop"], **common)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError:
        sys.exit("Disposable PostgreSQL setup failed; no existing database was used.")
