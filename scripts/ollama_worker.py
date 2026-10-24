"""Run on the PC with Ollama. Poll Render over HTTPS; never connect to its DB."""

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "backend"))

from app import config  # noqa: E402,F401
from app.wikipedia import NoRedirects, generate_draft, ollama_status  # noqa: E402
from app.narration_generation import GenerationFailure, PROMPT_VERSION  # noqa: E402
from app.translation_validation import ERROR_CODES  # noqa: E402


def server_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
    )) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("AI_SERVER_URL must be an HTTPS origin, or http://127.0.0.1:8000 for local testing.")
    return value.rstrip("/")


def call_server(origin, token, path, payload):
    request = Request(origin + "/api/v1/worker" + path, method="POST", headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json", "X-Requested-With": "Quan1Admin",
    }, data=json.dumps(payload, ensure_ascii=False).encode())
    # Never forward a worker credential through redirects.
    with build_opener(NoRedirects()).open(request, timeout=30) as response:
        return json.loads(response.read(4_000_001))


def process_job(job):
    payload = job["payload"]
    context = {key: payload[key] for key in ("locale", "source_revision", "source_hash") if key in payload}
    try:
        if payload.get("kind") == "supplement":
            from app.narration_generation import generate_translation

            return {"lease": job["lease"], **context, **generate_translation(payload)}
        result = generate_draft(payload["article"]["url"], payload["categories"], payload["languages"],
                                article=payload["article"])
        return {"lease": job["lease"], **result}
    except GenerationFailure as exc:
        return {"lease": job["lease"], **context, "error": exc.codes[0], "issue_codes": exc.codes,
                "validation": exc.validation, "timings": exc.timings,
                "prompt_version": PROMPT_VERSION, "output_mode": "schema"}
    except HTTPException as exc:
        code = exc.detail if isinstance(exc.detail, str) and exc.detail in ERROR_CODES else (
            "model_timeout" if exc.status_code == 504 else "worker_unavailable" if exc.status_code == 503 else "generation_failed")
        return {"lease": job["lease"], **context, "error": code, "issue_codes": [code]}
    except TimeoutError:
        return {"lease": job["lease"], **context, "error": "model_timeout", "issue_codes": ["model_timeout"]}
    except OSError:
        return {"lease": job["lease"], **context, "error": "worker_unavailable", "issue_codes": ["worker_unavailable"]}
    except Exception:
        return {"lease": job["lease"], **context, "error": "generation_failed", "issue_codes": ["generation_failed"]}


def run(origin, token, *, once=False):
    stopped = threading.Event()
    current = {}

    def heartbeat():
        while not stopped.is_set():
            try:
                status = ollama_status()
                call_server(origin, token, "/heartbeat", {"model": status["model"], "ready": status["ready"],
                                                         "protocol": 3, **current})
            except Exception:
                pass  # Never print exception URLs, response bodies, or credentials.
            stopped.wait(20)

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    print("Local AI worker started. Keep Ollama and this terminal running. Ctrl+C to stop.", flush=True)
    try:
        while True:
            try:
                if not ollama_status()["ready"]:
                    print("Ollama/model is not ready. Retrying...", flush=True)
                else:
                    job = call_server(origin, token, "/claim", {"protocol": 3}).get("job")
                    if job:
                        current.update(job_id=job['id'], lease=job['lease'])
                        print("Generating one AI task...", flush=True)
                        started = time.monotonic()
                        result = process_job(job)
                        result.setdefault("timings", {}).setdefault("generation_seconds", round(time.monotonic() - started, 3))
                        # Lost completion responses are retried with the same lease.
                        for attempt in range(3):
                            try:
                                outcome = call_server(origin, token, f"/jobs/{job['id']}/complete", result)
                                print("Result needs administrator review." if outcome.get("status") == "completed"
                                      else "AI task failed: " + ",".join(c for c in outcome.get("issue_codes", []) if c in ERROR_CODES), flush=True)
                                break
                            except HTTPError as exc:
                                if exc.code in {401, 403, 409, 422}:
                                    print(f"Result was rejected (HTTP {exc.code}).", flush=True)
                                    break
                                if attempt < 2:
                                    stopped.wait(2 ** attempt)
                            except Exception:
                                if attempt < 2:
                                    stopped.wait(2 ** attempt)
                        current.clear()
                        if not once:
                            continue  # No five-second delay between queued tasks.
            except HTTPError as exc:
                print(f"Server unavailable (HTTP {exc.code}). Check worker configuration.", flush=True)
            except Exception:
                print("Cannot reach server. Retrying...", flush=True)
            if once:
                break
            stopped.wait(5)
    except KeyboardInterrupt:
        print("Worker stopped.", flush=True)
    finally:
        stopped.set()
        thread.join(timeout=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Check the connection and handle at most one job")
    args = parser.parse_args()
    try:
        origin = server_url(os.getenv("AI_SERVER_URL", ""))
        token = os.getenv("AI_WORKER_TOKEN", "")
        if len(token) < 32:
            raise ValueError("Set AI_WORKER_TOKEN (at least 32 characters) in .runtime/local.env and Render.")
    except ValueError as exc:
        parser.error(str(exc))
    run(origin, token, once=args.once)
