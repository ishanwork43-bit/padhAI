import { useQuery } from '@tanstack/react-query';
import { BookOpen, ShieldCheck } from 'lucide-react';
import { useAI } from '../lib/ai-access';
import { useStudy } from '../lib/study';
import { jsonRequest } from '../lib/api';
import type { PreparedContext } from '../browser/ai-context';
import { Badge, Button, ButtonLink, ErrorNotice } from './ui';
export function AIAvailability() {
  const ai = useAI(),
    { workspace } = useStudy();
  return (
    <div className="ai-availability" role="status">
      <div className="ai-status-line">
        <Badge tone={ai.status?.authenticated ? 'green' : 'purple'}>
          <ShieldCheck size={13} />
          {ai.busy ? 'Checking AI connection…' : ai.status?.authenticated ? 'Groq AI ready' : 'Groq AI'}
        </Badge>
        {ai.status?.quota && (
          <span>{ai.status.quota.remaining} requests available today · visitor and shared limits</span>
        )}
      </div>
      {!workspace.settings.ai_consent ? (
        <p>
          Choose whether to send selected excerpts to Groq in{' '}
          <ButtonLink to="/settings#ai" variant="ghost">AI & privacy settings</ButtonLink>.
        </p>
      ) : !ai.status?.authenticated ? (
        <p>{ai.busy ? 'Preparing anonymous AI access. No account or invitation is needed.' : 'AI is temporarily unavailable. Local search and saved results still work.'}</p>
      ) : ai.cooldown > 0 ? (
        <p>
          Next generation available in {ai.cooldown}s. Retakes and local search use no AI quota.
        </p>
      ) : ai.status.quota?.remaining === 0 || ai.status.quota?.token_budget_remaining === 0 ? (
        <p>
          The daily allowance is used. It resets at{' '}
          {new Date(ai.status.quota.resets_at).toLocaleString()}. You can use saved results and
          local search.
        </p>
      ) : (
        <p>
          Generation sends only the reviewed excerpts and your request to Groq. Each request uses
          the shared allowance.
        </p>
      )}
      {ai.error && <ErrorNotice message={ai.error} />}
      {!ai.busy && (ai.error || !ai.status?.authenticated) && (
        <Button variant="secondary" onClick={() => void ai.refresh()}>Retry AI connection</Button>
      )}
    </div>
  );
}
export function LanguageChoice({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Language</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option>English</option>
        <option>Hinglish</option>
      </select>
    </div>
  );
}
export function NoteSelection({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const { workspace } = useStudy();
  return (
    <fieldset className="note-selection">
      <legend>Choose source notes</legend>
      {workspace.documents.map((note) => (
        <label key={note.id}>
          <input
            type="checkbox"
            checked={selected.includes(note.id)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...selected, note.id] : selected.filter((id) => id !== note.id),
              )
            }
          />
          <span>
            {note.filename}
            <small>
              {note.type === 'pdf' ? `${note.page_count} pages` : 'Text document'} ·{' '}
              {note.character_count.toLocaleString()} characters
            </small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
export function useAIContext(task: string, body: Record<string, unknown>, enabled: boolean) {
  const { workspace } = useStudy();
  return useQuery({
    queryKey: ['ai-context', workspace.id, workspace.revision, task, body],
    queryFn: () => jsonRequest<PreparedContext>('/ai/context', 'POST', { task, ...body }),
    enabled,
    retry: false,
    staleTime: 30000,
  });
}
export function ContextPreview({ context }: { context?: PreparedContext }) {
  if (!context) return null;
  const { coverage, sources } = context;
  return (
    <details className="source-consent-details">
      <summary>
        <BookOpen size={16} />
        Review {coverage.passages} excerpts · {coverage.characters.toLocaleString()} characters
      </summary>
      <p className="small-muted">
        {coverage.sampled
          ? `This is a sample of ${coverage.total_passages} passages, not the entire selected library. Results cover only these excerpts.`
          : 'These excerpts cover the selected readable text.'}{' '}
        PDF files and embeddings stay on your device.
      </p>
      {sources.map((source) => (
        <article key={source.chunk_id}>
          <strong>
            {source.filename} · {source.page_number ? `Page ${source.page_number}` : 'Text source'}
          </strong>
          <p>{source.text}</p>
        </article>
      ))}
    </details>
  );
}
