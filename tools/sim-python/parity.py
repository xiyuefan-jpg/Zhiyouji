"""
引擎对拍：用模拟器自己的方法算一批典型场景，写成 tools/parity/cases.json；
TypeScript 那边（tools/sim/test/parity.test.ts）用规则引擎算同样的场景，逐条比对。

运行：python3 parity.py   （改了模拟器或规则后重新生成，再跑 npm test）

每个场景都直接调用模拟器里的方法（attack_cost_full、price、income_all、resolve_contests、
war_points、try_use、grain_points ……），不另写一套公式，所以对的是模拟器真正在用的规则。
"""
import json
import os
import numpy as np
from sim import P
from items import make_cls

N = 8
OUT = os.path.join(os.path.dirname(__file__), "..", "parity", "cases.json")


def season(pts=None):
    """一个空的 8 组赛季：没有地、没有法宝、团队分可指定（决定排名）"""
    cls = make_cls()
    S = cls(P(), np.full(N, 0.6), np.zeros(N), np.random.default_rng(0))
    S.owner[:] = -1
    S.inv = [[] for _ in range(N)]
    S.grain[:] = 1000
    if pts is not None:
        S.pts[:] = pts
    return S


def ranked_pts():
    """组 0 第一 … 组 7 最后"""
    return np.array([100 - 10 * i for i in range(N)], float)


CENTER = list(range(4))      # 模拟器里 0–3 号是中心地
EDGE = list(range(4, 12))    # 4–11 号是边缘地

cases = []

# 1. 进攻费用（第 10.1 节）
for active in range(3):
    for held in range(4):
        for leader in (False, True):
            S = season()
            for r in EDGE[:held]:
                S.owner[r] = 0
            S.contests = [dict(region=99, start=1, attackers=[0], defend=False, owner=1, paid=[0]) for _ in range(active)]
            cases.append(dict(kind="attack_cost", input=dict(active=active, held=held, leader=leader),
                              expect=int(S.attack_cost_full(0, 5, leader))))

# 2. 中心地价格（第 9 节）
S = season()
for d in range(8, 34):
    cases.append(dict(kind="center_price", input=dict(day=d), expect=int(S.price(CENTER[0], d))))

# 3. 每日领地收益（第 6 节、点化之术、八卦炉、生死簿）
territory = [
    dict(center=0, edge=1),
    dict(center=1, edge=0),
    dict(center=1, edge=1),
    dict(center=1, edge=3),
    dict(center=2, edge=3),
    dict(center=0, edge=5),
    dict(center=1, edge=2, zero="center"),
    dict(center=1, edge=2, zero="edge"),
    dict(center=1, edge=2, dianhua=True),
    dict(center=1, edge=2, bagua="center"),
    dict(center=1, edge=2, bagua="edge", zero="edge"),
    dict(center=2, edge=2, dianhua=True, bagua="center", zero="center"),
]
for c in territory:
    S = season()
    lands = CENTER[: c["center"]] + EDGE[: c["edge"]]
    for r in lands:
        S.owner[r] = 0
    d = 10
    if c.get("zero"):
        S.zero_inc[CENTER[0] if c["zero"] == "center" else EDGE[0]] = d + 1
    if c.get("dianhua"):
        S.fx.append(dict(kind="dahua", team=0, until=d + 1))
    if c.get("bagua"):
        S.bagua[CENTER[0] if c["bagua"] == "center" else EDGE[0]] = 0
    cases.append(dict(kind="territory", input=c, expect=round(float(S.income_all(d)[0]), 6)))

# 4. 区域争夺结算（第 10.6 节、九转兵劫印、坚壁清野）
contests = [
    dict(attackers=[70], defender=60),
    dict(attackers=[70], defender=70),
    dict(attackers=[60, 75], defender=70),
    dict(attackers=[50], defender=None),
    dict(attackers=[49.9], defender=None),
    dict(attackers=[80], defender=60, jiuzhuan=True),
    dict(attackers=[60, 65], defender=70, jianbi=True),
    dict(attackers=[60], defender=70, jiuzhuan_defender=True),
]
for c in contests:
    S = season()
    S.owner[EDGE[0]] = 7
    atk = list(range(1, 1 + len(c["attackers"])))
    scores = {t: v for t, v in zip(atk, c["attackers"])}
    if c["defender"] is not None:
        scores[7] = c["defender"]
    S.q = lambda t, token=False, scores=scores: scores[t]
    S.contests = [dict(region=EDGE[0], start=1, attackers=atk, defend=c["defender"] is not None, owner=7, paid=[40] * len(atk))]
    if c.get("jiuzhuan"):
        S.fx.append(dict(kind="jiuzhuan", team=atk[0], until=10))
    if c.get("jiuzhuan_defender"):
        S.fx.append(dict(kind="jiuzhuan", team=7, until=10))
    if c.get("jianbi"):
        S.inv[7].append("坚壁清野")
    before = S.pts.copy()
    S.resolve_contests(4)
    owner = int(S.owner[EDGE[0]])
    cases.append(dict(kind="contest", input=c, expect=dict(
        owner="defender" if owner == 7 else f"attacker{atk.index(owner)}",
        points={("defender" if t == 7 else f"attacker{atk.index(t)}"): round(float(S.pts[t] - before[t]), 6) for t in atk + [7]},
    )))

# 5. 周战争计分（第 11 节、大闹天宫、玉净瓶）
for w_danao in (False, True):
    for l_danao in (False, True):
        for l_jing in (False, True):
            S = season()
            S.danao_armed[0] = w_danao
            S.danao_armed[1] = l_danao
            S.jing_armed = {1: True} if l_jing else {}
            pw, pl = S.war_points(0, 1, 8)
            cases.append(dict(kind="war", input=dict(winner_danao=w_danao, loser_danao=l_danao, loser_yujing=l_jing),
                              expect=dict(winner=float(pw), loser=float(pl))))

# 6. 紫金红葫芦、七宝紫金钵（打低倍率、辟火罩、照妖镜）
for user, target in ((3, 0), (3, 6)):
    for defense in ((), ("辟火罩",), ("玄天照妖镜",), ("辟火罩", "玄天照妖镜")):
        S = season(ranked_pts())
        S.inv[user].append("紫金红葫芦")
        for x in defense:
            S.inv[target].append(x)
        S.forced_targets = lambda S_, t, target=target: target
        before = S.pts.copy()
        assert S.try_use(user, "紫金红葫芦", 10, 2)
        delta = {int(t): round(float(S.pts[t] - before[t]), 6) for t in range(N) if abs(S.pts[t] - before[t]) > 1e-9}
        cases.append(dict(kind="zijin", input=dict(userRank=user + 1, targetRank=target + 1, defenses=list(defense)),
                          expect={str(t + 1): v for t, v in delta.items()}))
for user in (0, 3):
    S = season(ranked_pts())
    S.inv[user].append("七宝紫金钵")
    S.inv[1].append("辟火罩")
    S.inv[6].append("玄天照妖镜")
    before = S.pts.copy()
    assert S.try_use(user, "七宝紫金钵", 10, 2)
    delta = {int(t): round(float(S.pts[t] - before[t]), 6) for t in range(N) if abs(S.pts[t] - before[t]) > 1e-9}
    cases.append(dict(kind="qibao", input=dict(userRank=user + 1, bihuoRank=2, zhaoyaoRank=7),
                      expect={str(t + 1): v for t, v in delta.items()}))

# 7. 终局粮草折算（第 15 节）
for g in (0, 1, 29, 30, 31, 44, 45, 95, 299, 300, 1234):
    S = season()
    cases.append(dict(kind="grain_points", input=dict(grain=g), expect=round(float(S.grain_points(np.array([g], float))[0]), 6)))

# 8. 全员参与奖（第 7 节）：9 人里有几人做满 2 次
for k in (6, 7, 8, 9):
    S = season()
    S.week_tasks = np.zeros((N, 9))
    S.week_tasks[0, :k] = 2
    p = S.p
    ok = bool(((S.week_tasks >= p.part_thr).mean(1) >= p.part_ratio)[0])
    cases.append(dict(kind="participation", input=dict(members=9, doneTwice=k), expect=p.part_bonus if ok else 0))

# 9. 军需任务粮草档位（第 12 节）
for q in (0, 49.9, 50, 64.9, 65, 100):
    rw = P().qm_reward[0] if q < 50 else (P().qm_reward[1] if q < 65 else P().qm_reward[2])
    cases.append(dict(kind="supply", input=dict(score=q), expect=rw))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(dict(note="由 tools/sim-python/parity.py 生成，勿手改", cases=cases), f, ensure_ascii=False, indent=1)
print(f"{len(cases)} 个场景 → {os.path.normpath(OUT)}")
