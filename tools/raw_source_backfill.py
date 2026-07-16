# -*- coding: utf-8 -*-
"""Reproducible raw_source backfill from trusted transcript line ranges.

The selector (human or LLM) supplies only 1-based inclusive line numbers. This
tool copies bytes decoded from the source file; generated paraphrases never
enter raw_source. Generation is dry-run by default. Applying requires the same
source file, verifies SHA-256, snapshots prior values, and supports rollback.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

MAX_RAW_CHARS = 8000
CANDIDATE_SCHEMA = "raw-source-candidate/v1"
SNAPSHOT_SCHEMA = "raw-source-snapshot/v1"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def read_json_records(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    if path.lower().endswith(".json"):
        value = json.loads(text)
        if not isinstance(value, list):
            raise ValueError("JSON range/candidate file must contain an array")
        return value
    records = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            records.append(json.loads(line))
        except Exception as error:
            raise ValueError(f"invalid JSONL at line {line_no}: {error}") from error
    return records


def write_jsonl(path: str, records: list[dict]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def build_candidates(source_bytes: bytes, ranges: list[dict], source_name: str):
    text = source_bytes.decode("utf-8-sig")
    lines = text.splitlines(keepends=True)
    source_hash = sha256_bytes(source_bytes)
    candidates = []
    errors = []
    seen = set()

    for index, item in enumerate(ranges, start=1):
        bucket_id = str(item.get("bucket_id") or item.get("id") or "").strip()[:64]
        try:
            start = int(item.get("start_line"))
            end = int(item.get("end_line"))
        except (TypeError, ValueError):
            errors.append({"row": index, "bucket_id": bucket_id, "error": "line numbers must be integers"})
            continue
        if not bucket_id:
            errors.append({"row": index, "bucket_id": "", "error": "bucket_id is required"})
            continue
        if bucket_id in seen:
            errors.append({"row": index, "bucket_id": bucket_id, "error": "duplicate bucket_id"})
            continue
        if start < 1 or end < start or end > len(lines):
            errors.append({
                "row": index,
                "bucket_id": bucket_id,
                "error": f"range {start}..{end} outside 1..{len(lines)}",
            })
            continue
        raw_source = "".join(lines[start - 1:end])
        if not raw_source:
            errors.append({"row": index, "bucket_id": bucket_id, "error": "selected range is empty"})
            continue
        if len(raw_source) > MAX_RAW_CHARS:
            errors.append({
                "row": index,
                "bucket_id": bucket_id,
                "error": f"selected text is {len(raw_source)} chars; max is {MAX_RAW_CHARS}",
            })
            continue
        seen.add(bucket_id)
        candidates.append({
            "schema": CANDIDATE_SCHEMA,
            "bucket_id": bucket_id,
            "source_name": os.path.basename(source_name),
            "source_sha256": source_hash,
            "start_line": start,
            "end_line": end,
            "raw_source": raw_source,
            "raw_sha256": sha256_text(raw_source),
            "chars": len(raw_source),
            "note": str(item.get("note") or "")[:500],
        })
    return candidates, errors


def validate_candidate(candidate: dict, source_sha256: str) -> None:
    if candidate.get("schema") != CANDIDATE_SCHEMA:
        raise ValueError("unsupported candidate schema")
    if candidate.get("source_sha256") != source_sha256:
        raise ValueError("source file SHA-256 does not match candidate")
    raw_source = candidate.get("raw_source")
    if not isinstance(raw_source, str) or not raw_source:
        raise ValueError("candidate raw_source is empty")
    if len(raw_source) > MAX_RAW_CHARS:
        raise ValueError("candidate exceeds raw_source limit")
    if candidate.get("raw_sha256") != sha256_text(raw_source):
        raise ValueError("candidate raw_source SHA-256 mismatch")


def http_json(url, token, data=None):
    headers = {"X-Admin-Token": token, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(data, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, headers=headers, data=data)
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def bucket_detail(base, token, bucket_id):
    return http_json(f"{base}/api/bucket/{urllib.parse.quote(bucket_id)}", token)


def update_bucket(base, token, bucket_id, raw_source):
    return http_json(
        f"{base}/api/bucket/{urllib.parse.quote(bucket_id)}/update",
        token,
        {"raw_source": raw_source},
    )


def generate(args):
    with open(args.source, "rb") as handle:
        source_bytes = handle.read()
    ranges = read_json_records(args.ranges)
    candidates, errors = build_candidates(source_bytes, ranges, args.source)
    output = args.output or os.path.join(
        os.path.dirname(__file__), f"raw_source_candidates_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    )
    write_jsonl(output, candidates)
    if errors:
        write_jsonl(output + ".errors.jsonl", errors)
    print(f"dry-run candidates={len(candidates)} errors={len(errors)} output={output}")
    return 1 if errors else 0


def apply_candidates(args, base, token):
    if not args.source:
        raise ValueError("--source is required with --apply")
    with open(args.source, "rb") as handle:
        source_hash = sha256_bytes(handle.read())
    candidates = read_json_records(args.apply)
    for candidate in candidates:
        validate_candidate(candidate, source_hash)

    prepared = []
    snapshots = []
    for candidate in candidates:
        bucket_id = str(candidate.get("bucket_id") or "")
        detail = bucket_detail(base, token, bucket_id)
        meta = detail.get("metadata") or {}
        existing = str(meta.get("raw_source") or "")
        snapshots.append({
            "schema": SNAPSHOT_SCHEMA,
            "bucket_id": bucket_id,
            "had_raw_source": bool(existing),
            "raw_source": existing,
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })
        if existing and not args.force:
            continue
        prepared.append(candidate)

    snapshot_path = args.snapshot or os.path.join(
        os.path.dirname(__file__), f"raw_source_snapshot_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    )
    write_jsonl(snapshot_path, snapshots)
    ok = 0
    failures = []
    for candidate in prepared:
        try:
            result = update_bucket(base, token, candidate["bucket_id"], candidate["raw_source"])
            if not result.get("ok"):
                raise RuntimeError(str(result))
            ok += 1
        except Exception as error:
            failures.append({"bucket_id": candidate["bucket_id"], "error": str(error)})
    print(
        f"applied={ok} skipped_existing={len(candidates) - len(prepared)} "
        f"failed={len(failures)} snapshot={snapshot_path}"
    )
    if failures:
        write_jsonl(snapshot_path + ".failures.jsonl", failures)
        return 1
    return 0


def rollback(args, base, token):
    snapshots = read_json_records(args.rollback)
    ok = 0
    failures = []
    for snapshot in snapshots:
        if snapshot.get("schema") != SNAPSHOT_SCHEMA:
            failures.append({"bucket_id": snapshot.get("bucket_id"), "error": "unsupported snapshot schema"})
            continue
        try:
            raw_source = snapshot.get("raw_source") if snapshot.get("had_raw_source") else ""
            result = update_bucket(base, token, snapshot["bucket_id"], raw_source)
            if not result.get("ok"):
                raise RuntimeError(str(result))
            ok += 1
        except Exception as error:
            failures.append({"bucket_id": snapshot.get("bucket_id"), "error": str(error)})
    print(f"restored={ok} failed={len(failures)}")
    return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", default="", help="apply a reviewed candidate JSONL")
    mode.add_argument("--rollback", default="", help="restore a snapshot JSONL")
    parser.add_argument("--source", default="", help="UTF-8 transcript; required to generate/apply")
    parser.add_argument("--ranges", default="", help="JSON/JSONL rows: bucket_id,start_line,end_line")
    parser.add_argument("--output", default="")
    parser.add_argument("--snapshot", default="")
    parser.add_argument("--force", action="store_true", help="allow replacing an existing raw_source")
    parser.add_argument("--url", default=os.environ.get("OMBRE_BRAIN_URL", ""))
    parser.add_argument("--token", default=os.environ.get("OMBRE_ADMIN_TOKEN", ""))
    args = parser.parse_args()

    if not args.apply and not args.rollback:
        if not args.source or not args.ranges:
            parser.error("generation requires --source and --ranges")
        return generate(args)
    base = args.url.rstrip("/")
    if not base:
        parser.error("apply/rollback requires OMBRE_BRAIN_URL or --url")
    if args.apply:
        return apply_candidates(args, base, args.token)
    return rollback(args, base, args.token)


if __name__ == "__main__":
    sys.exit(main())
