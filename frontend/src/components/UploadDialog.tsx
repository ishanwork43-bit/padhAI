import { useEffect, useRef, useState } from 'react';
import { Check, FileText, LoaderCircle, Plus, UploadCloud, X, AlertCircle } from 'lucide-react';
import { Modal, Button, ErrorNotice } from './ui';
import { APIError, errorMessage, jsonRequest, uploadFile } from '../lib/api';
import { useStudy } from '../lib/study';
import { useToast } from './Toast';
import { bytes } from '../lib/format';

type Item = {
  id: number;
  file: File;
  status: 'queued' | 'uploading' | 'added' | 'duplicate' | 'error';
  message?: string;
};
export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace, invalidateNotes } = useStudy(),
    toast = useToast();
  const [items, setItems] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [drag, setDrag] = useState(false),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null),
    counter = useRef(0),
    mounted = useRef(true),
    owner = useRef(workspace.id);
  owner.current = workspace.id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function addFiles(files: File[]) {
    if (busy) return;
    setError('');
    if (files.length + items.length > 20) {
      setError('Choose up to 20 files at a time.');
      return;
    }
    setItems((old) => [
      ...old,
      ...files.map((file) => ({ id: ++counter.current, file, status: 'queued' as const })),
    ]);
  }
  function update(id: number, patch: Partial<Item>) {
    if (mounted.current)
      setItems((old) => old.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  async function submit() {
    setBusy(true);
    setError('');
    let added = 0,
      duplicates = 0;
    const workspaceId = workspace.id;
    for (const item of items.filter(
      (item) => item.status === 'queued' || item.status === 'error',
    )) {
      if (!mounted.current || owner.current !== workspaceId) break;
      if (!/\.(pdf|txt|md)$/i.test(item.file.name)) {
        update(item.id, { status: 'error', message: 'Use PDF, TXT, or Markdown files.' });
        continue;
      }
      if (item.file.size > workspace.limits.max_upload_bytes) {
        update(item.id, { status: 'error', message: 'This file exceeds the 10 MiB limit.' });
        continue;
      }
      if (!item.file.size) {
        update(item.id, { status: 'error', message: 'This file is empty.' });
        continue;
      }
      update(item.id, { status: 'uploading', message: 'Processing your document…' });
      try {
        const result = await uploadFile(item.file);
        if (result.status === 'added') added++;
        else duplicates++;
        update(item.id, {
          status: result.status,
          message: result.status === 'added' ? 'Added to your notes' : 'Already in your notes',
        });
      } catch (reason) {
        update(item.id, { status: 'error', message: errorMessage(reason) });
        if (
          reason instanceof APIError &&
          (reason.status === 401 || reason.code === 'session_changed')
        )
          break;
      }
    }
    if (mounted.current) {
      setBusy(false);
      await invalidateNotes();
      if (added)
        toast(`${added} ${added === 1 ? 'document' : 'documents'} added. Ready when you are.`);
      else if (duplicates) toast('These documents are already in your notes.');
    }
  }
  const pending = items.filter((item) => ['queued', 'error'].includes(item.status)).length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bring your notes in"
      description="A little less scattered. A lot more searchable."
    >
      <div className="modal-body">
        <input
          type="file"
          accept=".pdf,.txt,.md"
          multiple
          ref={input}
          className="sr-only"
          aria-label="Choose notes to upload"
          disabled={busy}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <button
          className={`dropzone ${drag ? 'dropzone-active' : ''}`}
          onClick={() => input.current?.click()}
          disabled={busy}
          onDragOver={(event) => {
            event.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDrag(false);
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <span className="drop-icon">
            <UploadCloud size={28} />
          </span>
          <strong>Drop your notes here, or browse</strong>
          <span>PDF, TXT, or Markdown · up to 10 MiB per file</span>
        </button>
        {error && <ErrorNotice message={error} />}
        {!!items.length && (
          <ul className="upload-list">
            {items.map((item) => (
              <li key={item.id}>
                <span className="file-icon small">
                  <FileText size={18} />
                </span>
                <div className="upload-item-copy">
                  <strong>{item.file.name}</strong>
                  <span className={item.status === 'error' ? 'text-error' : ''}>
                    {item.message ?? bytes(item.file.size)}
                  </span>
                </div>
                {item.status === 'uploading' ? (
                  <LoaderCircle size={18} className="spin" />
                ) : item.status === 'added' || item.status === 'duplicate' ? (
                  <Check size={18} className="text-green" />
                ) : item.status === 'error' ? (
                  <AlertCircle size={18} className="text-error" />
                ) : null}
                {!busy && (
                  <button
                    className="icon-button"
                    aria-label={`Remove ${item.file.name} from upload list`}
                    onClick={() => setItems((old) => old.filter((x) => x.id !== item.id))}
                  >
                    <X size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="privacy-note">
          Your extracted notes stay in this workspace until its expiry. You can delete them at any
          time. Original files are discarded after processing.
        </p>
      </div>
      <div className="modal-footer">
        <span className="small-muted">
          {workspace.stats.documents} of {workspace.limits.max_documents} notes in this workspace
        </span>
        {pending ? (
          <Button busy={busy} onClick={() => void submit()}>
            <Plus size={16} />
            {busy
              ? 'Processing notes…'
              : `Add ${pending} ${pending === 1 ? 'document' : 'documents'}`}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </Modal>
  );
}

export function SampleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { invalidateNotes } = useStudy(),
    toast = useToast();
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState('');
  async function add(sample: 'dbms' | 'cloud') {
    setBusy(sample);
    setError('');
    try {
      const result = await jsonRequest<{ status: string }>('/documents/sample', 'POST', { sample });
      await invalidateNotes();
      toast(
        result.status === 'duplicate'
          ? 'That sample is already in your notes.'
          : 'Sample added to your notes.',
      );
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start with a small example"
      description="Real study notes you can explore, search, and remove."
    >
      <div className="modal-body sample-options">
        <button disabled={!!busy} className="sample-option" onClick={() => void add('dbms')}>
          <span className="file-icon pdf">
            <FileText size={24} />
          </span>
          <div>
            <strong>Database fundamentals</strong>
            <p>A two-page PDF on normalization and transactions.</p>
          </div>
          {busy === 'dbms' ? <LoaderCircle size={20} className="spin" /> : <Plus size={20} />}
        </button>
        <button disabled={!!busy} className="sample-option" onClick={() => void add('cloud')}>
          <span className="file-icon txt">
            <FileText size={24} />
          </span>
          <div>
            <strong>Cloud computing</strong>
            <p>A text note covering IaaS, PaaS, and SaaS.</p>
          </div>
          {busy === 'cloud' ? <LoaderCircle size={20} className="spin" /> : <Plus size={20} />}
        </button>
        {error && <ErrorNotice message={error} />}
        <p className="privacy-note">
          Samples are added to your own workspace and use the same processing pipeline as uploaded
          notes.
        </p>
      </div>
    </Modal>
  );
}
