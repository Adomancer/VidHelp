"use client";

import { useState } from "react";
import { BookOpen, Download, FileImage, FileSpreadsheet, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { errorMessage, fieldErrors, hostApi, knowledgeApi, saveObjectUrl, showInTab, type KnowledgeFile } from "@/lib/api";
import { acceptOf, KNOWLEDGE_UPLOAD, uploadProblem } from "@/lib/files";
import { formatDateTime } from "@/lib/format";
import { richTextClass } from "@/lib/richText";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import ConfirmDialog from "./ConfirmDialog";
import Dialog from "./Dialog";
import ErrorState from "./ErrorState";
import { FieldError, FieldHint } from "./FieldMessage";
import FormAlert from "./FormAlert";
import { CardsSkeleton } from "./Loading";
import RichTextEditor from "./RichTextEditor";
import { notify } from "./Toast";

/** What the upload picker offers; the API refuses anything else (and files over 20 MB). */
/**
 * A brand's product knowledge: the text, then the files the brand sent, or a note that there is
 * none yet. `fileUrl` loads one file as an object URL.
 */
export function KnowledgeText({
  text,
  files = [],
  fileUrl,
}: {
  text: string | null;
  files?: KnowledgeFile[];
  fileUrl?: (file: KnowledgeFile) => Promise<string>;
}) {
  if (!text && files.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <BookOpen className="size-4 shrink-0" aria-hidden="true" />
        Belum ada product knowledge. Tanyakan ke operator kamu.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Safe HTML: the API keeps only formatting tags */}
      {text && <div className={richTextClass} dangerouslySetInnerHTML={{ __html: text }} />}
      {files.length > 0 && fileUrl && <KnowledgeFiles files={files} fileUrl={fileUrl} />}
    </div>
  );
}

/** PDFs and images open in the browser; Office files download. */
function viewable(file: KnowledgeFile) {
  return file.mime_type === "application/pdf" || file.mime_type.startsWith("image/");
}

function FileIcon({ file }: { file: KnowledgeFile }) {
  const Icon = file.mime_type.startsWith("image/") ? FileImage : /sheet|excel/.test(file.mime_type) ? FileSpreadsheet : FileText;
  return <Icon className="size-5 shrink-0 text-brand" aria-hidden="true" />;
}

function fileSize(kb: number) {
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
}

/** The brand's files as a list: click opens (PDF, image) or downloads (Office). `onRemove` adds a delete button. */
export function KnowledgeFiles({
  files,
  fileUrl,
  onRemove,
}: {
  files: KnowledgeFile[];
  fileUrl: (file: KnowledgeFile) => Promise<string>;
  onRemove?: (file: KnowledgeFile) => void;
}) {
  async function open(file: KnowledgeFile) {
    // Open the tab during the click (popup blockers), then point it at the downloaded file
    const tab = viewable(file) ? window.open("", "_blank") : null;
    try {
      const url = await fileUrl(file);
      if (tab) showInTab(tab, url);
      else saveObjectUrl(url, file.original_name);
    } catch (caught) {
      tab?.close();
      notify({ text: errorMessage(caught), tone: "error" });
    }
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-1 pr-2">
          <button
            type="button"
            onClick={() => open(file)}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
          >
            <FileIcon file={file} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{file.original_name}</span>
              <span className="block text-xs text-muted-foreground tabular-nums">
                {fileSize(file.size_kb)} · {formatDateTime(file.created_at)}
              </span>
            </span>
            {!viewable(file) && <Download className="size-4 shrink-0 text-muted-foreground" aria-label="Unduh" />}
          </button>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemove(file)}
              aria-label={`Hapus ${file.original_name}`}
              title="Hapus"
              className="text-muted-foreground hover:text-destructive max-md:size-10"
            >
              <Trash2 />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Opens the brand's product knowledge in a side panel, e.g. from a session about to go live.
 * `compact`: an icon-only button for tight rows.
 */
export function KnowledgeButton({ brand, compact = false, className }: { brand: { id: string; name: string }; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "icon-sm" : "sm"}
        onClick={() => setOpen(true)}
        aria-label={compact ? `Product knowledge ${brand.name}` : undefined}
        title={compact ? "Product knowledge" : undefined}
        className={cn(className)}
      >
        <BookOpen aria-hidden="true" />
        {!compact && "Product knowledge"}
      </Button>
      {open && <KnowledgePanel brand={brand} onClose={() => setOpen(false)} />}
    </>
  );
}

function KnowledgePanel({ brand, onClose }: { brand: { id: string; name: string }; onClose: () => void }) {
  const { token } = useAuth();
  const knowledge = useApiData(`brand-knowledge-${brand.id}`, () => hostApi.brand(token, brand.id));

  return (
    <Dialog title={brand.name} description="Product knowledge · baca sebelum live" placement="side" size="md" onClose={onClose}>
      {knowledge.error && <ErrorState message={knowledge.error} onRetry={knowledge.reload} />}
      {!knowledge.data && !knowledge.error && <CardsSkeleton count={1} />}
      {knowledge.data && (
        <KnowledgeText
          text={knowledge.data.brand.product_knowledge}
          files={knowledge.data.brand.files}
          fileUrl={(file) => hostApi.knowledgeFileUrl(token, brand.id, file.id)}
        />
      )}
    </Dialog>
  );
}

/**
 * Edit a brand's product knowledge (admin and operators): the text, often pasted from WA, and
 * the files the brand sent (PDF, screenshots, Word/Excel/PowerPoint).
 */
export function KnowledgeEditor({ brand, onClose }: { brand: { id: string; name: string }; onClose: () => void }) {
  const { token } = useAuth();
  const knowledge = useApiData(`knowledge-${brand.id}`, () => knowledgeApi.get(token, brand.id));
  const saved = knowledge.data?.brand.product_knowledge ?? "";
  // null: not edited yet, so it shows what's saved
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [textError, setTextError] = useState<string>();
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [removing, setRemoving] = useState<KnowledgeFile | null>(null);
  const dirty = draft !== null && draft !== saved;

  async function saveText() {
    setSaving(true);
    setTextError(undefined);
    try {
      const { brand: result } = await knowledgeApi.saveText(token, brand.id, draft || null);
      if (knowledge.data) knowledge.setData({ ...knowledge.data, brand: { ...knowledge.data.brand, product_knowledge: result.product_knowledge } });
      setDraft(null);
      notify({ text: "Product knowledge disimpan" });
    } catch (caught) {
      setTextError(fieldErrors(caught).product_knowledge ?? errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  // One by one, so one refused file doesn't stop the rest
  async function upload(files: File[]) {
    if (files.length === 0) return;
    const failed: string[] = [];
    setUploadErrors([]);
    for (const [index, file] of files.entries()) {
      setUploading({ done: index, total: files.length });
      const problem = uploadProblem(file, KNOWLEDGE_UPLOAD);
      if (problem) {
        failed.push(`${file.name}: ${problem}`);
        continue;
      }
      try {
        await knowledgeApi.upload(token, brand.id, file);
      } catch (caught) {
        failed.push(`${file.name}: ${fieldErrors(caught).file ?? errorMessage(caught)}`);
      }
    }
    setUploading(null);
    setUploadErrors(failed);
    knowledge.reload();
    const added = files.length - failed.length;
    if (added > 0) notify({ text: added === 1 ? "File diunggah" : `${added} file diunggah` });
  }

  return (
    <Dialog
      title={`Product knowledge ${brand.name}`}
      description="Host melihatnya di halaman Brand dan dari sesi live mereka."
      size="lg"
      dirty={dirty}
      closeOnOutsideClick={false}
      onClose={onClose}
    >
      {knowledge.error && <ErrorState message={knowledge.error} onRetry={knowledge.reload} />}
      {!knowledge.data && !knowledge.error && <CardsSkeleton count={2} />}

      {knowledge.data && (
        <div className="space-y-6">
          <section className="space-y-1.5">
            <Label id="knowledge-text">Teks</Label>
            <RichTextEditor
              labelledBy="knowledge-text"
              defaultValue={saved}
              onChange={setDraft}
              placeholder="Tempel teks dari WA, Word atau PDF di sini: produk, harga, promo, poin penting saat live, link katalog…"
              invalid={Boolean(textError)}
            />
            {textError ? (
              <FieldError>{textError}</FieldError>
            ) : (
              <FieldHint>
                Format ikut saat di-paste (tebal, judul, daftar). Teks WA dengan *tebal* dan _miring_ otomatis diformat. Link bisa diklik host.
              </FieldHint>
            )}
            <div className="flex justify-end pt-1">
              <Button type="button" size="sm" onClick={saveText} disabled={!dirty || saving}>
                {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
                Simpan teks
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-foreground">File</h3>
                <p className="text-xs text-muted-foreground">PDF, gambar (screenshot WA), Word, Excel, PowerPoint. Maks 20 MB per file.</p>
              </div>
              <Button asChild variant="outline" size="sm" className={cn("cursor-pointer", uploading && "pointer-events-none opacity-60")}>
                <label>
                  {uploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
                  {uploading ? `Mengunggah ${uploading.done + 1}/${uploading.total}…` : "Unggah file"}
                  <input
                    type="file"
                    multiple
                    accept={acceptOf(KNOWLEDGE_UPLOAD)}
                    className="sr-only"
                    disabled={Boolean(uploading)}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void upload(files);
                    }}
                  />
                </label>
              </Button>
            </div>

            {uploadErrors.length > 0 && (
              <FormAlert tone="error">
                <ul className="space-y-0.5">
                  {uploadErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </FormAlert>
            )}

            {knowledge.data.files.length > 0 ? (
              <KnowledgeFiles files={knowledge.data.files} fileUrl={(file) => knowledgeApi.fileUrl(token, brand.id, file.id)} onRemove={setRemoving} />
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Belum ada file.</p>
            )}
          </section>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Hapus file?"
          confirmLabel="Hapus"
          onConfirm={async () => {
            try {
              await knowledgeApi.remove(token, brand.id, removing.id);
              notify({ text: "File dihapus" });
              knowledge.reload();
            } catch (caught) {
              notify({ text: errorMessage(caught), tone: "error" });
            }
          }}
          onClose={() => setRemoving(null)}
        >
          {removing.original_name} tidak bisa dilihat host lagi.
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
