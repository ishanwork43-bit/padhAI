import { ArrowUpRight, FileText, Trash2 } from 'lucide-react';
import type { Note } from '../lib/types';
import { bytes, date } from '../lib/format';
export function NoteCard({
  note,
  onPreview,
  onDelete,
  list = false,
}: {
  note: Note;
  onPreview: () => void;
  onDelete?: () => void;
  list?: boolean;
}) {
  return (
    <article className={`note-card ${list ? 'note-card-list' : ''}`}>
      <button className="note-open" onClick={onPreview} aria-label={`Preview ${note.filename}`}>
        <span className={`file-icon ${note.type}`}>
          <FileText size={23} />
        </span>
        <span className="note-card-copy">
          <span className="note-type">{note.type.toUpperCase()} DOCUMENT</span>
          <strong>{note.filename}</strong>
          <span className="note-meta">
            {note.type === 'pdf'
              ? `${note.page_count} ${note.page_count === 1 ? 'page' : 'pages'}`
              : 'Text note'}
            <span>·</span>
            {note.chunk_count} passages
          </span>
        </span>
        <ArrowUpRight size={18} className="note-open-arrow" />
      </button>
      <div className="note-card-footer">
        <span>
          {bytes(note.byte_size)}
          <span className="separator-dot">·</span>Added {date(note.created_at)}
        </span>
        {onDelete && (
          <button
            className="icon-button note-delete"
            aria-label={`Delete ${note.filename}`}
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </article>
  );
}
