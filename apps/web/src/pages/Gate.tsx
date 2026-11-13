/**
 * Before anything else: the privacy pop-up on first open (PRD part 5 A1,
 * part 8 §2.4) — nothing is collected and nothing is requested from anyone
 * until it is accepted. Also the splash and the document pages.
 */

import { LEGAL_TEXT, renderDoc } from "../legalDocs";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "antd-mobile";
import { Empty, PageHeader, Seal } from "../components/ui";

/** Version of the first-open notice; raise it when the notice changes. */
export const PRIVACY_NOTICE_VERSION = "2027-01";
const KEY = "zyj_privacy_notice";

export function privacyAccepted(): boolean {
  try {
    return localStorage.getItem(KEY) === PRIVACY_NOTICE_VERSION;
  } catch {
    return false;
  }
}

export function acceptPrivacy(): void {
  try {
    localStorage.setItem(KEY, PRIVACY_NOTICE_VERSION);
  } catch {
    /* storage blocked: the notice shows again next time */
  }
}

export const DOCS: { slug: string; title: string }[] = [
  { slug: "terms", title: "用户协议" },
  { slug: "privacy", title: "隐私政策" },
  { slug: "children", title: "儿童个人信息保护规则" },
];

export function DocLinks() {
  return (
    <div className="doc-links">
      {DOCS.map((d) => (
        <Link key={d.slug} to={`/docs/${d.slug}`}>
          《{d.title}》
        </Link>
      ))}
    </div>
  );
}

export function PrivacyGate({ onAccept }: { onAccept: () => void }) {
  const [declined, setDeclined] = useState(false);
  return (
    <div className="page">
      <div className="row" style={{ alignItems: "flex-start", gap: 16, marginTop: 24 }}>
        <div className="grow">
          <h1 className="title">欢迎来到智游记</h1>
          <p className="subtitle">开始之前，请家长和孩子一起读一下。</p>
        </div>
        <Seal size={64} />
      </div>
      {declined ? (
        <div className="panel">
          <p style={{ marginTop: 0 }}>不同意的话，就不能使用智游记。网站没有收集任何信息。</p>
          <p style={{ marginBottom: 0 }}>如果改变主意，可以重新阅读后点“同意并继续”。</p>
        </div>
      ) : (
        <div className="panel doc-text">
          <ul>
            <li>智游记用家长的手机号登录，会保存孩子的昵称、年级，以及孩子交的学习内容（照片、讲解录音、文字和作品）。</li>
            <li>这些信息只用来组织学习赛季、给作品打分、生成孩子的学习记录，存放在中国境内的服务器上。</li>
            <li>点“同意并继续”之前，网站不会收集任何信息。</li>
          </ul>
          <p style={{ marginBottom: 0 }}>详细内容见：</p>
          <DocLinks />
        </div>
      )}
      <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
        <Button className="big-button" color="primary" block onClick={onAccept}>
          同意并继续
        </Button>
        {declined ? (
          <Button className="big-button quiet-button" block onClick={() => setDeclined(false)}>
            重新阅读
          </Button>
        ) : (
          <Button className="big-button quiet-button" block onClick={() => setDeclined(true)}>
            不同意
          </Button>
        )}
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} aria-busy="true">
      <Seal size={88} />
    </div>
  );
}

/** The three documents (drafts go here; the lawyer-reviewed text replaces them before launch). */
export function DocPage() {
  const { slug } = useParams();
  const doc = DOCS.find((d) => d.slug === slug);
  return (
    <div className="page">
      <PageHeader title={doc ? doc.title : "找不到这份文件"} />
      {doc ? (
        <div className="panel doc-text">{LEGAL_TEXT[doc.slug] ? renderDoc(LEGAL_TEXT[doc.slug]!) : <p style={{ margin: 0 }}>《{doc.title}》正在定稿，正式上线前会放在这里。</p>}</div>
      ) : (
        <Empty title="找不到这份文件">
          <Link to="/">回到首页</Link>
        </Empty>
      )}
    </div>
  );
}
