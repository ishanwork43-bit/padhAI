import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Sparkles, Trash2 } from 'lucide-react';
import { useStudy } from '../lib/study';
import { useAI } from '../lib/ai-access';
import { request, jsonRequest, errorMessage } from '../lib/api';
import type { StudySummary } from '../lib/types';
import {
  AIAvailability,
  ContextPreview,
  LanguageChoice,
  NoteSelection,
  useAIContext,
} from '../components/AIControls';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  ErrorNotice,
  SectionHeading,
} from '../components/ui';
import { SourceSheet } from '../components/SourceSheet';
import type { SourceTarget } from '../components/SourceSheet';
import { CitationLinks } from './Ask';
export function Summary() {
  const { workspace, job, startJob } = useStudy(),
    ai = useAI(),
    client = useQueryClient(),
    [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]),
    [language, setLanguage] = useState('English'),
    [length, setLength] = useState('short'),
    [source, setSource] = useState<SourceTarget | null>(null),
    [error, setError] = useState('');
  const selectedIds = selected.filter((id) => workspace.documents.some((n) => n.id === id));
  const context = useAIContext('summary', { document_ids: selectedIds }, !!selectedIds.length);
  const summaries = useQuery({
    queryKey: ['summaries', workspace.id, workspace.revision],
    queryFn: () => request<StudySummary[]>('/summaries'),
  });
  const current = summaries.data?.find((s) => s.id === params.get('id')) ?? summaries.data?.[0];
  const working = !!job && ['queued', 'running'].includes(job.status),
    canGenerate =
      !!ai.status?.authenticated &&
      workspace.settings.ai_consent &&
      (ai.status.quota?.remaining ?? 0) > 0 &&
      ai.cooldown === 0 &&
      !!context.data;
  async function remove(id: string) {
    try {
      await jsonRequest(`/summaries/${id}`, 'DELETE');
      setParams({});
      await client.invalidateQueries({ queryKey: ['summaries'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="page-enter summary-page">
      <SectionHeading
        eyebrow="SEE THE BIGGER PICTURE"
        title="Your notes. A clearer overview."
        description="Turn selected excerpts into an explanation you can follow back to its sources."
      />
      {!workspace.documents.length ? (
        <div className="surface">
          <EmptyState
            icon={<BookOpen size={32} />}
            title="Start with your study material."
            description="Add notes before asking Groq for a grounded summary."
          >
            <ButtonLink to="/notes">Add notes</ButtonLink>
          </EmptyState>
        </div>
      ) : (
        <div className="summary-layout">
          <section className="surface ai-builder">
            <h2>Build your overview</h2>
            <NoteSelection selected={selectedIds} onChange={setSelected} />
            <div className="ai-options">
              <LanguageChoice id="summary-language" value={language} onChange={setLanguage} />
              <div className="field">
                <label htmlFor="summary-length">Summary style</label>
                <select
                  id="summary-length"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                >
                  <option value="short">Short summary</option>
                  <option value="detailed">Detailed summary</option>
                  <option value="takeaways">Key takeaways</option>
                </select>
              </div>
            </div>
            <ContextPreview context={context.data} />
            {context.error && <ErrorNotice message={errorMessage(context.error)} />}
            <AIAvailability />
            <Button
              className="full-width"
              disabled={!canGenerate || working}
              busy={working && job?.kind === 'summary'}
              onClick={() =>
                void startJob('summary', { document_ids: selectedIds, length, language }).catch(
                  () => {},
                )
              }
            >
              <Sparkles size={17} />
              Generate summary
            </Button>
          </section>
          <section className="summary-results">
            {summaries.data?.length ? (
              <>
                <div className="field">
                  <label htmlFor="saved-summary">Saved summaries</label>
                  <select
                    id="saved-summary"
                    value={current?.id ?? ''}
                    onChange={(e) => setParams({ id: e.target.value })}
                  >
                    {summaries.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.length} · {s.coverage.filenames.join(', ')} ·{' '}
                        {new Date(s.created_at).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
                {current && (
                  <article className="answer-card">
                    <div className="section-row">
                      <h2>
                        <Sparkles size={19} />
                        AI summary
                      </h2>
                      <Badge tone="purple">{current.language}</Badge>
                    </div>
                    <p className="small-muted">
                      {current.coverage.sampled
                        ? 'Summary of sampled excerpts. Unsent sections are not covered.'
                        : 'Summary of the selected source excerpts.'}{' '}
                      Check the quoted evidence for each point.
                    </p>
                    {current.claims.map((c, i) => (
                      <div className="answer-claim" key={i}>
                        <p>{c.text}</p>
                        <CitationLinks citations={c.citations} onOpen={setSource} />
                      </div>
                    ))}
                    <Button variant="ghost" onClick={() => void remove(current.id)}>
                      <Trash2 size={15} />
                      Delete summary
                    </Button>
                  </article>
                )}
              </>
            ) : (
              <div className="surface">
                <EmptyState
                  icon={<Sparkles size={30} />}
                  title="A little perspective goes a long way."
                  description="Your generated summaries will be saved in this browser. Choose notes, review the excerpts, and generate when you are ready."
                />
              </div>
            )}
            {summaries.error && <ErrorNotice message={errorMessage(summaries.error)} />}
            {error && <ErrorNotice message={error} />}
          </section>
        </div>
      )}
      <SourceSheet target={source} onClose={() => setSource(null)} />
    </div>
  );
}
