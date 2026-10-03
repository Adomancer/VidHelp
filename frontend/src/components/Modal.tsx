"use client";

import { useEffect, useId, useRef } from "react";

interface ModalProps {
  title: string;
  description?: string;
  /** Called by the × button and Esc. The parent unmounts the modal to close it. */
  onClose: () => void;
  /** Wider dialog for forms with many fields. */
  wide?: boolean;
  children: React.ReactNode;
}

/**
 * Dialog for add/edit forms. Open it by rendering it (`{open && <Modal …>}`).
 * Clicking the backdrop does nothing, so a half-filled form isn't lost by accident.
 */
export default function Modal({ title, description, onClose, wide = false, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-3xl" : "max-w-xl"} max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-0 text-gray-200 shadow-2xl backdrop:bg-black/70`}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900 px-5 py-4">
        <div>
          <h2 id={titleId} className="text-white font-medium">
            {title}
          </h2>
          {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1 text-gray-400 hover:bg-slate-800 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </dialog>
  );
}
