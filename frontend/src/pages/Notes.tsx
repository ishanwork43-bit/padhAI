import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Grid2X2, Library, List, Plus, Search, SearchX, Trash2, X } from 'lucide-react';
import { useStudy } from '../lib/study';
import type { Note } from '../lib/types';
import { jsonRequest, errorMessage } from '../lib/api';
import type { LayoutActions } from '../components/AppLayout';
import { Badge, Button, EmptyState, ErrorNotice, Modal, SectionHeading } from '../components/ui';
import { NoteCard } from '../components/NoteCard';
import { SourceSheet } from '../components/SourceSheet';
import type { SourceTarget } from '../components/SourceSheet';
import { useToast } from '../components/Toast';

export function Notes() {
  const { workspace, invalidateNotes } = useStudy(),
    { openUpload, openSamples } = useOutletContext<LayoutActions>(),
    toast = useToast();
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [sort, setSort] = useState('recent'),
    [list, setList] = useState(false);
  const [preview, setPreview] = useState<SourceTarget | null>(null),
    [deleting, setDeleting] = useState<Note | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const notes = workspace.documents
    .filter(
      (note) =>
        note.filename.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
        (type === 'all' || note.type === type),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.filename.localeCompare(b.filename)
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError('');
    try {
      await jsonRequest(`/documents/${deleting.id}`, 'DELETE');
      await invalidateNotes();
      setDeleting(null);
      toast('Document deleted. Your index and quizzes have been cleared.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="YOUR PERSONAL KNOWLEDGE BASE"
        title="Good ideas start with good notes."
        description="Keep your material together. Give every question a place to begin."
        action={
          <Button onClick={openUpload}>
            <Plus size={17} />
            Upload notes
          </Button>
        }
      />
      <div className="library-summary">
        <Badge tone="green">
          <Library size={13} />
          {workspace.stats.documents} {workspace.stats.documents === 1 ? 'document' : 'documents'}
        </Badge>
        <span>PDF, TXT, and Markdown · up to 10 MiB each</span>
      </div>
      {workspace.documents.length === 0 ? (
        <div className="surface">
          <EmptyState
            icon={<Library size={35} />}
            title="Your next idea belongs here."
            description="Bring your own notes, or explore a sample to see how everything connects."
          >
            <Button onClick={openUpload}>
              <Plus size={17} />
              Upload your first notes
            </Button>
            <Button variant="secondary" onClick={openSamples}>
              Try sample notes
            </Button>
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="library-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input
                aria-label="Search note filenames"
                placeholder="Find a note by name…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Clear note search"
                  onClick={() => setQuery('')}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <select
              aria-label="Filter notes by type"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="all">All formats</option>
              <option value="pdf">PDF</option>
              <option value="txt">Text</option>
              <option value="md">Markdown</option>
            </select>
            <select
              aria-label="Sort notes"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="recent">Newest first</option>
              <option value="name">Name A–Z</option>
            </select>
            <div className="view-toggle" role="group" aria-label="Note layout">
              <button aria-label="Grid view" aria-pressed={!list} onClick={() => setList(false)}>
                <Grid2X2 size={18} />
              </button>
              <button aria-label="List view" aria-pressed={list} onClick={() => setList(true)}>
                <List size={19} />
              </button>
            </div>
          </div>
          {notes.length ? (
            <div className={list ? 'notes-list' : 'notes-grid'}>
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  list={list}
                  onPreview={() => setPreview({ document_id: note.id })}
                  onDelete={() => {
                    setError('');
                    setDeleting(note);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="surface">
              <EmptyState
                icon={<SearchX size={33} />}
                title="No notes match that search."
                description="Try a different name or switch back to all formats."
              >
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setType('all');
                  }}
                >
                  Clear filters
                </Button>
              </EmptyState>
            </div>
          )}
          <div className="library-footnote">
            <span>
              {notes.length} of {workspace.documents.length} notes shown
            </span>
            <span>
              Adding notes keeps your existing quizzes. Deleting notes clears derived study results.
            </span>
          </div>
        </>
      )}
      <SourceSheet target={preview} onClose={() => setPreview(null)} />
      <Modal
        busy={busy}
        open={!!deleting}
        onClose={() => !busy && setDeleting(null)}
        title="Remove this note?"
        description="This removes its extracted text from your workspace."
      >
        <div className="modal-body">
          <div className="delete-item">
            <Trash2 size={22} />
            <strong>{deleting?.filename}</strong>
          </div>
          <p>
            Your search index and generated quizzes will also be cleared so they cannot retain
            deleted material. Your other notes stay in the library.
          </p>
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
            Keep note
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void remove()}>
            Delete note
          </Button>
        </div>
      </Modal>
    </div>
  );
}
