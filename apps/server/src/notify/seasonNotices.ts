/**
 * Engine notices → message center (+ SMS for the urgent kinds), PRD part 8
 * §1.2:
 * - attacked / an attack joined → every active member of the defending team (SMS);
 * - outbid on an epic item → leader and deputy of the outbid team (SMS);
 * - an item used on a team → that team;
 * - the system named a leader → that team;
 * - groups published (D0 evening) → every player of the server;
 * - the report (战报) three times a day → every player (see reports.ts).
 */

import { eq } from "drizzle-orm";
import { lands, type Db } from "@zhiyouji/db";
import { itemDef, type Notice, type SeasonState } from "@zhiyouji/engine";
import { formatBeijing } from "@zhiyouji/shared";
import type { Notifier } from "./notifier.js";

const s = (v: unknown) => (typeof v === "string" ? v : "");

export class SeasonNotices {
  constructor(
    private readonly db: Db,
    private readonly notifier: Notifier,
  ) {}

  private async landName(serverId: string, code: string): Promise<string> {
    const rows = await this.db.select().from(lands).where(eq(lands.serverId, serverId));
    return rows.find((r) => r.code === code)?.name ?? code;
  }

  private members(st: SeasonState, teamId: string): string[] {
    return st.teams[teamId]?.members.filter((m) => m.active).map((m) => m.childId) ?? [];
  }

  private leaders(st: SeasonState, teamId: string): string[] {
    const t = st.teams[teamId];
    if (!t) return [];
    const ids = [t.leader, t.deputy].filter((x): x is string => !!x);
    // No leader yet: everyone in the team should know.
    return ids.length ? ids : this.members(st, teamId);
  }

  private teamName(st: SeasonState, id: unknown): string {
    return st.teams[s(id)]?.name ?? "";
  }

  async dispatch(serverId: string, seq: number, notices: Notice[], st: SeasonState): Promise<void> {
    for (const [i, n] of notices.entries()) {
      const d = n.data;
      switch (n.kind) {
        case "contest_started": {
          const land = await this.landName(serverId, s(d.landId));
          await this.notifier.notify({
            kind: "attacked",
            childIds: this.members(st, s(d.defender)),
            serverId,
            title: "你们组的地被进攻了",
            body: `${this.teamName(st, d.attacker)}向你们的${land}发起了进攻，截止 ${formatBeijing(Number(d.deadline))}。交作品就是迎战，不花粮草。`,
            link: `/season/contests/${s(d.contestId)}`,
            dedupeKey: `attacked:${serverId}:${s(d.contestId)}`,
          });
          break;
        }
        case "contest_joined": {
          const land = await this.landName(serverId, s(d.landId));
          // one message per contest that says how many have joined so far (part 8 §1.3)
          const joiners = (st.contests[s(d.contestId)]?.attackers ?? []).slice(1).map((a) => this.teamName(st, a.teamId));
          await this.notifier.notify({
            kind: "joined_attack",
            childIds: this.members(st, s(d.defender)),
            serverId,
            title: "又有组加入了进攻",
            body: joiners.length > 1 ? `有 ${joiners.length} 个组加入了对你们${land}的进攻：${joiners.join("、")}。` : `${this.teamName(st, d.attacker)}加入了对你们${land}的进攻。`,
            link: `/season/contests/${s(d.contestId)}`,
            dedupeKey: `joined:${serverId}:${s(d.contestId)}:${s(d.attacker)}`,
            supersedeUnread: true,
          });
          break;
        }
        case "epic_bid": {
          if (!d.outbid) break;
          const name = itemDef(s(d.itemId)).name;
          await this.notifier.notify({
            kind: "outbid",
            childIds: this.leaders(st, s(d.outbid)),
            serverId,
            title: "仙品出价被超过了",
            body: `${this.teamName(st, d.teamId)}对${name}出价 ${d.amount} 粮草，超过了你们。你们冻结的粮草已经解冻。`,
            link: `/season/shop`,
            dedupeKey: `outbid:${serverId}:${s(d.itemId)}:${d.amount}`,
          });
          break;
        }
        case "item_used": {
          if (!n.broadcast || !d.targetTeamId) break;
          await this.notifier.notify({
            kind: "item_used",
            childIds: this.members(st, s(d.targetTeamId)),
            serverId,
            title: "有组对你们用了法宝",
            body: `${this.teamName(st, d.teamId)}对你们使用了${itemDef(s(d.itemId)).name}。`,
            link: `/season/team`,
            dedupeKey: `item:${serverId}:${seq}:${i}`,
          });
          break;
        }
        case "item_outcome": {
          // 七宝紫金钵 hits several teams at once.
          const hit = (d.results as { teamId: string }[] | undefined) ?? [];
          for (const r of hit)
            await this.notifier.notify({
              kind: "item_used",
              childIds: this.members(st, r.teamId),
              serverId,
              title: "有组对你们用了法宝",
              body: `有组使用了${itemDef(s(d.itemId)).name}，你们也在目标里。`,
              link: `/season/team`,
              dedupeKey: `item:${serverId}:${seq}:${i}:${r.teamId}`,
            });
          break;
        }
        case "leaders_assigned": {
          for (const a of (d.assigned as { teamId: string; leader: string }[]) ?? [])
            await this.notifier.notify({
              kind: "system",
              childIds: this.members(st, a.teamId),
              serverId,
              title: "系统指定了组长",
              body: "到时间还没有人认领组长，系统指定了本组年级最高的组员当组长。组长可以随时移交。",
              link: `/season/team`,
              dedupeKey: `leaders_assigned:${serverId}:${a.teamId}`,
            });
          break;
        }
        default:
          break;
      }
    }
  }

  /** D0 evening: the groups are published (part 3 §2). */
  async groupsPublished(serverId: string, st: SeasonState): Promise<void> {
    for (const id of st.teamOrder)
      await this.notifier.notify({
        kind: "grouped",
        childIds: this.members(st, id),
        serverId,
        title: "分组公布了",
        body: `你在「${st.teams[id]!.name}」组。现在可以认领组长和副组长，盲拍也开始了。`,
        link: `/season/team`,
        dedupeKey: `grouped:${serverId}`,
      });
  }
}
