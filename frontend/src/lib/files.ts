/**
 * What the backend accepts per upload, checked before sending so a wrong or too large file is
 * refused at once instead of after a long upload on a phone connection.
 */
export interface UploadRule {
  maxMb: number;
  extensions: string[];
  /** For the message, e.g. "JPG, PNG atau PDF". */
  label: string;
}

/** Profile photo: `image|max:2048`. HEIC (iPhone) isn't an image to Laravel. */
export const PHOTO_UPLOAD: UploadRule = { maxMb: 2, extensions: ["jpg", "jpeg", "png", "webp", "gif"], label: "JPG, PNG atau WebP" };

/** Doctor's letter / attachment for a backup: `mimes:jpg,jpeg,png,pdf|max:5120`. */
export const LETTER_UPLOAD: UploadRule = { maxMb: 5, extensions: ["jpg", "jpeg", "png", "pdf"], label: "JPG, PNG atau PDF" };

/** Product knowledge file: BrandKnowledgeController::MIMES, `max:20480`. */
export const KNOWLEDGE_UPLOAD: UploadRule = {
  maxMb: 20,
  extensions: ["pdf", "jpg", "jpeg", "png", "webp", "doc", "docx", "xls", "xlsx", "ppt", "pptx"],
  label: "PDF, gambar, Word, Excel atau PowerPoint",
};

/** For `<input type="file" accept>`. */
export function acceptOf(rule: UploadRule): string {
  return rule.extensions.map((extension) => `.${extension}`).join(",");
}

/** Why the backend would refuse `file`, or null if it's fine. */
export function uploadProblem(file: File, rule: UploadRule): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!rule.extensions.includes(extension)) return `Jenis file ini tidak didukung. Pakai ${rule.label}.`;
  if (file.size > rule.maxMb * 1024 * 1024) return `File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)} MB). Maksimal ${rule.maxMb} MB.`;
  return null;
}
