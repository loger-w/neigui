"""Harness 載入帳量測 + 處置表驗證(design v12 §4.2 / SC-2 / SC-2b / SC-3)。

用法:
  harness_load_estimate.py --profile feat-L --scope main [--worst]
  harness_load_estimate.py --before feat-L-before --after feat-L --scope main [--worst]
  harness_load_estimate.py --verify-dispositions

資料源:
  <claude>/harness/load-manifest.json    載入帳(spec 不寫數字,由本腳本求和)
  <claude>/harness/dispositions.json     §5 處置表的機器可讀版
  <claude>/plugins/installed_plugins.json  <superpowers> 佔位符解析

設計約束:
  * `<superpowers>` 的比對基準是 **profile 自己宣告的 project_root**,不是 process cwd。
    腳本住在 ~/.claude/hooks,而 SC-4 的量法本身就 cd 進該目錄 —— 用 cwd 會解到非在役
    的舊版本,而 SC-1 / SC-2 是百分比降幅,兩側基準不同比值直接失真。
  * 解不到版本、manifest 列了不存在的檔、profile 缺 project_root → 一律 exit 非 0,
    不得靜默略過(靜默略過 = 假綠)。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SUPERPOWERS_TOKEN = "<superpowers>"
PLUGIN_KEY = "superpowers@claude-plugins-official"

# 訊息含中文,而 Windows console 預設不是 UTF-8 —— 不固定住的話,呼叫端(pytest /
# 其他工具)以 UTF-8 讀 stdout/stderr 會 UnicodeDecodeError。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")


class ConfigError(Exception):
    """Manifest / dispositions 本身寫錯 —— 不是量測結果,是設定錯。"""


# ---------------------------------------------------------------------------
# <superpowers> 解析
# ---------------------------------------------------------------------------


def _norm(p: str | Path) -> str:
    return os.path.normcase(os.path.normpath(str(p).replace("\\", "/")))


def _covers(parent: str, child: str) -> bool:
    """parent 路徑是否涵蓋 child(相同或為其祖先)。"""
    a, b = _norm(parent), _norm(child)
    return b == a or b.startswith(a.rstrip("/\\") + os.sep) or b.startswith(a.rstrip("/\\") + "/")


def resolve_superpowers(claude_dir: Path, project_root: str) -> Path:
    """依 profile 的 project_root 解析在役的 superpowers 安裝目錄。"""
    meta = claude_dir / "plugins" / "installed_plugins.json"
    if not meta.exists():
        raise ConfigError(f"SUPERPOWERS 解析失敗:找不到 {meta}")
    entries = json.loads(meta.read_text(encoding="utf-8")).get("plugins", {}).get(PLUGIN_KEY, [])
    if not entries:
        raise ConfigError(f"SUPERPOWERS 解析失敗:{PLUGIN_KEY} 不在 installed_plugins.json")

    user_entry = None
    for entry in entries:
        if entry.get("scope") == "project":
            pp = entry.get("projectPath")
            if pp and _covers(pp, project_root):
                return Path(entry["installPath"])
        elif entry.get("scope") == "user":
            user_entry = entry
    if user_entry is None:
        raise ConfigError(f"SUPERPOWERS 解析失敗:{PLUGIN_KEY} 無 user-scope entry")
    return Path(user_entry["installPath"])


# ---------------------------------------------------------------------------
# manifest 求和
# ---------------------------------------------------------------------------


def load_manifest(claude_dir: Path) -> dict:
    path = claude_dir / "harness" / "load-manifest.json"
    if not path.exists():
        raise ConfigError(f"找不到 load-manifest.json:{path}")
    return json.loads(path.read_text(encoding="utf-8"))


def get_profile(manifest: dict, name: str) -> dict:
    profiles = manifest.get("profiles", {})
    if name not in profiles:
        raise ConfigError(f"manifest 沒有 profile '{name}'(有:{sorted(profiles)})")
    prof = profiles[name]
    if not prof.get("project_root"):
        raise ConfigError(f"profile '{name}' 缺必填欄位 project_root")
    return prof


def resolve_path(claude_dir: Path, sp_dir: Path | None, rel: str) -> Path:
    if rel.startswith(SUPERPOWERS_TOKEN):
        assert sp_dir is not None  # 由 caller 保證:含 token 才會解析
        return sp_dir / rel[len(SUPERPOWERS_TOKEN) :].lstrip("/\\")
    return claude_dir / rel


def sum_profile(
    claude_dir: Path, manifest: dict, name: str, scope: str, worst: bool
) -> tuple[int, list[str], Path | None]:
    prof = get_profile(manifest, name)
    records = prof["files"]

    sp_dir = None
    if any(str(r["path"]).startswith(SUPERPOWERS_TOKEN) for r in records):
        sp_dir = resolve_superpowers(claude_dir, prof["project_root"])

    total = 0
    lines: list[str] = []
    missing: list[str] = []
    for rec in records:
        if rec.get("scope") != scope:
            continue
        if rec.get("condition") and not worst:
            continue
        target = resolve_path(claude_dir, sp_dir, rec["path"])
        if not target.exists():
            missing.append(f"{rec['path']} -> {target}")
            continue
        size = target.stat().st_size
        total += size
        phase = rec.get("phase")
        cond = " [cond]" if rec.get("condition") else ""
        lines.append(f"  {size:>7}  phase={phase}{cond}  {rec['path']}")
    if missing:
        raise ConfigError(
            "manifest 列了不存在的檔(靜默略過 = 假綠,故 exit 非 0):\n  " + "\n  ".join(missing)
        )
    return total, lines, sp_dir


# ---------------------------------------------------------------------------
# dispositions 驗證(SC-3)
# ---------------------------------------------------------------------------


def verify_dispositions(claude_dir: Path) -> int:
    path = claude_dir / "harness" / "dispositions.json"
    if not path.exists():
        raise ConfigError(f"找不到 dispositions.json:{path}")
    rows = json.loads(path.read_text(encoding="utf-8")).get("rows", [])
    if not rows:
        raise ConfigError("dispositions.json 沒有任何 row")

    violations: list[str] = []
    for idx, row in enumerate(rows):
        checks = row.get("checks") or []
        if not checks:
            raise ConfigError(
                f"row #{idx}({row.get('note', '?')})沒有任何 checks —— "
                "§5 填寫規則要求每一列至少一個檢查,空的是漏填不是通過"
            )
        for chk in checks:
            kind, rel, needle = chk["kind"], chk["file"], chk["string"]
            target = claude_dir / rel
            if not target.exists():
                violations.append(f"[{kind}] {rel}: 檔案不存在(needle={needle!r})")
                continue
            hit = needle in target.read_text(encoding="utf-8")
            if kind == "absent" and hit:
                violations.append(f"[absent] {rel}: 仍找得到 {needle!r}")
            elif kind == "present" and not hit:
                violations.append(f"[present] {rel}: 找不到 {needle!r}")
            elif kind not in ("absent", "present"):
                raise ConfigError(f"row #{idx} 有未知的 check kind:{kind!r}")

    print(f"VIOLATIONS n={len(violations)}")
    for v in violations:
        print(f"  {v}")
    return 1 if violations else 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--claude-dir", default=str(Path.home() / ".claude"))
    ap.add_argument("--profile")
    ap.add_argument("--before")
    ap.add_argument("--after")
    ap.add_argument("--scope", choices=["main", "subagent"], default="main")
    ap.add_argument("--worst", action="store_true")
    ap.add_argument("--verify-dispositions", action="store_true")
    args = ap.parse_args(argv)

    claude_dir = Path(args.claude_dir)

    try:
        if args.verify_dispositions:
            return verify_dispositions(claude_dir)

        manifest = load_manifest(claude_dir)

        if args.before or args.after:
            if not (args.before and args.after):
                raise ConfigError("--before 與 --after 必須成對給")
            b_total, _, b_sp = sum_profile(
                claude_dir, manifest, args.before, args.scope, args.worst
            )
            a_total, _, a_sp = sum_profile(claude_dir, manifest, args.after, args.scope, args.worst)
            if b_sp is not None and a_sp is not None and _norm(b_sp) != _norm(a_sp):
                raise ConfigError(
                    "SUPERPOWERS 兩側解到不同版本,降幅的分子分母基準不同 —— 拒絕輸出比值\n"
                    f"  before: {b_sp}\n  after:  {a_sp}"
                )
            pct = round((b_total - a_total) / b_total * 100, 2) if b_total else 0.0
            print(f"BEFORE bytes={b_total}  profile={args.before}")
            print(f"AFTER bytes={a_total}  profile={args.after}")
            print(f"REDUCTION pct={pct}")
            if b_sp is not None:
                print(f"SUPERPOWERS={b_sp}")
            return 0

        if not args.profile:
            raise ConfigError("要給 --profile,或 --before/--after,或 --verify-dispositions")

        total, lines, sp_dir = sum_profile(
            claude_dir, manifest, args.profile, args.scope, args.worst
        )
        for line in lines:
            print(line)
        print(f"TOTAL bytes={total}  profile={args.profile}  scope={args.scope}  worst={args.worst}")
        if sp_dir is not None:
            print(f"SUPERPOWERS={sp_dir}")
        return 0

    except ConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
