import { describe, expect, it } from "vitest";
import { acceptOf, LETTER_UPLOAD, PHOTO_UPLOAD, uploadProblem } from "./files";

const file = (name: string, megabytes: number) => new File([new Uint8Array(Math.round(megabytes * 1024 * 1024))], name);

describe("uploadProblem", () => {
  it("accepts what the backend accepts", () => {
    expect(uploadProblem(file("surat.PDF", 4.9), LETTER_UPLOAD)).toBeNull();
    expect(uploadProblem(file("foto.jpg", 1.5), PHOTO_UPLOAD)).toBeNull();
  });

  it("refuses files that are too large before uploading", () => {
    expect(uploadProblem(file("foto.jpg", 2.5), PHOTO_UPLOAD)).toMatch(/Maksimal 2 MB/);
  });

  it("refuses iPhone HEIC photos and other types", () => {
    expect(uploadProblem(file("IMG_0001.HEIC", 1), PHOTO_UPLOAD)).toMatch(/tidak didukung/);
    expect(uploadProblem(file("surat.docx", 1), LETTER_UPLOAD)).toMatch(/JPG, PNG atau PDF/);
  });

  it("lists the extensions for the file picker", () => {
    expect(acceptOf(LETTER_UPLOAD)).toBe(".jpg,.jpeg,.png,.pdf");
  });
});
