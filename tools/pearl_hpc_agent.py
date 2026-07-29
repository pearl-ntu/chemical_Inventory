#!/usr/bin/env python3
"""Small PEARL HPC agent.

Run this inside a Linux/HPC account, usually behind an SSH tunnel.
It exposes a local HTTP API that PEARL can use to run light shell commands and
scan calculation output files. Python 3.6 compatible on purpose for older HPCs.
"""

import json
import os
import platform
import re
import subprocess
import sys
import getpass
import socket
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PEARL_AGENT_PORT", "8787"))
TOKEN = os.environ.get("PEARL_AGENT_TOKEN", "")
ROOT = os.path.abspath(os.environ.get("PEARL_AGENT_ROOT", os.getcwd()))
MAX_OUTPUT = int(os.environ.get("PEARL_AGENT_MAX_OUTPUT", "200000"))
MAX_FILES = int(os.environ.get("PEARL_AGENT_MAX_FILES", "8000"))
ACCOUNT_LABEL = os.environ.get("PEARL_AGENT_ACCOUNT", getpass.getuser() + "@" + socket.gethostname())
ALLOW_WRITES = os.environ.get("PEARL_AGENT_ALLOW_WRITES", "").lower() in ("1", "true", "yes")
DANGEROUS_RE = re.compile(
    r"(^|[;&|]\s*)(rm|rmdir|mv|cp|touch|mkdir|chmod|chown|dd|truncate|tee|install|unlink|shred|rsync|scp)\b|"
    r"(^|[;&|]\s*)(python|python3|perl|ruby|node|bash|sh)\b.*\b(open|write|remove|unlink|rmtree)\b|"
    r"(^|[^<])>\s*[^&]|>>|<\(|\|\s*tee\b",
    re.I,
)


def inside_root(path):
    target = os.path.abspath(os.path.join(ROOT, path or "."))
    root = ROOT.rstrip(os.sep)
    if target == root or target.startswith(root + os.sep):
        return target
    raise ValueError("Path is outside PEARL_AGENT_ROOT")


def response(handler, code, body):
    raw = json.dumps(body).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "content-type, authorization")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def read_json(handler):
    length = int(handler.headers.get("content-length", "0"))
    if length <= 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def authorized(handler):
    if not TOKEN:
        return True
    return handler.headers.get("authorization") == "Bearer " + TOKEN


def run_command(command, cwd):
    if not ALLOW_WRITES and DANGEROUS_RE.search(command):
        return {
            "code": 126,
            "stdout": "",
            "stderr": "Blocked by PEARL read-only mode. Use ls/find/grep/tail/cat/du/pwd/qstat-style commands, or scan a folder. Set PEARL_AGENT_ALLOW_WRITES=1 only if you intentionally want write commands.",
            "cwd": cwd,
        }
    shell = "powershell.exe" if platform.system().lower().startswith("win") else "/bin/bash"
    proc = subprocess.Popen(
        command,
        cwd=cwd,
        shell=True,
        executable=None if shell == "powershell.exe" else shell,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.PIPE,
    )
    try:
        stdout, stderr = proc.communicate(timeout=120)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate()
        stderr += b"\nCommand timed out after 120 seconds"
    return {
        "code": proc.returncode,
        "stdout": stdout.decode("utf-8", "replace")[-MAX_OUTPUT:],
        "stderr": stderr.decode("utf-8", "replace")[-MAX_OUTPUT:],
        "cwd": cwd,
    }


def tail_text(path):
    with open(path, "rb") as fh:
        try:
            fh.seek(-300000, os.SEEK_END)
        except OSError:
            fh.seek(0)
        return fh.read().decode("utf-8", "replace")


def detect_software(name, lower):
    if "gamess" in lower or "firefly" in lower or "g a m e s s" in lower:
        return "GAMESS"
    if name in ("OUTCAR", "vasprun.xml") or "vasp" in lower:
        return "VASP"
    if "o   r   c   a" in lower or "orca terminated" in lower:
        return "ORCA"
    if "gaussian" in lower or "normal termination of gaussian" in lower or "scf done:" in lower:
        return "Gaussian"
    return None


def first_match(pattern, text):
    match = re.search(pattern, text, re.I)
    return match.group(1).strip() if match else None


def parse_calculation(path):
    name = os.path.basename(path)
    text = tail_text(path)
    lower = text.lower()
    path_lower = path.lower()
    software = detect_software(name, lower)
    if not software and "/gamess/" in path_lower:
        software = "GAMESS"
    if not software:
        return None
    energy = (
        first_match(r"total energy\s*=\s*(-?\d+(?:\.\d+)?)", text)
        or first_match(r"final.*energy\s*(?:is|=)\s*(-?\d+(?:\.\d+)?)", text)
        or first_match(r"final single point energy\s+(-?\d+(?:\.\d+)?)", text)
        or first_match(r"scf done:\s+e\([^)]+\)\s+=\s+(-?\d+(?:\.\d+)?)", text)
        or first_match(r"free\s+energy\s+totEN\s+=\s+(-?\d+(?:\.\d+)?)", text)
    )
    if software == "GAMESS":
        method = first_match(r"CONTRL OPTIONS.*?SCFTYP=([A-Z0-9]+)", text) or first_match(
            r"SCFTYP=([A-Z0-9]+)", text
        )
    else:
        method = first_match(r"!\s*([A-Z0-9+\-]+\s+[A-Z0-9+\-*/(),]+)", text) or first_match(
            r"#\s*([A-Za-z0-9+\-_/(),= ]+)", text
        )
    warnings = []
    if "error" in lower:
        warnings.append("error found")
    if "warning" in lower:
        warnings.append("warning found")
    if "imaginary" in lower:
        warnings.append("imaginary frequency mention")
    complete = (
        "normal termination" in lower
        or "orca terminated normally" in lower
        or "terminated normally" in lower
        or "execution of gamess terminated normally" in lower
        or "total run time" in lower
        or "reached required accuracy" in lower
    )
    failed = "error termination" in lower or "aborting the run" in lower or "segmentation fault" in lower
    return {
        "title": name,
        "software": software,
        "method": method,
        "project": os.path.basename(os.path.dirname(path)),
        "status": "failed" if failed else "complete" if complete else "running",
        "output_file": path,
        "final_energy": energy,
        "warnings": warnings,
    }


def aggregate_by_folder(files):
    groups = {}
    for row in files:
        folder = os.path.dirname(row.get("path") or row.get("output_file") or "")
        if not folder:
            continue
        groups.setdefault(folder, []).append(row)

    summaries = []
    for folder, rows in sorted(groups.items()):
        rows = sorted(rows, key=lambda r: r.get("output_file") or "")
        main = None
        for row in rows:
            name = os.path.basename(row.get("output_file") or "")
            if "_iter" not in name.lower():
                main = row
                break
        if main is None:
            main = rows[-1]
        statuses = [r.get("status") for r in rows]
        status = "failed" if "failed" in statuses else "complete" if "complete" in statuses else "running"
        energies = [str(r.get("final_energy")) for r in rows if r.get("final_energy")]
        warnings = []
        for row in rows:
            for warning in row.get("warnings") or []:
                if warning not in warnings:
                    warnings.append(warning)
        file_names = [os.path.basename(r.get("output_file") or "") for r in rows]
        notes = [
            "Folder summary imported by PEARL HPC agent.",
            "Files scanned: " + str(len(rows)),
            "Files: " + "; ".join(file_names[:40]),
        ]
        if len(file_names) > 40:
            notes.append("Additional files omitted from note: " + str(len(file_names) - 40))
        if energies:
            notes.append("Parsed energies: " + "; ".join(energies[:12]))
        if warnings:
            notes.append("Warnings: " + "; ".join(warnings))
        stat_size = sum(int(r.get("size_bytes") or 0) for r in rows)
        latest = max([r.get("last_modified") for r in rows if r.get("last_modified")] or [""])
        summaries.append(
            {
                "title": os.path.basename(folder) or os.path.basename(os.path.dirname(folder)) or "HPC calculation folder",
                "project": os.path.basename(folder),
                "path": folder,
                "software": main.get("software"),
                "method": main.get("method"),
                "status": status,
                "output_file": main.get("output_file"),
                "final_energy": main.get("final_energy"),
                "warnings": warnings,
                "notes": "\n".join(notes),
                "size_bytes": stat_size,
                "size_label": str(stat_size) + " bytes",
                "last_modified": latest,
            }
        )
    return summaries


def scan(root):
    parsed_files = []
    count = 0
    interesting_ext = set([".log", ".out", ".inp", ".gjf", ".com", ".xml"])
    interesting_names = set(["OUTCAR", "vasprun.xml"])
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", ".git", "__pycache__")]
        for name in files:
            if count >= MAX_FILES:
                return rows
            count += 1
            ext = os.path.splitext(name)[1].lower()
            if ext not in interesting_ext and name not in interesting_names:
                continue
            path = os.path.join(current, name)
            try:
                parsed = parse_calculation(path)
                if parsed:
                    stat = os.stat(path)
                    parsed.update(
                        {
                            "path": path,
                            "size_bytes": stat.st_size,
                            "size_label": str(stat.st_size) + " bytes",
                            "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        }
                    )
                    parsed_files.append(parsed)
            except Exception:
                continue
    return aggregate_by_folder(parsed_files)


def list_folder(path):
    folder = inside_root(path)
    entries = []
    for name in sorted(os.listdir(folder)):
        if name.startswith("."):
            continue
        full = os.path.join(folder, name)
        try:
            stat = os.stat(full)
            entries.append(
                {
                    "name": name,
                    "path": full,
                    "type": "dir" if os.path.isdir(full) else "file",
                    "size_bytes": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                }
            )
        except Exception:
            continue
    return entries


def read_file(path):
    target = inside_root(path)
    if os.path.isdir(target):
        raise ValueError("Path is a folder, not a file")
    stat = os.stat(target)
    if stat.st_size > 2 * 1024 * 1024:
        text = tail_text(target)
        truncated = True
    else:
        with open(target, "rb") as fh:
            text = fh.read().decode("utf-8", "replace")
        truncated = False
    return {
        "path": target,
        "name": os.path.basename(target),
        "size_bytes": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "truncated": truncated,
        "content": text,
    }


def safe_bundle_name(name):
    name = str(name or "").replace("\\", "/").strip("/")
    parts = [p for p in name.split("/") if p and p not in (".", "..")]
    if not parts:
        raise ValueError("Generated file has no filename")
    for part in parts:
        if "/" in part or "\x00" in part:
            raise ValueError("Generated filename is not safe")
    return os.path.join(*parts)


def write_bundle(target, files, overwrite=False):
    if not ALLOW_WRITES:
        raise ValueError("PEARL agent write mode is disabled. Restart the agent with PEARL_AGENT_ALLOW_WRITES=1 to send generated files to HPC.")
    if not isinstance(files, list) or not files:
        raise ValueError("No files provided")
    target_dir = inside_root(target or ".")
    os.makedirs(target_dir, exist_ok=True)
    written = []
    for row in files:
        filename = safe_bundle_name(row.get("filename"))
        content = row.get("content")
        if content is None:
            content = ""
        output = os.path.abspath(os.path.join(target_dir, filename))
        root = target_dir.rstrip(os.sep)
        if output != root and not output.startswith(root + os.sep):
            raise ValueError("Generated filename escapes target folder")
        if os.path.exists(output) and not overwrite:
            raise ValueError("File already exists: " + filename)
        folder = os.path.dirname(output)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(output, "w", encoding="utf-8") as handle:
            handle.write(str(content).replace("\r\n", "\n"))
        if output.endswith(".sh"):
            try:
                os.chmod(output, os.stat(output).st_mode | 0o111)
            except Exception:
                pass
        written.append(output)
    return {"ok": True, "target": target_dir, "count": len(written), "files": written}


class AgentHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        response(self, 200, {"ok": True})

    def do_GET(self):
        if not authorized(self):
            return response(self, 401, {"error": "Unauthorized agent token"})
        if self.path.split("?")[0] == "/health":
            return response(self, 200, {"ok": True, "root": ROOT, "port": PORT, "python": sys.version.split()[0], "account": ACCOUNT_LABEL})
        return response(self, 404, {"error": "Unknown PEARL agent route"})

    def do_POST(self):
        if not authorized(self):
            return response(self, 401, {"error": "Unauthorized agent token"})
        try:
            body = read_json(self)
            route = self.path.split("?")[0]
            if route == "/run":
                command = str(body.get("command", "")).strip()
                if not command:
                    raise ValueError("No command provided")
                cwd = inside_root(str(body.get("cwd", ".")))
                return response(self, 200, run_command(command, cwd))
            if route == "/scan":
                root = inside_root(str(body.get("root", ".")))
                if not os.path.exists(root):
                    raise ValueError("Scan path does not exist")
                jobs = scan(root)
                return response(self, 200, {"jobs": jobs, "count": len(jobs), "root": root, "account": ACCOUNT_LABEL})
            if route == "/list":
                return response(self, 200, {"entries": list_folder(str(body.get("path", "."))), "root": ROOT, "account": ACCOUNT_LABEL})
            if route == "/file":
                return response(self, 200, read_file(str(body.get("path", "."))))
            if route == "/write-bundle":
                return response(self, 200, write_bundle(str(body.get("target", ".")), body.get("files"), bool(body.get("overwrite"))))
            return response(self, 404, {"error": "Unknown PEARL agent route"})
        except Exception as exc:
            return response(self, 400, {"error": str(exc)})

    def log_message(self, fmt, *args):
        sys.stderr.write("PEARL agent: " + (fmt % args) + "\n")


if __name__ == "__main__":
    print("PEARL HPC agent listening on http://127.0.0.1:%s" % PORT)
    print("Root: %s" % ROOT)
    if not TOKEN:
        print("No PEARL_AGENT_TOKEN set. Use only on trusted localhost/private networks.")
    HTTPServer(("127.0.0.1", PORT), AgentHandler).serve_forever()
