"""Public release compatibility metadata shared with the immutable site bundle."""
import json
from pathlib import Path

METADATA = json.loads(Path(__file__).with_name("release-metadata.json").read_text(encoding="utf-8"))
SCHEMA_REVISION = METADATA["schema_revision"]
WORKER_PROTOCOL = METADATA["worker_protocol"]
