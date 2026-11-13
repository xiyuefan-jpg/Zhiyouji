"""
智游记 S3 法宝系统 v0.2（接入 sim.py 的 Season）
原则：法宝不改评分；负面法宝"恃强凌弱减半"；败者宝箱。默认参数 = 法宝设计 v0.3.1（20 件，已删紧箍咒）。
用法：from items import make_cls; run_many(replace(P(), atk_pts=4), cls=make_cls())
"""
import numpy as np
from sim import Season, P, replace, run_many, report

# 名称: (档位, 类别, 是否大团战专用)
CATALOG = {
    # 凡品
    "还魂金丹": ("凡", "经济", False), "玉净瓶": ("凡", "守御", False), "坚壁清野": ("凡", "守御", False),
    "辟火罩": ("凡", "反制", False),
    "侦察令": ("凡", "大团战", True),
    # 灵品
    "点化之术": ("灵", "经济", False), "生死簿": ("灵", "经济", False), "大闹天宫": ("灵", "攻伐", False),
    "法天象地": ("灵", "经济", False),
    "九转兵劫印": ("灵", "攻伐", False), "袖里乾坤": ("灵", "守御", False), "三昧真火": ("灵", "干扰", False),
    "紫金红葫芦": ("灵", "干扰", False), "太虚幻镜": ("凡", "反制", False),
    "背水阵": ("灵", "大团战", True), "乾坤圈": ("灵", "大团战", True), "坚城令": ("灵", "大团战", True),
    # 仙品
    "八卦炉": ("仙", "经济", False), "玄天照妖镜": ("灵", "反制", False), "七宝紫金钵": ("仙", "干扰", False),
    "调兵符": ("仙", "大团战", True),
}
NEGATIVE = {"三昧真火", "紧箍咒", "紫金红葫芦", "七宝紫金钵", "锁天禁兵符", "幌金绳"}
PASSIVE = {"坚壁清野", "辟火罩", "玄天照妖镜"}

DEFAULT_CFG = dict(
    kaiying_n=2,                 # 开营每组免费凡品数
    price={"凡": 50, "灵": 80, "仙": 150},
    ling_stock=2, shop_max=3, shop_day=15,
    # 数值
    huanhun_tasks=6, dahua=1, dahua_days=3, shengsi_pts=7, shengsi_days=4, fatian_pts=10,
    danao=(25, -10), jiuzhuan_days=5, xiuli_days=3, sanmei_days=3, jingu_days=3,
    zijin_steal=5, qibao_steal=3, suotian_days=3, suotian_n=3,
    bagua=1.5, jianbi_pts=3, xiuli_refund=0.5,
    beishui=(1.75, -10), qiankun=(12, -8), yuanjun_q=3,
    buy_ling=0.85, buy_fan=0.75, kaiying_bb=False,
    target_policy="free_mix",    # free_mix：35%第一名/35%上一名/15%下一名/15%最弱组；above；leader；weakest
    upward_only=False,           # 以下犯上（第十轮弃用，保留开关供对比）
    down_mult=0.5,               # 后台可调 0~1：对排名比自己低的组使用负面法宝的效果倍率。1=完全自由，0.5=恃强凌弱减半（默认），0≈以下犯上
    war_chest="loser_instead",   # None / "loser"（败者另得宝箱）/ "loser_instead"（败者宝箱替代+20粮草）/ "winner_choice"
    catalog=None,                # 限定可用法宝集合（None=全部）
)


class ItemSeason(Season):
    cfg = DEFAULT_CFG

    def __init__(self, p, effort, skill, rng, cfg=None):
        super().__init__(replace(p, token_shop=False), effort, skill, rng)
        self.cfg = dict(DEFAULT_CFG, **(cfg or {}))
        n = p.n_teams
        self.inv = [[] for _ in range(n)]
        self.used = []                       # (day, team, item, target)
        self.fx = []                         # 持续效果 dict(kind, team, target, region, until)
        self.no_attack_until = np.zeros(n)
        self.no_item_until = np.zeros(n)
        self.immune = {}                     # region -> until
        self.zero_inc = {}                   # region -> until
        self.bagua = {}                      # region -> team
        self.bounties = []                   # dict(issuer, target, grain, until)
        self.danao_armed = np.zeros(n, bool)
        self.qm_double_week = np.full(n, -1)
        self.istat = dict(bought={}, used={}, blocked=0, reflected=0, auction_price=[])
        self.forced_targets = None           # 极端测试：指定所有负面法宝的目标

    # ---------- 工具 ----------
    def avail(self, name):
        cat = self.cfg["catalog"]
        return cat is None or name in cat

    def give(self, t, name):
        self.inv[t].append(name)

    def rank(self):
        return np.argsort(np.argsort(-self.pts))

    def pick_target(self, t):
        if self.forced_targets is not None:
            ft = self.forced_targets(self, t)
            if ft is not None and ft != t:
                return ft
        rk = self.rank()
        pol = self.cfg["target_policy"]
        if pol == "free_mix":
            order = list(self.ranking()); i = order.index(t)
            x = self.rng.random()
            if x < 0.35 and order[0] != t: return int(order[0])
            if x < 0.70 and i > 0: return int(order[i - 1])
            if x < 0.85 and i < len(order) - 1: return int(order[i + 1])
            return int(order[-1]) if order[-1] != t else int(order[-2])
        others = [o for o in range(self.p.n_teams) if o != t]
        if pol == "leader":
            o = int(self.ranking()[0]); return o if o != t else int(self.ranking()[1])
        if pol == "weakest":
            o = int(self.ranking()[-1]); return o if o != t else int(self.ranking()[-2])
        above = [o for o in others if rk[o] < rk[t]]
        if not above:
            return int(self.ranking()[1])
        if self.rng.random() < 0.6:
            return int(self.ranking()[0]) if int(self.ranking()[0]) != t else above[-1]
        return int(min(above, key=lambda o: rk[t] - rk[o]))   # 紧挨着的上一名

    def log_use(self, t, name, d, target=None):
        self.used.append((d, t, name, target))
        self.istat["used"][name] = self.istat["used"].get(name, 0) + 1

    def take(self, t, name):
        self.inv[t].remove(name)

    def hit(self, src, tgt, name, fn, d):
        """负面法宝结算：辟火罩抵挡 → 照妖镜反弹 → 生效"""
        if "辟火罩" in self.inv[tgt]:
            self.take(tgt, "辟火罩"); self.istat["blocked"] += 1; self.log_use(tgt, "辟火罩", d, src); return
        if "玄天照妖镜" in self.inv[tgt]:
            self.take(tgt, "玄天照妖镜"); self.istat["reflected"] += 1; self.log_use(tgt, "玄天照妖镜", d, src)
            fn(src, tgt); fn(src, tgt); return          # 反弹且效果翻倍
        fn(tgt, src)

    def owned(self, t):
        return [r for r in range(len(self.rv)) if self.owner[r] == t]

    # ---------- 获取 ----------
    def on_start(self):
        fan = [k for k, v in CATALOG.items() if v[0] == "凡" and self.avail(k)
               and (self.cfg["kaiying_bb"] or not v[2])]
        order = list(self.rng.permutation(self.p.n_teams))
        for _ in range(self.cfg["kaiying_n"]):
            for t in order:
                w = np.array([1.5 if CATALOG[k][2] else 1.0 for k in fan])
                w = w * self.rng.uniform(0.5, 1.5, len(fan))
                self.give(t, fan[int(np.argmax(w))])

    def shop(self, d):
        cfg, rng, p = self.cfg, self.rng, self.p
        pr = cfg["price"]
        rk = self.rank()
        n = p.n_teams
        bought = np.zeros(n, int)
        reserve = p.A

        def want(t, name):
            tier, cat, bb = CATALOG[name]
            top = rk[t] < n // 2
            w = 1.0
            if cat == "干扰": w = 1.6 if not top else 0.6
            if cat in ("守御", "反制"): w = 1.5 if top else 0.8
            if cat == "经济": w = 1.3 if len(self.owned(t)) >= 2 else 0.6
            if cat == "大团战": w = 0.9
            if name == "大闹天宫": w = 1.2
            return w * rng.uniform(0.4, 1.6)

        # 仙品：竞价（盲拍，付自己的出价）
        xian = [k for k, v in CATALOG.items() if v[0] == "仙" and self.avail(k)]
        for name in rng.permutation(xian):
            bids = {}
            for t in range(n):
                if bought[t] >= 1 and any(CATALOG[x][0] == "仙" for x in self.inv[t]):
                    continue
                budget = self.grain[t] - reserve
                if budget < pr["仙"] or want(t, name) < 1.0:
                    continue
                bids[t] = min(budget, pr["仙"] * rng.uniform(1.0, 2.0))
            if bids:
                t = max(bids, key=bids.get)
                self.grain[t] -= bids[t]; bought[t] += 1; self.give(t, name)
                self.istat["auction_price"].append(bids[t])
                self.istat["bought"][name] = self.istat["bought"].get(name, 0) + 1
        # 灵品：逆序选，每种限量
        ling = [k for k, v in CATALOG.items() if v[0] == "灵" and self.avail(k)]
        stock = {k: cfg["ling_stock"] for k in ling}
        for _round in range(2):
            for t in self.ranking()[::-1]:
                if bought[t] >= cfg["shop_max"] or self.grain[t] - reserve < pr["灵"]:
                    continue
                opts = [k for k in ling if stock[k] > 0]
                if not opts or rng.random() > cfg["buy_ling"]:
                    continue
                name = max(opts, key=lambda k: want(t, k))
                if want(t, name) < 0.9:
                    continue
                stock[name] -= 1; self.grain[t] -= pr["灵"]; bought[t] += 1; self.give(t, name)
                self.istat["bought"][name] = self.istat["bought"].get(name, 0) + 1
        # 凡品：直购
        fan = [k for k, v in CATALOG.items() if v[0] == "凡" and self.avail(k)]
        for t in range(n):
            while bought[t] < cfg["shop_max"] and self.grain[t] - reserve >= pr["凡"] and rng.random() < cfg["buy_fan"]:
                opts = [k for k in fan if k not in self.inv[t]]
                if not opts:
                    break
                name = max(opts, key=lambda k: want(t, k))
                self.grain[t] -= pr["凡"]; bought[t] += 1; self.give(t, name)
                self.istat["bought"][name] = self.istat["bought"].get(name, 0) + 1

    # ---------- 每日：使用法宝 ----------
    def on_day(self, d):
        p, cfg, rng = self.p, self.cfg, self.rng
        dow = (d - 1) % 7
        if d == cfg["shop_day"]:
            self.shop(d)
        if d == cfg["shop_day"]:
            self.gift_team = int(self.ranking()[0]) if getattr(self, "gift_to", 0) == "leader" else 0
            if getattr(self, "gift_item", None):
                self.give(self.gift_team, self.gift_item)
        # 悬赏到期
        for b in list(self.bounties):
            if d > b["until"]:
                self.grain[b["issuer"]] += b["grain"] * 0.5
                self.bounties.remove(b)
        if d > p.lock_day + 3:     # 常规法宝只在常规赛使用
            return
        for t in rng.permutation(p.n_teams):
            if self.no_item_until[t] >= d:
                continue
            for name in list(self.inv[t]):
                if name in PASSIVE or CATALOG[name][2]:
                    continue
                if name in self.inv[t] and self.try_use(t, name, d, dow):
                    break   # 每组每天最多主动使用 1 件

    def try_use(self, t, name, d, dow):
        p, cfg, rng = self.p, self.cfg, self.rng
        if getattr(self, "hold_items", None) and self.hold_items(t, d):
            return False
        own = self.owned(t)
        late = d >= 22
        if name == "还魂金丹":
            if dow == 5:
                ok = (self.week_tasks[t] >= p.part_thr).mean() >= p.part_ratio
                if not ok or late:
                    k = cfg["huanhun_tasks"]
                    for _ in range(k):
                        m = int(np.argmin(self.week_tasks[t])); self.week_tasks[t, m] += 1
                    self.grain[t] += k * p.grain_per_task
                    self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name == "点化之术":
            if len(own) >= 2 or (late and own):
                self.fx.append(dict(kind="dahua", team=t, until=d + cfg["dahua_days"] - 1))
                self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name == "八卦炉":
            if own:
                r = max(own, key=lambda r: self.rv[r]); self.bagua[r] = t
                self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name == "法天象地":
            if len(own) >= 3:
                self.add(t, cfg["fatian_pts"], "items"); self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name == "生死簿":
            threatened = [c["region"] for c in self.contests if c["owner"] == t and not c["defend"]]
            if threatened or (late and own):
                r = threatened[0] if threatened else min(own, key=lambda r: self.rv[r])
                self.zero_inc[r] = d + cfg["shengsi_days"] - 1
                self.add(t, cfg["shengsi_pts"], "items")
                self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name in ("大闹天宫", "玉净瓶"):
            if dow == 4 and not self.danao_armed[t] and not getattr(self, "jing_armed", {}).get(t):
                order = list(self.ranking()); i = order.index(t); opp = order[i ^ 1]
                pwin = 1 / (1 + np.exp(-(self.mu[t] - self.mu[opp]) / 8))
                if name == "玉净瓶":
                    if pwin < 0.55 or late:
                        self.jing_armed = getattr(self, "jing_armed", {}); self.jing_armed[t] = True
                        self.take(t, name); self.log_use(t, name, d); return True
                    return False
                order = list(self.ranking()); i = order.index(t); opp = order[i ^ 1]
                if self.mu[t] > self.mu[opp] - 2 or late:
                    self.danao_armed[t] = True
                    self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name == "九转兵劫印":
            if any(t in c["attackers"] for c in self.contests) or late:
                self.fx.append(dict(kind="jiuzhuan", team=t, until=d + cfg["jiuzhuan_days"] - 1))
                self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name == "袖里乾坤":
            threat = [c for c in self.contests if c["owner"] == t]
            for c in threat:
                strong = max(self.mu[a] for a in c["attackers"]) > self.mu[t] - 3
                if (not c["defend"]) or strong:
                    self.contests.remove(c)
                    for a, paid in zip(c["attackers"], c.get("paid", [])):
                        self.grain[a] += paid * cfg["xiuli_refund"]
                    self.busy = [(tt, e) for (tt, e) in self.busy if not (tt in c["attackers"] + [t] and e == c["start"] + 3)]
                    self.take(t, name); self.log_use(t, name, d); return True
            return False
        if name == "太虚幻镜":
            cands = [u for u in self.used if CATALOG[u[2]][0] != "仙" and u[2] not in PASSIVE
                     and not CATALOG[u[2]][2] and u[2] != "太虚幻镜"]
            if cands:
                self.take(t, name); self.log_use(t, name, d)
                self.inv[t].append(cands[-1][2])
                return True
            return False
        # —— 负面 ——
        if name in NEGATIVE:
            tgt = self.pick_target(t)
            if getattr(self, "hold_items", None) and self.hold_items(t, d):
                return False
            if cfg["upward_only"] and name != "七宝紫金钵":
                rk_ = self.rank()
                if rk_[tgt] >= rk_[t]:
                    above = [o for o in range(p.n_teams) if rk_[o] < rk_[t]]
                    if not above: return False
                    tgt = int(min(above, key=lambda o: rk_[t] - rk_[o])) if self.rng.random() < 0.5 else int(self.ranking()[0])
            rk0 = self.rank()
            mult = cfg["down_mult"] if rk0[tgt] > rk0[t] else 1.0
            self.istat.setdefault("down_uses", 0); self.istat.setdefault("neg_uses", 0)
            self.istat["neg_uses"] += 1; self.istat["down_uses"] += rk0[tgt] > rk0[t]
            if name == "三昧真火":
                if not self.owned(tgt): return False
                def fn(victim, src, mult=mult):
                    regs = self.owned(victim)
                    if regs:
                        r = max(regs, key=lambda r: self.rv[r])
                        self.fx.append(dict(kind="sanmei", team=src, target=victim, region=r, frac=mult,
                                            until=d + cfg["sanmei_days"] - 1))
            elif name == "紧箍咒":
                inc = self.income_all(d)
                if inc[tgt] <= inc[t]: return False
                def fn(victim, src):
                    self.fx.append(dict(kind="jingu", team=src, target=victim, until=d + cfg["jingu_days"] - 1))
            elif name == "紫金红葫芦":
                def fn(victim, src, mult=mult):
                    v = cfg["zijin_steal"] * mult
                    self.add(victim, -v, "items"); self.add(src, v, "items")
            elif name == "锁天禁兵符":
                tg2 = [o for o in self.ranking() if o != t][:cfg["suotian_n"]]
                self.take(t, name); self.log_use(t, name, d, tg2)
                for o in tg2:
                    def fn(victim, src):
                        self.no_attack_until[victim] = max(self.no_attack_until[victim], d + cfg["suotian_days"] - 1)
                    self.hit(t, o, name, fn, d)
                return True
            elif name == "幌金绳":
                pool_ = [x for x in self.inv[tgt] if x not in ("玄天照妖镜", "辟火罩")]
                if not pool_: return False
                def fn(victim, src):
                    cand = [x for x in self.inv[victim]]
                    if cand:
                        x = cand[int(self.rng.integers(len(cand)))]
                        self.inv[victim].remove(x); self.inv[src].append(x)
            elif name == "七宝紫金钵":
                self.take(t, name); self.log_use(t, name, d, "all")
                rk_ = self.rank()
                for o in range(p.n_teams):
                    if o == t: continue
                    if cfg["upward_only"] and rk_[o] > rk_[t]: continue
                    m_ = cfg["down_mult"] if rk_[o] > rk_[t] else 1.0
                    def fn(victim, src, m_=m_):
                        v = cfg["qibao_steal"] * m_
                        self.add(victim, -v, "items"); self.add(src, v, "items")
                    self.hit(t, o, name, fn, d)
                return True
            else:
                return False
            self.take(t, name); self.log_use(t, name, d, tgt); self.hit(t, tgt, name, fn, d)
            return True
        return False

    # ---------- 钩子 ----------
    def qm_mult(self, t, d):
        return 2.0 if self.qm_double_week[t] == (d - 1) // 7 else 1.0

    def can_attack(self, t, d):
        return self.no_attack_until[t] < d

    def can_target(self, t, r, d):
        return self.immune.get(r, -1) < d

    def target_weight(self, t, o, r, d):
        w = 1.0
        for b in self.bounties:
            if b["target"] == o and b["issuer"] != t:
                w *= 1 + b["grain"] / 40
        return w

    def contest_pts(self, t, kind, d):
        base = super().contest_pts(t, kind, d)
        if any(f["kind"] == "jiuzhuan" and f["team"] == t and f["until"] >= d for f in self.fx):
            return base * 2
        return base

    def on_capture(self, winner, loser, r, c, d):
        for b in list(self.bounties):
            if b["target"] == loser and b["issuer"] != winner and d <= b["until"]:
                self.grain[winner] += b["grain"]; self.bounties.remove(b)
        if r in self.bagua:
            del self.bagua[r]

    def on_defend_win(self, o, c, d):
        if "坚壁清野" in self.inv[o]:
            self.take(o, "坚壁清野"); self.log_use(o, "坚壁清野", d)
            for a in c["attackers"]:
                self.add(a, -self.cfg["jianbi_pts"], "items"); self.add(o, self.cfg["jianbi_pts"], "items")

    def war_points(self, w, l, d):
        pw, pl = self.p.war_win, self.p.war_lose
        if self.danao_armed[w]:
            pw = self.cfg["danao"][0]; self.danao_armed[w] = False
        if self.danao_armed[l]:
            pl = self.cfg["danao"][1]; self.danao_armed[l] = False
        ja = getattr(self, "jing_armed", {})
        if ja.get(l) and pl < 0:
            pl = 0
        ja.pop(l, None); ja.pop(w, None)
        wc = self.cfg["war_chest"]
        if wc == "winner_choice" and self.rng.random() < 0.5:
            pw -= self.p.war_win; self.chest(w)
        return pw, pl

    def on_war(self, w, l, d):
        if self.cfg["war_chest"] in ("loser", "loser_instead"):
            self.chest(l)
            if self.cfg["war_chest"] == "loser_instead":
                self.grain[l] -= self.p.war_loser_grain

    def chest(self, t):
        fan = [k for k, v in CATALOG.items() if v[0] == "凡" and not v[2] and self.avail(k)]
        self.give(t, fan[self.rng.integers(len(fan))])

    def income_all(self, d):
        n = self.p.n_teams
        base = []
        for t in range(n):
            tot = 0
            for r, v in self.region_income(t, d):
                if self.zero_inc.get(r, -1) >= d:
                    continue
                tot += v + (self.cfg["bagua"] if self.bagua.get(r) == t and d <= self.p.days - self.p.bb_days else 0)
            if any(f["kind"] == "dahua" and f["team"] == t and f["until"] >= d for f in self.fx):
                tot += self.cfg["dahua"] * len(self.owned(t))
            base.append(tot)
        out = list(base)
        for f in self.fx:
            if f["kind"] == "sanmei" and f["until"] >= d and self.owner[f["region"]] == f["target"]:
                v = self.rv[f["region"]] * f.get("frac", 1.0)
                out[f["target"]] -= v; out[f["team"]] += v
        for f in self.fx:
            if f["kind"] == "jingu" and f["until"] >= d:
                a, b = f["team"], f["target"]
                m = (base[a] + base[b]) / 2
                out[a], out[b] = m, m
        return out

    # ---------- 大团战（含法宝） ----------
    def big_battle(self):
        p, rng, cfg = self.p, self.rng, self.cfg
        order = list(self.ranking())
        campA, campB = [], []
        for i, t in enumerate(order):
            (campA if (i % 4) in (0, 3) else campB).append(t)
        k = p.n_teams // 2
        fronts = p.fronts if len(p.fronts) == k else tuple(np.linspace(10, 25, k).round())
        mu = self.mu.copy()
        for t in range(p.n_teams):
            if "援军令" in self.inv[t]:
                mu[t] += cfg["yuanjun_q"]; self.take(t, "援军令"); self.log_use(t, "援军令", p.days)

        def pwin(a, b):
            return 1 / (1 + np.exp(-(mu[a] - mu[b]) / 8))

        def assign(camp):
            s = rng.random(); camp = list(camp)
            if s < 0.5: camp.sort(key=lambda t: mu[t])
            elif s < 0.8: rng.shuffle(camp)
            else: camp.sort(key=lambda t: -mu[t])
            return camp

        fa, fb = assign(campA), assign(campB)

        def ev(mine, theirs, known):
            tot = 0
            for i, v in enumerate(fronts):
                if i in known:
                    tot += v * pwin(mine[i], theirs[i])
                else:
                    tot += v * np.mean([pwin(mine[i], o) for o in theirs])
            return tot

        def personal_move(t, mine, theirs, see_all):
            i = mine.index(t)
            def my_ev(j):
                o = theirs[j]
                if "疑兵符" in self.inv[o] and not see_all:
                    o = theirs[int(rng.integers(k))]
                return fronts[j] * pwin(t, o)
            best = max(range(k), key=my_ev) if see_all else (i if pwin(t, theirs[i]) >= 0.45 else max(range(k), key=my_ev))
            if best != i:
                mine[i], mine[best] = mine[best], mine[i]

        for camp, mine, theirs in ((campA, fa, fb), (campB, fb, fa)):
            for t in camp:
                if "调兵符" in self.inv[t]:
                    self.take(t, "调兵符"); self.log_use(t, "调兵符", p.days); personal_move(t, mine, theirs, True)
                elif "侦察令" in self.inv[t]:
                    self.take(t, "侦察令"); self.log_use(t, "侦察令", p.days)
                    o = theirs[mine.index(t)]
                    if "疑兵符" in self.inv[o]:
                        self.take(o, "疑兵符"); self.log_use(o, "疑兵符", p.days)
                    personal_move(t, mine, theirs, False)
        for i, v in enumerate(fronts):
            a, b = fa[i], fb[i]
            self.stat["works_human"] += 2
            qa_ = mu[a] + rng.normal(0, p.q_noise); qb_ = mu[b] + rng.normal(0, p.q_noise)
            w, l = (a, b) if qa_ > qb_ else (b, a)
            gain = v
            if "背水阵" in self.inv[w] and pwin(w, l) >= 0.4:
                self.take(w, "背水阵"); self.log_use(w, "背水阵", p.days); gain *= cfg["beishui"][0]
            if "背水阵" in self.inv[l] and pwin(l, w) >= 0.4:
                self.take(l, "背水阵"); self.log_use(l, "背水阵", p.days); self.add(l, cfg["beishui"][1], "bigbattle")
            regs = self.owned(l)
            if regs and "坚城令" in self.inv[l]:
                self.take(l, "坚城令"); self.log_use(l, "坚城令", p.days); regs = []
                gain += 0
            elif regs:
                r = max(regs, key=lambda r: self.rv[r]); swing = self.rv[r] * p.bb_days
                self.add(l, -swing, "bigbattle"); gain += swing
            else:
                gain += p.no_region_comp * p.edge_v * p.bb_days
            self.add(w, gain, "bigbattle")
        self.stat["works_human"] += 2
        qa = np.mean([mu[t] for t in campA]) + rng.normal(0, 6)
        qb = np.mean([mu[t] for t in campB]) + rng.normal(0, 6)
        win_camp, lose_camp = (campA, campB) if qa > qb else (campB, campA)
        for t in win_camp:
            self.add(t, p.main_bonus, "bigbattle")
        for t in range(p.n_teams):
            if "乾坤圈" in self.inv[t]:
                self.take(t, "乾坤圈"); self.log_use(t, "乾坤圈", p.days)
                self.add(t, cfg["qiankun"][0] if t in win_camp else cfg["qiankun"][1], "bigbattle")


def make_cls(cfg=None, gift=None, forced=None, gift_to=0):
    class C(ItemSeason):
        def __init__(self, p, e, s, rng):
            super().__init__(p, e, s, rng, cfg)
            self.gift_item = gift
            self.gift_to = gift_to
            self.forced_targets = forced
    return C
