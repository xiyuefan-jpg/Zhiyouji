/**
 * The three documents (PRD part 8 §2.1): drafts in docs/legal/*.md, bundled
 * as text so the page needs no request. The lawyer-reviewed text replaces the
 * files before launch. A tiny renderer: "#"/"##" headings, "- " lists,
 * "| … |" tables, "> " notes, paragraphs.
 */

import type { ReactNode } from "react";
import terms from "../../../docs/legal/terms.md?raw";
import privacy from "../../../docs/legal/privacy.md?raw";
import children from "../../../docs/legal/children.md?raw";

export const LEGAL_TEXT: Record<string, string> = { terms, privacy, children };

export function renderDoc(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("# ")) {
      i++; // the page header shows the title
    } else if (line.startsWith("## ")) {
      out.push(<h2 key={i} className="section-title">{line.slice(3)}</h2>);
      i++;
    } else if (line.startsWith("> ")) {
      out.push(<p key={i} className="hint">{line.slice(2)}</p>);
      i++;
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("- ")) items.push(lines[i++]!.slice(2));
      out.push(<ul key={i}>{items.map((t, k) => <li key={k}>{t}</li>)}</ul>);
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const cells = lines[i++]!.split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
      }
      out.push(
        <table key={i} style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            {rows.map((r, k) => (
              <tr key={k}>
                {r.map((c, j) => (k === 0 ? <th key={j} style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>{c}</th> : <td key={j} style={{ borderBottom: "1px solid var(--line)", padding: "4px 2px" }}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (line.trim()) {
      out.push(<p key={i}>{line}</p>);
      i++;
    } else i++;
  }
  return out;
}
