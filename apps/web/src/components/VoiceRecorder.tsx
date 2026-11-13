/**
 * 按住说话 (PRD part 5 §3.1 step 4, §5): hold to record, release to stop;
 * shows the time; play back; record again. Stops by itself at `maxSeconds`.
 * When the browser cannot record (some in-app browsers), says so and offers
 * writing instead.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "antd-mobile";
import { recorder as defaultRecorder, type Recorder, type Recording } from "../platform/recorder";

export function VoiceRecorder({
  maxSeconds = 90,
  onChange,
  onUseText,
  recorder = defaultRecorder,
}: {
  maxSeconds?: number;
  onChange: (r: Recording | null) => void;
  onUseText?: () => void;
  recorder?: Recorder;
}) {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (url) URL.revokeObjectURL?.(url);
    },
    [url],
  );

  if (!recorder.supported())
    return (
      <div className="panel">
        <div>这个浏览器不能录音。可以改成写字，或者用手机自带的浏览器打开。</div>
        {onUseText && (
          <Button size="small" style={{ marginTop: 8 }} onClick={onUseText}>
            改成写字
          </Button>
        )}
      </div>
    );

  const start = async () => {
    if (busy.current || state === "recording") return;
    busy.current = true;
    setError(null);
    try {
      await recorder.start();
      setState("recording");
      setSeconds(0);
      const t0 = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setSeconds(s);
        if (s >= maxSeconds) void stop();
      }, 250);
    } catch {
      setError("没有拿到麦克风。请在浏览器里允许使用麦克风，或者改成写字。");
    } finally {
      busy.current = false;
    }
  };

  const stop = async () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    try {
      const r = await recorder.stop();
      if (r.durationMs < 1000) {
        setState("idle");
        setError("太短了，按住多说一会儿");
        onChange(null);
        return;
      }
      setSeconds(Math.min(maxSeconds, Math.round(r.durationMs / 1000)));
      setUrl(typeof URL.createObjectURL === "function" ? URL.createObjectURL(r.blob) : null);
      setState("done");
      onChange(r);
    } catch {
      setState("idle");
    }
  };

  const again = () => {
    setState("idle");
    setSeconds(0);
    setUrl(null);
    onChange(null);
  };

  return (
    <div className="panel" style={{ textAlign: "center" }}>
      {state !== "done" ? (
        <button
          type="button"
          aria-label={state === "recording" ? "松开结束" : "按住说话"}
          onPointerDown={(e) => {
            e.preventDefault();
            void start();
          }}
          onPointerUp={() => state === "recording" && void stop()}
          onPointerLeave={() => state === "recording" && void stop()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            width: "100%",
            height: 64,
            borderRadius: 32,
            border: "none",
            background: state === "recording" ? "var(--vermilion)" : "var(--ochre)",
            color: "var(--paper-light)",
            fontSize: 18,
            userSelect: "none",
            touchAction: "none",
          }}
        >
          {state === "recording" ? `松开结束 · ${seconds} 秒` : "按住说话"}
        </button>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>录好了，{seconds} 秒</div>
          {url && <audio controls src={url} aria-label="回放录音" style={{ width: "100%" }} />}
          <Button size="small" style={{ marginTop: 8 }} onClick={again}>
            重录
          </Button>
        </>
      )}
      <div className="hint" style={{ marginTop: 6 }}>
        最长 {maxSeconds} 秒
      </div>
      {error && (
        <div role="alert" style={{ color: "var(--vermilion)", marginTop: 6 }}>
          {error}
        </div>
      )}
      {onUseText && state !== "recording" && (
        <button type="button" onClick={onUseText} style={{ border: "none", background: "none", color: "var(--ochre)", marginTop: 6 }}>
          改成写字
        </button>
      )}
    </div>
  );
}
