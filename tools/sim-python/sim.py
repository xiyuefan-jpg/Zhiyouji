"""
智游记 S3 赛季数值模拟器（蒙特卡洛）
规则来源：claude/智游记_项目说明与决策日志.md（截至第五轮）
默认参数 = 数值设计 v0.4 推荐值（法宝系统见 items.py）。运行：python3 本文件 → 输出推荐方案的验证指标

时间轴（D1 = 周一）
  D1        开营：发放初始粮草；第1批8块边缘地"选地顺位"盲拍（每组1块，付自己的出价）
  D5-7 ...  每周五-周日 周战争；下周一结算（D8/15/22/29）
  D8        第2批4块中心地：按排名逆序、固定价75（之后随剩余天数降价）
  D1-25     区域争夺可发起（D25 为最后发起日）
  D29-33    大团战（布洛托战线 + 主战场 + 夺地）
"""
from dataclasses import dataclass, field, replace
import numpy as np


@dataclass
class P:
    n_teams: int = 8
    members: int = 9
    days: int = 33
    lock_day: int = 25
    # —— 粮草 ——
    start_grain: float = 60
    grain_per_task: float = 3
    task_cap_week: int = 4
    qm_per_week: int = 2                 # 军需任务次数上限/周
    qm_reward: tuple = (10, 20, 30)      # AI 评分档位：<50 / 50-65 / >=65
    war_loser_grain: float = 20          # 周战争败者补给（追赶机制，可选）
    # —— 进攻 ——
    A: float = 30                        # 第1场同时进攻的成本
    D: float = 15                        # 每多1场同时进攻，成本 +D
    join_window: int = 1                 # 首个进攻方发起后，多少天内可加入
    threshold: float = 50                # 守方不迎战时的质量线
    R: float = 10                        # 扩张附加费：进攻方每已有1块地，进攻成本 +R
    dr: float = 0.6                      # 边际递减：第3块及以后的地，每多1块收益 ×dr
    free_regions: int = 2                # 前几块地不递减
    bounty: float = 0.3                  # 讨伐令：进攻当前第一名时成本折扣比例
    last_land: str = "none"                     # none / protect（最后一块地不可被进攻）/ backwater（背水一战：进攻成本×2，守方+5质量）
    exile: float = 0.5                   # 流亡令：无地组进攻成本 ×exile
    atk_pts: float = 4                   # 战功：进攻夺地成功 +团队分
    def_pts: float = 3                   # 战功：迎战守住 +团队分
    part_bonus: float = 3                # 全员参与奖：本周 ≥part_ratio 成员完成 ≥part_thr 次每日任务
    part_thr: int = 2
    part_ratio: float = 0.75
    shop_day: int = 15                   # 中期法宝商店（粮草购买）
    shop_price: float = 40
    shop_max: int = 2
    shop_q: float = 4                    # 每件法宝：下一次作战胜率加成的粗略代理（真实法宝不改评分，见法宝设计）
    token_shop: bool = True              # v0.3 的商店代理；法宝系统开启时关闭
    gift_day: int = 0                    # 测试用：在第 gift_day 天给 0 号组额外粮草
    gift: float = 0
    grain_to_pts: float = 1/30              # 赛季末未用粮草折算团队分的比率（如 0.1 = 10粮→1分）
    # —— 区域 ——
    edge_v: float = 1
    center_v: float = 2
    batch1: tuple = (0, 8)               # (中心, 边缘)
    batch2: tuple = (4, 0)
    batch2_day: int = 8
    price_edge: float = 60
    price_center: float = 75
    # —— 周战争 ——
    war_win: float = 15
    war_lose: float = -5
    # —— 大团战 ——
    fronts: tuple = (10, 15, 20, 25)
    main_bonus: float = 12
    bb_days: int = 5
    no_region_comp: float = 0.8
    # —— 质量模型 ——
    q_base: float = 60
    q_skill: float = 6
    q_effort: float = 20
    q_noise: float = 10


SRC = ("territory", "contest", "war", "bigbattle", "participation", "grain", "items")
SRC_CN = dict(territory="领地", contest="战功", war="周战争", bigbattle="大团战", participation="参与奖", grain="粮草折算", items="法宝")


class Season:
    def __init__(self, p: P, effort, skill, rng):
        self.p, self.rng = p, rng
        n = p.n_teams
        self.e = np.array(effort, float)
        self.s = np.array(skill, float)
        self.mu = p.q_base + p.q_skill * self.s + p.q_effort * (self.e - 0.6)
        self.slots = (1 + np.floor(2.5 * self.e)).astype(int)
        self.grain = np.full(n, p.start_grain, float)
        self.pts = np.zeros(n)
        self.pts_src = {k: np.zeros(n) for k in ("territory", "war", "bigbattle")}
        # 区域
        nc = p.batch1[0] + p.batch2[0]
        ne = p.batch1[1] + p.batch2[1]
        self.rv = np.array([p.center_v] * nc + [p.edge_v] * ne, float)
        self.is_center = np.array([True] * nc + [False] * ne)
        b1 = list(range(p.batch1[0])) + list(range(nc, nc + p.batch1[1]))
        self.batch1_ids = b1
        self.batch2_ids = [i for i in range(len(self.rv)) if i not in b1]
        self.owner = np.full(len(self.rv), -1)
        self.open = np.zeros(len(self.rv), bool)
        # 争夺：dict(region, start, attackers:list, defend:bool)
        self.contests = []
        self.busy = []                    # (team, end_day_exclusive) 占用的作战槽
        self.week_tasks = np.zeros((n, p.members))
        self.tokens = np.zeros(n, int)
        # 统计
        self.stat = dict(attacks=np.zeros(n), joins=0, contests=0, multi=0,
                         defenses=np.zeros(n), works_human=0, works_ai=0,
                         grain_earned=np.zeros(n), grain_spent_attack=np.zeros(n),
                         grain_spent_land=np.zeros(n), land_bought=np.zeros(n),
                         captures=np.zeros(n), conc=[], rank_d14=None,
                         grain_left_lock=None)

    # ---------- 工具 ----------
    def q(self, t, token=False):
        bonus = 0
        if token and self.tokens[t] > 0:
            self.tokens[t] -= 1
            bonus = self.p.shop_q
        return self.mu[t] + bonus + self.rng.normal(0, self.p.q_noise)

    def add(self, t, v, src):
        self.pts[t] += v
        self.pts_src.setdefault(src, np.zeros(self.p.n_teams))
        self.pts_src[src][t] += v

    def busy_count(self, t, d):
        return sum(1 for (tt, end) in self.busy if tt == t and end > d)

    def active_attacks(self, t, d):
        return sum(1 for c in self.contests if t in c["attackers"])

    def attack_cost(self, t, d):
        n = self.active_attacks(t, d) + 1
        held = (self.owner == t).sum()
        c = self.p.A + self.p.D * (n - 1) + self.p.R * held
        return c * (self.p.exile if held == 0 else 1.0)

    def ranking(self):
        return np.argsort(-self.pts)  # 第一名在前

    # ---------- 开营与选地 ----------
    def batch1(self):
        p, rng = self.p, self.rng
        bids = self.grain * rng.uniform(0.0, 0.35, p.n_teams)
        bids = np.minimum(bids, self.grain)
        order = np.argsort(-bids)
        avail = sorted(self.batch1_ids, key=lambda r: -self.rv[r])
        for t in order:
            r = avail.pop(0)
            self.owner[r] = t
            self.open[r] = True
            self.grain[t] -= bids[t]
            self.stat["grain_spent_land"][t] += bids[t]

    def price(self, r, d):
        base = self.p.price_center if self.is_center[r] else self.p.price_edge
        # 地价随剩余天数线性下降（以第2批开放日为满价）
        frac = (self.p.days - d) / (self.p.days - self.p.batch2_day)
        return base * min(1.0, max(0.2, frac))

    def batch2(self, d):
        rng = self.rng
        for r in self.batch2_ids:
            self.open[r] = True
        order = self.ranking()[::-1]  # 逆序：最后一名先选
        rk = np.argsort(np.argsort(-self.pts))
        self.stat["b2_buyer_rank"] = []
        for t in order:
            free = [r for r in self.batch2_ids if self.owner[r] == -1]
            if not free:
                break
            free.sort(key=lambda r: -self.rv[r])
            owns = (self.owner == t).sum()
            for r in free:
                pr = self.price(r, d)
                if self.grain[t] >= pr and (owns == 0 or rng.random() < 0.75):
                    self.buy(t, r, pr)
                    self.stat["b2_buyer_rank"].append(rk[t])
                    break

    def buy(self, t, r, pr):
        self.owner[r] = t
        self.grain[t] -= pr
        self.stat["grain_spent_land"][t] += pr
        self.stat["land_bought"][t] += 1

    # ---------- 粮草 ----------
    def daily_grain(self, d):
        p, rng = self.p, self.rng
        if (d - 1) % 7 == 0:
            self.week_tasks[:] = 0
        prob = np.clip(self.e * p.task_cap_week / 7 * 1.15, 0, 1)
        do = rng.random(self.week_tasks.shape) < prob[:, None]
        do &= self.week_tasks < p.task_cap_week
        self.week_tasks += do
        g = do.sum(1) * p.grain_per_task
        self.grain += g
        self.stat["grain_earned"] += g
        # 军需任务：周三、周日各一次机会
        if (d - 1) % 7 in (2, 6):
            for t in range(p.n_teams):
                if rng.random() < self.e[t]:
                    qq = self.q(t)
                    rw = p.qm_reward[0] if qq < 50 else (p.qm_reward[1] if qq < 65 else p.qm_reward[2])
                    rw *= self.qm_mult(t, d)
                    self.grain[t] += rw
                    self.stat["grain_earned"][t] += rw
                    self.stat["works_ai"] += 1

    # ---------- 区域争夺 ----------
    def maybe_attack(self, d):
        p, rng = self.p, self.rng
        leader = self.ranking()[0]
        for t in rng.permutation(p.n_teams):
            if not self.can_attack(t, d):
                continue
            for _ in range(3):
                if self.busy_count(t, d) >= self.slots[t]:
                    break
                if rng.random() > 0.55 * self.e[t] + 0.1:
                    break
                cost = self.attack_cost(t, d)
                # 先看能不能买无主地（第2批之后剩下的）
                free = [r for r in range(len(self.rv)) if self.open[r] and self.owner[r] == -1]
                if free:
                    r = max(free, key=lambda r: self.rv[r])
                    pr = self.price(r, d)
                    if self.grain[t] >= pr and rng.random() < 0.6:
                        self.buy(t, r, pr)
                        continue
                if self.grain[t] < cost:
                    break
                best, bs = None, -1
                for r in range(len(self.rv)):
                    o = self.owner[r]
                    if o == -1 or o == t:
                        continue
                    if not self.can_target(t, r, d):
                        continue
                    if p.last_land in ("protect", "protect_edge"):
                        contested = {cc["region"] for cc in self.contests}
                        others = [rr for rr in range(len(self.rv))
                                  if self.owner[rr] == o and rr != r and rr not in contested]
                        if not others and (p.last_land == "protect" or not self.is_center[r]):
                            continue
                    c = next((c for c in self.contests if c["region"] == r), None)
                    if c is not None:
                        if t in c["attackers"] or d - c["start"] > p.join_window:
                            continue
                    pdef = 0.9 if self.rv[r] >= 2 else 0.5 * self.e[o] + 0.2
                    pw_def = 1 / (1 + np.exp(-(self.mu[t] - self.mu[o]) / 8))
                    pw_nodef = 1 / (1 + np.exp(-(self.mu[t] - p.threshold) / 6))
                    pw = pdef * pw_def + (1 - pdef) * pw_nodef
                    if c is not None:
                        pw *= 0.6
                    remain = max(0, p.days - p.bb_days - (d + 3)) + 1
                    sc = pw * self.rv[r] * remain * (1.3 + 2*p.bounty if o == leader else 1.0)
                    sc *= rng.uniform(0.7, 1.3) * self.target_weight(t, o, r, d)
                    if sc > bs:
                        best, bs = r, sc
                if best is None:
                    break
                if self.owner[best] == leader and p.bounty > 0:
                    cost = cost * (1 - p.bounty)
                if p.last_land == "backwater" and (self.owner == self.owner[best]).sum() <= 1:
                    cost = cost * 2
                if self.grain[t] < cost:
                    break
                self.grain[t] -= cost
                self.stat["grain_spent_attack"][t] += cost
                self.stat["attacks"][t] += 1
                self.busy.append((t, d + 3))
                c = next((c for c in self.contests if c["region"] == best), None)
                if c is None:
                    o = self.owner[best]
                    defend = (self.busy_count(o, d) < self.slots[o]) and (
                        self.rv[best] >= 2 or rng.random() < self.e[o])
                    if defend:
                        self.busy.append((o, d + 3))
                        self.stat["defenses"][o] += 1
                    self.contests.append(dict(region=best, start=d, attackers=[t],
                                              defend=defend, owner=o, paid=[cost]))
                    self.stat["contests"] += 1
                else:
                    c["attackers"].append(t)
                    c.setdefault("paid", []).append(cost)
                    self.stat["joins"] += 1

    def resolve_contests(self, d):
        p = self.p
        keep = []
        for c in self.contests:
            if c["start"] + 3 != d:
                keep.append(c)
                continue
            if len(c["attackers"]) > 1:
                self.stat["multi"] += 1
            self.stat["works_human"] += len(c["attackers"]) + (1 if c["defend"] else 0)
            qa = {t: self.q(t, True) for t in c["attackers"]}
            ta = max(qa, key=qa.get)
            o = c["owner"]
            if c["defend"]:
                qd = self.q(o, True) + (5 if (p.last_land == "backwater" and (self.owner == o).sum() <= 1) else 0)
                win = qa[ta] > qd
            else:
                win = qa[ta] >= p.threshold
            if win and self.owner[c["region"]] == o:
                self.owner[c["region"]] = ta
                self.stat["captures"][ta] += 1
                if p.atk_pts: self.add(ta, self.contest_pts(ta, "atk", d), "contest")
                self.on_capture(ta, o, c["region"], c, d)
            elif c["defend"] and not win:
                if p.def_pts: self.add(o, self.contest_pts(o, "def", d), "contest")
                self.on_defend_win(o, c, d)
        self.contests = keep

    # ---------- 周战争 ----------
    def war(self, d):
        p = self.p
        order = self.ranking()
        for i in range(0, p.n_teams, 2):
            a, b = order[i], order[i + 1]
            self.stat["works_human"] += 2
            if self.q(a, True) > self.q(b, True):
                w, l = a, b
            else:
                w, l = b, a
            pw, pl = self.war_points(w, l, d)
            self.pts[w] += pw
            self.pts[l] += pl
            self.pts_src["war"][w] += pw
            self.pts_src["war"][l] += pl
            self.grain[l] += p.war_loser_grain
            self.on_war(w, l, d)

    # ---------- 大团战 ----------
    def big_battle(self):
        p, rng = self.p, self.rng
        order = list(self.ranking())
        n = p.n_teams
        campA, campB = [], []
        for i, t in enumerate(order):          # 蛇形分阵营：1 | 2 3 | 4 5 | 6 7 | 8
            (campA if (i % 4) in (0, 3) else campB).append(t)
        k = n // 2
        fronts = p.fronts if len(p.fronts) == k else tuple(np.linspace(10, 25, k).round())

        def assign(camp):
            strat = rng.random()
            camp = list(camp)
            if strat < 0.5:
                camp.sort(key=lambda t: self.mu[t])
            elif strat < 0.8:
                rng.shuffle(camp)
            else:
                camp.sort(key=lambda t: -self.mu[t])
            return camp

        fa, fb = assign(campA), assign(campB)
        for i, v in enumerate(fronts):
            a, b = fa[i], fb[i]
            self.stat["works_human"] += 2
            w, l = (a, b) if self.q(a) > self.q(b) else (b, a)
            gain = v
            regs = [r for r in range(len(self.rv)) if self.owner[r] == l]
            if regs:
                r = max(regs, key=lambda r: self.rv[r])
                swing = self.rv[r] * p.bb_days
                self.pts[l] -= swing
                self.pts_src["bigbattle"][l] -= swing
                gain += swing
            else:
                gain += p.no_region_comp * p.edge_v * p.bb_days
            self.pts[w] += gain
            self.pts_src["bigbattle"][w] += gain
        self.stat["works_human"] += 2
        qa = np.mean([self.mu[t] for t in campA]) + rng.normal(0, 6)
        qb = np.mean([self.mu[t] for t in campB]) + rng.normal(0, 6)
        for t in (campA if qa > qb else campB):
            self.pts[t] += p.main_bonus
            self.pts_src["bigbattle"][t] += p.main_bonus

    # ---------- 钩子（法宝系统覆盖） ----------
    def on_start(self): pass
    def qm_mult(self, t, d): return 1.0
    def on_day(self, d): pass
    def can_attack(self, t, d): return True
    def can_target(self, t, r, d): return True
    def target_weight(self, t, o, r, d): return 1.0
    def contest_pts(self, t, kind, d): return self.p.atk_pts if kind == "atk" else self.p.def_pts
    def on_capture(self, winner, loser, r, c, d): pass
    def on_defend_win(self, o, c, d): pass
    def war_points(self, w, l, d): return self.p.war_win, self.p.war_lose
    def on_war(self, w, l, d): pass

    def region_income(self, t, d):
        """返回 [(region, 实际产出)]，按价值从高到低递减"""
        p = self.p
        regs = sorted([r for r in range(len(self.rv)) if self.owner[r] == t], key=lambda r: -self.rv[r])
        return [(r, self.rv[r] * (p.dr ** max(0, k + 1 - p.free_regions))) for k, r in enumerate(regs)]

    def income_all(self, d):
        return [sum(v for _, v in self.region_income(t, d)) for t in range(self.p.n_teams)]

    # ---------- 主循环 ----------
    def run(self):
        p = self.p
        self.batch1()
        self.on_start()
        for d in range(1, p.days + 1):
            if getattr(self, "crn_seed", None) is not None:      # 共同随机数：每天的随机流按日期固定
                self.rng = np.random.default_rng([self.crn_seed, d])
            dow = (d - 1) % 7  # 0=周一
            self.resolve_contests(d)
            if d == p.batch2_day:
                self.batch2(d)
            self.daily_grain(d)
            if dow == 4 and d <= p.days - p.bb_days:   # 周五开战，占用一个槽三天
                for t in range(p.n_teams):
                    self.busy.append((t, d + 3))
                self._war_day = d
            if dow == 0 and d > 1 and d <= p.days - p.bb_days + 1:
                self.war(d)
            if dow == 6 and p.part_bonus:
                ok = (self.week_tasks >= p.part_thr).mean(1) >= p.part_ratio
                for t in np.where(ok)[0]:
                    self.add(t, p.part_bonus, "participation")
            if p.gift and d == p.gift_day:
                self.grain[0] += p.gift
            if d == p.shop_day and p.token_shop:
                for t in range(p.n_teams):
                    reserve = p.A + 20
                    k = int(min(p.shop_max, max(0, (self.grain[t] - reserve)) // p.shop_price))
                    if k and self.rng.random() < 0.85:
                        self.grain[t] -= k * p.shop_price
                        self.tokens[t] += k
                        self.stat.setdefault("shop", np.zeros(p.n_teams))
                        self.stat["shop"][t] += k
            self.on_day(d)
            if d <= p.lock_day:
                self.maybe_attack(d)
            if d == p.lock_day:
                self.stat["grain_left_lock"] = self.grain.copy()
            # 区域产出
            incs = self.income_all(d)
            for t in range(p.n_teams):
                self.pts[t] += incs[t]
                self.pts_src["territory"][t] += incs[t]
            self.stat["conc"].append([self.busy_count(t, d) for t in range(p.n_teams)])
            if d == 14:
                self.stat["rank_d14"] = np.argsort(np.argsort(-self.pts))
            if d == 20:
                held = np.array([(self.owner == t).sum() for t in range(p.n_teams)])
                self.stat["zero_land_d20"] = (held == 0).mean()
                self.stat["max_land_d20"] = held.max()
        if getattr(self, "crn_seed", None) is not None:
            self.rng = np.random.default_rng([self.crn_seed, 999])
        self.big_battle()
        if p.grain_to_pts > 0:
            conv = self.grain * p.grain_to_pts
            self.pts += conv
            self.pts_src.setdefault("grain", np.zeros(p.n_teams))
            self.pts_src["grain"] += conv
        return self


def run_many(p: P, n=1500, effort_mode="mixed", seed=0, cls=None, setup=None):
    cls = cls or Season
    rng = np.random.default_rng(seed)
    out = dict(att_week=[], att_week_by=[], conc_mean=[], conc_max=[], rho=[],
               comeback=[], share=[], grain_left=[], works=[], works_ai=[],
               multi=[], land=[], spread=[], gap_ae=[], final=[], effort=[],
               zero_land_d=[])
    for _ in range(n):
        if effort_mode == "mixed":
            effort = rng.uniform(0.3, 0.95, p.n_teams)
        elif effort_mode == "balanced":
            effort = rng.uniform(0.55, 0.85, p.n_teams)
        else:
            effort = np.array(effort_mode, float)
        skill = rng.normal(0, 0.7, p.n_teams)
        S = cls(p, effort, skill, rng)
        if setup: setup(S)
        S.run()
        st = S.stat
        weeks = p.lock_day / 7
        out["att_week"].append(st["attacks"] / weeks)
        out["effort"].append(effort)
        conc = np.array(st["conc"])
        out["conc_mean"].append(conc[: p.lock_day].mean(0))
        out["conc_max"].append(conc.max(0))
        final_rank = np.argsort(np.argsort(-S.pts))
        out["final"].append(S.pts.copy())
        # 努力-排名的 Spearman
        er = np.argsort(np.argsort(-effort))
        out["rho"].append(np.corrcoef(er, final_rank)[0, 1])
        # 第14天后两名 → 最终前三
        r14 = st["rank_d14"]
        bottom = np.where(r14 >= p.n_teams - 2)[0]
        out["comeback"].append(np.mean(final_rank[bottom] <= 2))
        hi = bottom[effort[bottom] >= 0.6]
        if len(hi): out.setdefault("comeback_hi", []).append(np.mean(final_rank[hi] <= 2))
        lower_half = np.where(r14 >= p.n_teams // 2)[0]
        out.setdefault("lh_to_top3", []).append(np.mean(final_rank[lower_half] <= 2))
        tot = sum(np.abs(v).sum() for v in S.pts_src.values())
        out["share"].append([np.abs(S.pts_src.get(k, np.zeros(1))).sum() / tot for k in SRC])
        out.setdefault("shop", []).append(S.stat.get("shop", np.zeros(p.n_teams)).sum())
        out.setdefault("b2", []).extend(S.stat.get("b2_buyer_rank", []))
        out.setdefault("b2n", []).append(len(S.stat.get("b2_buyer_rank", [])))
        earned = st["grain_earned"].sum() + p.start_grain * p.n_teams
        out["grain_left"].append(st["grain_left_lock"].sum() / earned)
        out["works"].append(st["works_human"])
        out["works_ai"].append(st["works_ai"])
        out["multi"].append(st["multi"] / max(1, st["contests"]))
        out["land"].append(st["land_bought"].sum())
        out["spread"].append(S.pts.max() - S.pts.min())
        out["zero_land_d"].append(st["zero_land_d20"])
        out.setdefault("max_land", []).append(st["max_land_d20"])
        out.setdefault("top3_share", []).append(np.sort(S.pts)[-3:].sum() / max(1, S.pts.clip(0).sum()))
    return {k: (np.array(v) if k not in ('comeback_hi',) else v) for k, v in out.items()}


def report(res, label=""):
    eff = res["effort"].ravel()
    aw = res["att_week"].ravel()
    fin = res["final"]
    def band(lo, hi):
        m = (eff >= lo) & (eff < hi)
        return aw[m].mean()
    cm = res["conc_mean"].ravel()
    print(f"==== {label}")
    print(f"每周进攻次数  积极(≥.8) {band(.8,1.01):.2f} | 中等(.55-.8) {band(.55,.8):.2f} | 懒散(<.45) {band(0,.45):.2f}")
    print(f"同时作战(槽占用) 平均 {cm.mean():.2f} | 积极组 {cm[eff>=.8].mean():.2f} | 单组峰值P95 {np.percentile(res['conc_max'],95):.1f}")
    print(f"努力-排名相关 ρ {res['rho'].mean():.2f} | D14后两名→前三 {res['comeback'].mean()*100:.1f}% (其中努力≥.6的 {np.mean(res['comeback_hi'])*100:.1f}%) | D14下半区→前三 {res['lh_to_top3'].mean()*100:.1f}%")
    sh = res["share"].mean(0)
    print("分数构成 " + " ".join(f"{SRC_CN[k]} {sh[i]*100:.0f}%" for i, k in enumerate(SRC)) + f" | 中期商店法宝/季 {np.mean(res['shop']):.1f}")
    print(f"锁定日剩余粮草占比 {res['grain_left'].mean()*100:.0f}% | 多方进攻比例 {res['multi'].mean()*100:.0f}% | 买地数/季 {res['land'].mean():.1f}")
    print(f"人工评估作品/季 {res['works'].mean():.0f} | AI评估军需/季 {res['works_ai'].mean():.0f}")
    print(f"冠军-末名分差 {res['spread'].mean():.0f} | 平均总分 {fin.mean():.0f} | 冠军均分 {fin.max(1).mean():.0f} | 冠军/平均 {(fin.max(1)/fin.mean(1)).mean():.2f}")
    b2 = res['b2']; nt = res['final'].shape[1]
    print(f"D20 无地组占比 {res['zero_land_d'].mean()*100:.0f}% | D20 最大持地 {res['max_land'].mean():.1f} | D8中心地售出 {res['b2n'].mean():.1f}/{4 if nt==8 else '-'} 块，买家在下半区的比例 {np.mean(b2 >= nt//2)*100:.0f}%")


if __name__ == "__main__":
    report(run_many(P(), n=800), "v0.4 推荐方案（无法宝）")
