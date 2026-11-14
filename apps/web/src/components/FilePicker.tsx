/**
 * A file button in plain Chinese (the browser's own one says "Choose Files"),
 * with thumbnails of the chosen pictures so a child can see what they picked.
 */

import { useEffect, useMemo, useRef } from "react";

const KIND_TEXT: Record<string, string> = { image: "图片", video: "视频", audio: "音频", pdf: "PDF" };

export function fileKindText(type: string): string {
  if (type.startsWith("image/")) return KIND_TEXT.image!;
  if (type.startsWith("video/")) return KIND_TEXT.video!;
  if (type.startsWith("audio/")) return KIND_TEXT.audio!;
  if (type === "application/pdf") return KIND_TEXT.pdf!;
  return "文件";
}

export function FilePicker({
  label,
  accept,
  multiple = false,
  max = 9,
  files,
  onChange,
  disabled = false,
}: {
  label: string;
  accept: string;
  multiple?: boolean;
  max?: number;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => (f.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-label={label}
        style={{ display: "none" }}
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          onChange(multiple ? [...files, ...picked].slice(0, max) : picked.slice(0, 1));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || (multiple && files.length >= max)}
        onClick={() => input.current?.click()}
        style={{ border: "1px dashed var(--ochre)", background: "var(--paper-light)", color: "var(--ochre)", borderRadius: 12, padding: "10px 16px", fontSize: 16, cursor: "pointer" }}
      >
        ＋ {label}
      </button>
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} style={{ position: "relative" }}>
              {urls[i] ? (
                <img src={urls[i]!} alt={`已选的第 ${i + 1} 张`} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
              ) : (
                <div className="panel" style={{ width: 72, height: 72, padding: 6, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  {fileKindText(f.type)}
                </div>
              )}
              <button
                type="button"
                aria-label={`去掉第 ${i + 1} 个`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: "none", background: "var(--ink-2)", color: "#fff", fontSize: 12, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
