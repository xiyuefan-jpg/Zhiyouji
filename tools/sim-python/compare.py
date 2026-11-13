"""
对比：带法宝的赛季模拟，PRD 第 3 部分 v1.0.2 同步后的规则（默认） vs 同步前的旧规则。
运行：python3 compare.py [赛季数=800]
"""
import sys
from sim import P, replace, run_many, report
from items import make_cls

n = int(sys.argv[1]) if len(sys.argv) > 1 else 800
report(run_many(replace(P(), v102=False), n=n, cls=make_cls(), seed=int(sys.argv[2]) if len(sys.argv) > 2 else 1), "同步前（旧规则，带法宝）")
report(run_many(P(), n=n, cls=make_cls(), seed=int(sys.argv[2]) if len(sys.argv) > 2 else 1), "PRD 第 3 部分 v1.0.2（带法宝）")
