"use client";

import { Plugin } from "@tiptap/pm/state";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading1, Heading2, Italic, List, ListOrdered, Quote, Redo2, Strikethrough, Underline, Undo2, type LucideIcon } from "lucide-react";
import { richTextClass, waToHtml } from "@/lib/richText";
import { cn } from "@/lib/utils";

/**
 * Plain text pasted in (e.g. copied from WA) keeps its formatting: *bold*, _italic_, ~strike~,
 * lists and paragraphs. Pastes with their own formatting (Word, PDF, web pages) go as they are.
 */
const WhatsAppPaste = Extension.create({
  name: "whatsAppPaste",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const data = event.clipboardData;
            const text = data?.getData("text/plain");
            if (!text || data?.getData("text/html")) return false;
            return editor.commands.insertContent(waToHtml(text));
          },
        },
      }),
    ];
  },
});

/** Formatted text editor (the tags the API keeps): bold, italic, headings, lists, links. */
export default function RichTextEditor({
  labelledBy,
  defaultValue,
  onChange,
  placeholder,
  invalid,
}: {
  /** id of the label naming the field */
  labelledBy?: string;
  defaultValue: string;
  /** The HTML, or "" when empty. */
  onChange: (html: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      WhatsAppPaste,
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        ...(labelledBy && { "aria-labelledby": labelledBy }),
        "aria-multiline": "true",
        role: "textbox",
        ...(placeholder && { "aria-placeholder": placeholder }),
        class: cn(richTextClass, "min-h-56 px-3 py-2.5 outline-none"),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  });

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-input bg-card shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        invalid && "border-destructive ring-3 ring-destructive/20"
      )}
    >
      {editor && <Toolbar editor={editor} />}
      <div className="relative max-h-[55dvh] overflow-y-auto">
        <EditorContent editor={editor} />
        {editor?.isEmpty && placeholder && (
          <p className="pointer-events-none absolute top-2.5 left-3 text-sm text-muted-foreground" aria-hidden="true">
            {placeholder}
          </p>
        )}
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      quote: editor.isActive("blockquote"),
      undo: editor.can().undo(),
      redo: editor.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  const tools: { icon: LucideIcon; label: string; active?: boolean; disabled?: boolean; run: () => void }[] = [
    { icon: Heading1, label: "Judul besar", active: state.h1, run: () => chain().toggleHeading({ level: 1 }).run() },
    { icon: Heading2, label: "Subjudul", active: state.h2, run: () => chain().toggleHeading({ level: 2 }).run() },
    { icon: Bold, label: "Tebal", active: state.bold, run: () => chain().toggleBold().run() },
    { icon: Italic, label: "Miring", active: state.italic, run: () => chain().toggleItalic().run() },
    { icon: Underline, label: "Garis bawah", active: state.underline, run: () => chain().toggleUnderline().run() },
    { icon: Strikethrough, label: "Coret", active: state.strike, run: () => chain().toggleStrike().run() },
    { icon: List, label: "Daftar poin", active: state.bullet, run: () => chain().toggleBulletList().run() },
    { icon: ListOrdered, label: "Daftar nomor", active: state.ordered, run: () => chain().toggleOrderedList().run() },
    { icon: Quote, label: "Kutipan", active: state.quote, run: () => chain().toggleBlockquote().run() },
    { icon: Undo2, label: "Urungkan", disabled: !state.undo, run: () => chain().undo().run() },
    { icon: Redo2, label: "Ulangi", disabled: !state.redo, run: () => chain().redo().run() },
  ];

  return (
    <div role="toolbar" aria-label="Format teks" className="flex flex-wrap gap-0.5 border-b border-border bg-muted/40 p-1">
      {tools.map(({ icon: Icon, label, active, disabled, run }) => (
        <button
          key={label}
          type="button"
          onClick={run}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          title={label}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40 disabled:hover:bg-transparent",
            active && "bg-primary/10 text-brand hover:bg-primary/15 hover:text-brand"
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
