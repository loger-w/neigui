"""Batch A4(E118-E129)— 配對複製,把「git 可見的變更會讓下一個 session 失效」釘死。

A3 出現一次對照失敗:E110「什麼都沒改」也寫了 14,293 tok。這代表 prefix 有一段會自己漂,
單次量測分不出「我造成的失效」與「它自己漂」。

配對設計:每一輪都是 [對照 → 施加變更 → 還原後對照],跑三輪。
判準:若「變更後 write>0」在三輪都成立、而「對照 write>0」只偶爾出現,因果才站得住。
"""

from __future__ import annotations

from r2 import REPO, measure, run, swapped

H25 = "H25 到底什麼會讓下一個 session 掉出 cache"
TRACKED = REPO / "backend" / "main.py"


def probe(exp: str, cond: str) -> dict:
    return measure(exp, H25, cond, n=1)


def main() -> None:
    print("== Batch A4:配對複製(對照 / 變更 交替三輪)==\n")
    orig = TRACKED.read_text(encoding="utf-8")
    run()
    n = 118
    ctrl_writes, treat_writes = [], []
    for rnd in range(1, 4):
        r = probe(f"E{n}", f"第{rnd}輪 對照:無變更")
        ctrl_writes.append(r.get("write_med", -1))
        n += 1
        with swapped({TRACKED: orig + f"\n# probe {rnd}\n"}):
            r = probe(f"E{n}", f"第{rnd}輪 處置:改 tracked 檔")
            treat_writes.append(r.get("write_med", -1))
            n += 1
        r = probe(f"E{n}", f"第{rnd}輪 還原後")
        n += 1

    print(f"\n對照 write:{ctrl_writes}")
    print(f"處置 write:{treat_writes}")
    hit = sum(1 for w in treat_writes if w > 0)
    miss = sum(1 for w in ctrl_writes if w > 0)
    print(f"→ 處置 3 輪中 {hit} 輪失效;對照 3 輪中 {miss} 輪失效")
    assert TRACKED.read_text(encoding="utf-8") == orig, "backend/main.py 未還原!"
    print("backend/main.py 已還原(逐位元組比對通過)")


if __name__ == "__main__":
    main()
