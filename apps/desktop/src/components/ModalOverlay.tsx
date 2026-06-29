import { type ReactNode, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  contentClassName?: string;
  backdropClassName?: string;
}

export function ModalOverlay({
  isOpen,
  onClose,
  children,
  contentClassName,
}: Props) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogOverlay />
      <DialogContent className={contentClassName}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
