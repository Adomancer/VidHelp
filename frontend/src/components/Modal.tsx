"use client";

import Dialog from "./Dialog";

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
  return (
    <Dialog title={title} description={description} onClose={onClose} size={wide ? "lg" : "md"} closeOnOutsideClick={false}>
      <div className="space-y-4">{children}</div>
    </Dialog>
  );
}
