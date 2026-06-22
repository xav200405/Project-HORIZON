#!/usr/bin/env python3
"""Fetch the newest TP-ARC RMS package from GitHub."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_PATTERN = r"^tparc-rms-pi-app-.*\.tar\.gz$"
DEFAULT_REPO = "xav200405/Project-HORIZON"
DEFAULT_SOURCE_PATH = "dashboard"
MAX_REPO_SCAN_DEPTH = 5


def request_json(url: str, token: str | None):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "tparc-rms-updater",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def download(url: str, target: Path, token: str | None) -> None:
    headers = {"User-Agent": "tparc-rms-updater"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as response, target.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def select_asset(release: dict, pattern: str) -> dict:
    regex = re.compile(pattern)
    matches = [asset for asset in release.get("assets", []) if regex.search(asset.get("name", ""))]
    if not matches:
        names = ", ".join(asset.get("name", "") for asset in release.get("assets", [])) or "none"
        raise ValueError(f"No release asset matched {pattern!r}. Available assets: {names}")
    return sorted(matches, key=lambda asset: asset.get("name", ""))[-1]


def select_repo_file(entries: list[dict], pattern: str) -> dict:
    regex = re.compile(pattern)
    matches = [
        entry
        for entry in entries
        if entry.get("type") == "file"
        and regex.search(entry.get("name", ""))
        and entry.get("download_url")
    ]
    if not matches:
        names = ", ".join(entry.get("name", "") for entry in entries) or "none"
        raise SystemExit(f"No repository file matched {pattern!r}. Available files: {names}")
    return sorted(matches, key=lambda entry: entry.get("name", ""))[-1]


def repo_contents(repo: str, source_path: str, token: str | None):
    encoded_path = urllib.parse.quote(source_path.strip("/"), safe="/")
    api = f"https://api.github.com/repos/{repo}/contents/{encoded_path}"
    return request_json(api, token)


def collect_repo_packages(repo: str, source_path: str, pattern: str, token: str | None, depth: int = 0) -> list[dict]:
    entries = repo_contents(repo, source_path, token)
    if not isinstance(entries, list):
        raise SystemExit(f"GitHub path is not a folder: {source_path}")

    regex = re.compile(pattern)
    packages = [
        entry
        for entry in entries
        if entry.get("type") == "file"
        and regex.search(entry.get("name", ""))
        and entry.get("download_url")
    ]
    if depth >= MAX_REPO_SCAN_DEPTH:
        return packages

    for entry in entries:
        if entry.get("type") != "dir":
            continue
        name = entry.get("name", "")
        if name.startswith(".") or name in {"__pycache__", "node_modules", ".venv", "venv"}:
            continue
        packages.extend(collect_repo_packages(repo, entry.get("path", ""), pattern, token, depth + 1))
    return packages


def find_release_asset(repo: str, pattern: str, token: str | None) -> tuple[str, str, str]:
    api = f"https://api.github.com/repos/{repo}/releases/latest"
    release = request_json(api, token)
    asset = select_asset(release, pattern)
    return asset["name"], asset["browser_download_url"], f"latest release {release.get('tag_name', 'unknown')}"


def find_repo_file(repo: str, source_path: str, pattern: str, token: str | None) -> tuple[str, str, str]:
    packages = collect_repo_packages(repo, source_path, pattern, token)
    package = select_repo_file(packages, pattern)
    return package["name"], package["download_url"], f"repository folder scan under {source_path}"


def safe_extract(package: Path, target: Path) -> Path:
    with tarfile.open(package, "r:gz") as tar:
        members = tar.getmembers()
        for member in members:
            resolved = (target / member.name).resolve()
            if not str(resolved).startswith(str(target.resolve())):
                raise SystemExit(f"Unsafe archive path: {member.name}")
        tar.extractall(target)
    app_dir = target / "tparc-rms-pi-app"
    update = app_dir / "update.sh"
    if not update.exists():
        raise SystemExit("Downloaded package does not contain tparc-rms-pi-app/update.sh")
    return app_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=os.environ.get("TPARC_UPDATE_REPO", DEFAULT_REPO), help="GitHub repository in owner/name form")
    parser.add_argument("--asset-pattern", default=os.environ.get("TPARC_UPDATE_ASSET_PATTERN", DEFAULT_PATTERN))
    parser.add_argument("--source-path", default=os.environ.get("TPARC_UPDATE_SOURCE_PATH", DEFAULT_SOURCE_PATH), help="Repository folder fallback to scan for package tarballs")
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN") or os.environ.get("TPARC_UPDATE_TOKEN"))
    parser.add_argument("--keep-download", action="store_true", help="Download and extract but do not run update.sh")
    args = parser.parse_args()

    if not args.repo or "/" not in args.repo:
        raise SystemExit("Set TPARC_UPDATE_REPO to a GitHub repository in owner/name form")

    try:
        name, url, source = find_release_asset(args.repo, args.asset_pattern, args.token)
    except (ValueError, urllib.error.HTTPError, urllib.error.URLError) as exc:
        if not args.source_path:
            raise SystemExit(f"GitHub release lookup failed and no source path is configured: {exc}") from exc
        print(f"Release asset lookup did not produce a package: {exc}")
        print(f"Falling back to repository folder scan: {args.source_path}")
        try:
            name, url, source = find_repo_file(args.repo, args.source_path, args.asset_pattern, args.token)
        except urllib.error.HTTPError as folder_exc:
            raise SystemExit(f"GitHub folder lookup failed: HTTP {folder_exc.code}") from folder_exc
        except urllib.error.URLError as folder_exc:
            raise SystemExit(f"GitHub folder lookup failed: {folder_exc.reason}") from folder_exc

    print(f"Update source: {source}")
    print(f"Downloading: {name}")

    with tempfile.TemporaryDirectory(prefix="tparc-rms-update-") as tmp:
        tmp_path = Path(tmp)
        package = tmp_path / name
        download(url, package, args.token)
        app_dir = safe_extract(package, tmp_path)
        print(f"Extracted: {app_dir}")
        if args.keep_download:
            print(f"Package downloaded to temporary folder: {package}")
            return 0
        update = app_dir / "update.sh"
        print("Running package update.sh")
        return subprocess.call(["bash", str(update), "--local"])


if __name__ == "__main__":
    sys.exit(main())
