/**
 * 土地公问卷 (PRD part 5 A4; content library §10.2): one question per screen,
 * each can be read aloud. Nickname, avatar and grade are already in the child
 * profile; this is questions 3–7: 好奇心大冒险 (8 rounds of two, then the
 * final pick, then an optional own question), hobbies (up to 5), AI, play
 * style, and 讲一讲 + 30 秒挑战 (speak or write — that becomes the default way
 * of explaining daily tasks; skipping means voice).
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, Selector, TextArea } from "antd-mobile";
import { AI_USES, CURIOSITY_QUESTIONS, HOBBIES, PLAY_STYLES, type SurveySubmit } from "@zhiyouji/shared";
import { ApiError, request } from "../api";
import { PageHeader, ReadAloud, Seal } from "../components/ui";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { ticketUploader } from "../platform/upload";
import type { Recording } from "../platform/recorder";
import { useSession } from "../session";

const uploader = ticketUploader("/v1/daily", request);

type QId = (typeof CURIOSITY_QUESTIONS)[number]["id"];

/** 16 questions → 8 pairs in a shuffled order. */
export function pairQuestions(random: () => number = Math.random): [QId, QId][] {
  const ids = CURIOSITY_QUESTIONS.map((q) => q.id) as QId[];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return Array.from({ length: ids.length / 2 }, (_, i) => [ids[2 * i]!, ids[2 * i + 1]!]);
}

const STYLE_ICON: Record<string, string> = { fighter: "⚔️", strategist: "🗺️", healer: "💚", builder: "🏡" };
const qText = (id: string) => CURIOSITY_QUESTIONS.find((q) => q.id === id)?.text ?? "";

type Step = "intro" | "round" | "final" | "own" | "hobbies" | "ai" | "style" | "challenge" | "done";

/** One screen: 土地公 says something (with read-aloud), then the answers. Defined outside so inputs keep focus. */
function Screen({ say, children }: { say: string; children: React.ReactNode }) {
  return (
    <>
      <div className="row" style={{ alignItems: "flex-start", margin: "8px 0 16px" }}>
        <Seal text="土" size={44} tilt={-3} />
        <p className="grow" style={{ margin: 0, fontSize: 18 }}>
          {say}
        </p>
        <ReadAloud text={say} />
      </div>
      {children}
    </>
  );
}

export function SurveyPage({ random }: { random?: () => number }) {
  const nav = useNavigate();
  const { refresh } = useSession();
  const pairs = useMemo(() => pairQuestions(random), [random]);
  const [step, setStep] = useState<Step>("intro");
  const [round, setRound] = useState(0);
  const [picks, setPicks] = useState<QId[]>([]);
  const [final, setFinal] = useState<QId | null>(null);
  const [own, setOwn] = useState("");
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [experience, setExperience] = useState<"never" | "few" | "often" | null>(null);
  const [uses, setUses] = useState<string[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const [voice, setVoice] = useState<Recording | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (id: QId) => {
    const next = [...picks, id];
    setPicks(next);
    if (round + 1 < pairs.length) setRound(round + 1);
    else setStep("final");
  };

  const finish = async (skip: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let challenge: SurveySubmit["challenge"] = null;
      if (!skip && mode === "voice" && voice) challenge = { kind: "voice", fileId: (await uploader.upload(voice.blob, { purpose: "audio" })).fileId };
      if (!skip && mode === "text" && text.trim()) challenge = { kind: "text", text: text.trim() };
      const body: SurveySubmit = {
        curiosity: { rounds: pairs.map((p, i) => [p[0], p[1], picks[i]!]), final: final! },
        ...(own.trim() ? { ownQuestion: own.trim() } : {}),
        hobbies: hobbies as SurveySubmit["hobbies"],
        ai: { experience: experience ?? "never", uses: (experience === "never" ? [] : uses) as SurveySubmit["ai"]["uses"] },
        style: style as SurveySubmit["style"],
        challenge,
      };
      await request("POST", "/v1/survey", body);
      await refresh();
      setStep("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="土地公问卷" />
      {step === "intro" && (
        <Screen say="嘿！我是这里的土地公。出发取经之前，我想先认识认识你～">
          <Button color="primary" block className="big-button" onClick={() => setStep("round")}>
            好呀
          </Button>
          <Button block className="big-button quiet-button" style={{ marginTop: 10 }} onClick={() => nav("/", { replace: true })}>
            以后再说
          </Button>
        </Screen>
      )}

      {step === "round" && (
        <Screen say={round === 0 ? "我这里有好多问题，连我都不知道答案！每次给你两个，你选更想知道的那个。" : "这两个呢？"}>
          <div className="hint" style={{ marginBottom: 8 }}>
            第 {round + 1} / {pairs.length} 轮
          </div>
          {pairs[round]!.map((id) => (
            <button key={id} type="button" className="panel" onClick={() => pick(id)} style={{ width: "100%", textAlign: "left", font: "inherit", fontSize: 17, color: "inherit", padding: 16 }}>
              {qText(id)}
            </button>
          ))}
        </Screen>
      )}

      {step === "final" && (
        <Screen say="最后，你最最想知道哪一个？">
          {picks.map((id) => (
            <button key={id} type="button" className="panel" onClick={() => (setFinal(id), setStep("own"))} style={{ width: "100%", textAlign: "left", font: "inherit", color: "inherit" }}>
              {qText(id)}
            </button>
          ))}
        </Screen>
      )}

      {step === "own" && (
        <Screen say="你自己还有什么特别想知道的吗？说给我听！">
          <TextArea className="text-input" placeholder="写下来（可以跳过）" value={own} onChange={setOwn} rows={3} maxLength={200} />
          <Button color="primary" block className="big-button" style={{ marginTop: 12 }} onClick={() => setStep("hobbies")}>
            {own.trim() ? "下一个" : "跳过"}
          </Button>
        </Screen>
      )}

      {step === "hobbies" && (
        <Screen say="放学以后，你最常干的是什么？最多选 5 个。">
          <Selector columns={3} multiple options={HOBBIES.map((h) => ({ label: h, value: h }))} value={hobbies} onChange={(v) => setHobbies(v.slice(0, 5))} />
          <Button color="primary" block className="big-button" style={{ marginTop: 16 }} onClick={() => setStep("ai")}>
            下一个
          </Button>
        </Screen>
      )}

      {step === "ai" && (
        <Screen say="你跟 AI 聊过天吗？比如豆包、DeepSeek、Kimi？">
          <Selector
            columns={3}
            options={[
              { label: "没聊过", value: "never" },
              { label: "聊过几次", value: "few" },
              { label: "经常聊", value: "often" },
            ]}
            value={experience ? [experience] : []}
            onChange={(v) => setExperience((v[0] as typeof experience) ?? null)}
          />
          {experience && experience !== "never" && (
            <>
              <div className="field-label">你让 AI 帮你干过什么？</div>
              <Selector columns={3} multiple options={AI_USES.map((u) => ({ label: u, value: u }))} value={uses} onChange={setUses} />
            </>
          )}
          <Button color="primary" block className="big-button" style={{ marginTop: 16 }} disabled={!experience} onClick={() => setStep("style")}>
            下一个
          </Button>
        </Screen>
      )}

      {step === "style" && (
        <Screen say="和朋友一起玩的时候，你通常是哪一个？">
          {PLAY_STYLES.map((p) => (
            <button key={p.id} type="button" className="panel" onClick={() => (setStyle(p.id), setStep("challenge"))} style={{ width: "100%", textAlign: "left", font: "inherit", fontSize: 17, color: "inherit" }}>
              {STYLE_ICON[p.id]} {p.text}
            </button>
          ))}
        </Screen>
      )}

      {step === "challenge" && (
        <Screen say="最后一个！你最近学会了什么新东西？讲给我听听，什么都可以！">
          {!mode && (
            <div className="row">
              <Button color="primary" className="big-button grow" onClick={() => setMode("voice")}>
                🎤 说给你听
              </Button>
              <Button className="big-button grow" onClick={() => setMode("text")}>
                ✍️ 写给你看
              </Button>
            </div>
          )}
          {mode === "voice" && <VoiceRecorder maxSeconds={30} onChange={setVoice} onUseText={() => setMode("text")} />}
          {mode === "text" && <TextArea className="text-input" placeholder="写给土地公看" value={text} onChange={setText} rows={4} maxLength={500} />}
          {error && (
            <p role="alert" style={{ color: "var(--vermilion)" }}>
              {error}
            </p>
          )}
          {mode && (
            <Button color="primary" block className="big-button" style={{ marginTop: 16 }} loading={busy} disabled={(mode === "voice" && !voice) || (mode === "text" && !text.trim())} onClick={() => void finish(false)}>
              讲完了
            </Button>
          )}
          <Button block className="big-button quiet-button" style={{ marginTop: 10 }} disabled={busy} onClick={() => void finish(true)}>
            跳过
          </Button>
        </Screen>
      )}

      {step === "done" && (
        <Screen say="太好了！你的取经路开始啦。">
          <Button color="primary" block className="big-button" onClick={() => nav("/", { replace: true })}>
            出发
          </Button>
        </Screen>
      )}
    </div>
  );
}
