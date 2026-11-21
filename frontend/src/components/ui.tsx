import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, BookOpen, LoaderCircle, X, AlertCircle, ArrowRight } from 'lucide-react';
import clsx from 'clsx';

export function Brand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <Link to="/" className={clsx('brand', light && 'brand-light')} aria-label="PadhAI home">
      <span className="brand-mark">
        <BookOpen size={21} />
      </span>
      {!compact && (
        <span>
          Padh<span className="brand-ai">AI</span>
          <span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}
export function Button({
  children,
  variant = 'primary',
  busy = false,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={clsx('btn', `btn-${variant}`, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <LoaderCircle size={17} className="spin" />}
      {children}
    </button>
  );
}
export function ButtonLink({
  to,
  children,
  variant = 'primary',
  className,
}: {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  return (
    <Link to={to} className={clsx('btn', `btn-${variant}`, className)}>
      {children}
    </Link>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'purple';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <AlertCircle size={18} />
      <div>
        <p>{message}</p>
        {onRetry && (
          <button className="text-action" onClick={onRetry}>
            Try again <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  sheet = false,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  sheet?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={clsx('modal-content', sheet && 'modal-sheet')}>
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ?? 'Manage your study workspace.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label="Close dialog" disabled={busy}>
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ExternalProjectLink() {
  return (
    <a
      href="https://github.com/ishanwork43-bit/padhAI"
      target="_blank"
      rel="noopener noreferrer"
      className="text-action"
    >
      View the project <ArrowUpRight size={14} />
    </a>
  );
}
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}
