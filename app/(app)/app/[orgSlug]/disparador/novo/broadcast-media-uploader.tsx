"use client";

import { Loader2Icon, UploadIcon, XIcon } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadBroadcastMediaAction } from "@/lib/broadcasts/actions";

type MediaType = "image" | "video" | "audio" | "document";

const ACCEPT: Record<MediaType, string> = {
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  document: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv",
};

type Props = {
  orgSlug: string;
  mediaType: MediaType;
  filename: string | null;
  onUploaded: (data: { path: string; mime: string; filename: string }) => void;
  onClear: () => void;
};

export function BroadcastMediaUploader({
  orgSlug,
  mediaType,
  filename,
  onUploaded,
  onClear,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function handle(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 25MB).");
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1] ?? "";
      const mime = file.type || "application/octet-stream";
      const r = await uploadBroadcastMediaAction({
        orgSlug,
        fileBase64: base64,
        mimeType: mime,
        filename: file.name,
      });
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onUploaded({ path: r.data.path, mime, filename: file.name });
    };
    reader.onerror = () => {
      setUploading(false);
      toast.error("Não foi possível ler o arquivo.");
    };
    reader.readAsDataURL(file);
  }

  if (filename) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 text-sm">
        <span className="truncate">{filename}</span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Remover arquivo"
          className="text-muted-foreground transition-colors hover:text-destructive"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      disabled={uploading}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 border-dashed bg-card/40 px-3 py-4 text-muted-foreground text-sm transition-colors hover:text-foreground"
    >
      {uploading ? (
        <Loader2Icon className="h-4 w-4 animate-spin" />
      ) : (
        <UploadIcon className="h-4 w-4" />
      )}
      {uploading ? "Enviando..." : "Escolha um arquivo..."}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[mediaType]}
        className="hidden"
        onChange={handle}
      />
    </button>
  );
}
