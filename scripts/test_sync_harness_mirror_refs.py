"""步驟 7:鏡像同步器涵蓋 harness/ 新落點,且 glob 目錄不再假綠。

現行 build_pairs / find_orphans 都把來源欄當**實體路徑**用 `is_dir()` 判斷,含 `*` 時
必為 False 而被靜默 `continue` —— 對映等於沒生效,`--check` 卻回 exit 0。兩處各有一個,
只修 build_pairs 只解決一半(orphan 側仍假綠)。
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "sync_harness_mirror_refs", Path(__file__).parent / "sync-harness-mirror.py"
)
assert _spec is not None and _spec.loader is not None
sync = importlib.util.module_from_spec(_spec)
sys.modules["sync_harness_mirror_refs"] = sync
_spec.loader.exec_module(sync)


def w(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def make_home(tmp_path: Path) -> Path:
    home = tmp_path / "claude-home"
    w(home / "commands" / "feat.md", "feat v1\n")
    w(home / "hooks" / "safety-hooks.py", "hook v1\n")
    w(home / "hooks" / "tests" / "test_safety_hooks.py", "test v1\n")
    w(home / "agents" / "design-reviewer.md", "agent v1\n")
    w(home / "skills" / "auto-verify" / "SKILL.md", "av v1\n")
    w(home / "skills" / "branch-lifecycle" / "SKILL.md", "bl v1\n")
    w(home / "CLAUDE.md", "rules v1\n")
    # 本輪新增的落點
    w(home / "harness" / "RATIONALE.md", "why v1\n")
    w(home / "harness" / "load-manifest.json", '{"profiles": {}}\n')
    w(home / "harness" / "dispositions.json", '{"rows": []}\n')
    w(home / "harness" / "refs" / "review-protocol.md", "protocol v1\n")
    w(home / "harness" / "refs" / "scope-tiers.md", "tiers v1\n")
    w(home / "skills" / "branch-lifecycle" / "references" / "exceptions.md", "exc v1\n")
    # 個人 skill:不得被掃進來(§10 已把個人 skill 劃出範圍)
    w(home / "skills" / "neoapi-python" / "SKILL.md", "personal\n")
    w(
        home / "skills" / "neoapi-python" / "references" / "exceptions.md",
        "personal ref\n",
    )
    return home


def run(mode: str, home: Path, mirror: Path) -> int:
    return sync.main([mode], claude_home=home, mirror=mirror)


# ---------------------------------------------------------------------------
# 新落點進鏡像
# ---------------------------------------------------------------------------


def test_harness_refs_md_mirrored(tmp_path):
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    assert (mirror / "harness" / "refs" / "review-protocol.md").is_file()
    assert (mirror / "harness" / "refs" / "scope-tiers.md").is_file()


def test_harness_json_mirrored(tmp_path):
    """pattern 須含 *.json,否則兩份 manifest 不進鏡像 = 無版控副本。"""
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    assert (mirror / "harness" / "load-manifest.json").is_file()
    assert (mirror / "harness" / "dispositions.json").is_file()


def test_harness_rationale_mirrored(tmp_path):
    """RATIONALE.md 必須進鏡像,否則被移出的敘事無回退路徑(§3 P3 前提)。"""
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    assert (mirror / "harness" / "RATIONALE.md").is_file()


def test_branch_lifecycle_references_mirrored(tmp_path):
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    hits = list(mirror.rglob("exceptions.md"))
    assert hits, "branch-lifecycle/references/exceptions.md 應進鏡像"


def test_personal_skill_references_not_swept(tmp_path):
    """來源要具名到兩支 harness skill,不可用 skills/*/references。"""
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    assert not any("neoapi" in str(p) for p in mirror.rglob("*")), (
        "個人 skill 不得進鏡像"
    )


# ---------------------------------------------------------------------------
# glob 目錄不再假綠(兩側都要修)
# ---------------------------------------------------------------------------


def test_build_pairs_expands_glob_source_dir(tmp_path, monkeypatch):
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    w(home / "skills" / "auto-verify" / "references" / "a.md", "a\n")
    monkeypatch.setattr(sync, "DIR_MAPS", [("skills/*/references", "*.md", "globbed")])
    monkeypatch.setattr(sync, "SINGLE_MAPS", [])
    pairs = sync.build_pairs(home, mirror)
    srcs = {p[0].name for p in pairs}
    assert "a.md" in srcs, "含 * 的來源目錄被靜默略過 = 對映假綠"


def test_find_orphans_expands_glob_scope(tmp_path, monkeypatch):
    """orphan 側有同一個 is_dir() 假綠 —— 只修 build_pairs 只解決一半。"""
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    w(mirror / "skills" / "auto-verify" / "references" / "ghost.md", "no source\n")
    monkeypatch.setattr(sync, "DIR_MAPS", [])
    monkeypatch.setattr(sync, "SINGLE_MAPS", [])
    monkeypatch.setattr(sync, "ORPHAN_SCOPES", [("skills/*/references", "*.md")])
    orphans = sync.find_orphans([], mirror)
    assert any(p.name == "ghost.md" for p in orphans)


def test_same_named_files_in_different_dirs_do_not_collide(tmp_path, monkeypatch):
    """dst 展開若扁平化成 mirror/dst_rel/f.name,不同 skill 的同名 references 會壓成一個。"""
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    w(home / "skills" / "auto-verify" / "references" / "exceptions.md", "av exc\n")
    monkeypatch.setattr(sync, "DIR_MAPS", [("skills/*/references", "*.md", "skills")])
    monkeypatch.setattr(sync, "SINGLE_MAPS", [])
    pairs = sync.build_pairs(home, mirror)
    dsts = [p[1] for p in pairs if p[1].name == "exceptions.md"]
    assert len(dsts) >= 2
    assert len({d.resolve() for d in dsts}) == len(dsts), f"落點撞名:{dsts}"


# ---------------------------------------------------------------------------
# SC-7 兩項反向驗證(必須分打兩側)
# ---------------------------------------------------------------------------


def test_sc7_a_drift_in_harness_refs_detected(tmp_path, capsys):
    """(a) 改壞來源 harness/refs/*.md → 走 build_pairs 的 DRIFT。"""
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    capsys.readouterr()
    w(home / "harness" / "refs" / "review-protocol.md", "protocol v2 CHANGED\n")
    assert run("--check", home, mirror) == 1
    assert "DRIFT" in capsys.readouterr().out


def test_sc7_b_orphan_on_mirror_side_detected(tmp_path, capsys):
    """(b) 在**鏡像側**放無來源的檔 → 走 find_orphans 的 ORPHAN。
    放在來源側只會報 MISSING,那還是 build_pairs 那條路,測不到 orphan 側。"""
    home, mirror = make_home(tmp_path), tmp_path / "mirror"
    assert run("--fix", home, mirror) == 0
    capsys.readouterr()
    w(mirror / "harness" / "refs" / "no-source.md", "orphan\n")
    assert run("--check", home, mirror) == 1
    assert "ORPHAN" in capsys.readouterr().out
