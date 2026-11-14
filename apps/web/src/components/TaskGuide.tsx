/**
 * What the team has to make and how it is judged (content library §2–§3):
 * the land's subject and question type, the audience, the work's form and
 * limits, each scoring dimension with what it looks at, the 50 / 75 point
 * lines, and what little teammates can do (mixed-age teams).
 */

import type { RubricGuide, TaskInfo } from "../seasonApi";

export function TaskGuide({ task, rubric, requirements, compact = false }: { task?: TaskInfo; rubric?: RubricGuide; requirements?: string; compact?: boolean }) {
  if (!task && !rubric) return null;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      {task && (task.subject || task.questionType) && (
        <div style={{ marginBottom: 6 }}>
          <b>{[task.subject, task.questionType].filter(Boolean).join(" · ")}</b>
        </div>
      )}
      {task && <div>讲给：{task.audience}</div>}
      {requirements && <div className="hint" style={{ marginTop: 4 }}>{requirements}</div>}
      {rubric && (
        <details style={{ marginTop: 10 }} open={!compact}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>怎么评分（{rubric.name}，满分 100）</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: "1.2em" }}>
            {rubric.dims.map((d) => (
              <li key={d.key}>
                {d.name} {d.max} 分：<span className="hint">{d.hint}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "8px 0 0" }}>
            <b>50 分</b>：{rubric.at50}
          </p>
          <p style={{ margin: "4px 0 0" }}>
            <b>75 分</b>：{rubric.at75}
          </p>
        </details>
      )}
      {task?.juniorHint && (
        <p className="hint" style={{ margin: "10px 0 0" }}>
          小队友可以做什么：{task.juniorHint}
        </p>
      )}
    </div>
  );
}
