import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Copy,
  FileSearch,
  Library,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import { useStudy } from '../lib/study';
import { errorMessage, jsonRequest } from '../lib/api';
import type { Citation, SearchResult } from '../lib/types';
import type { LayoutActions } from '../components/AppLayout';
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
import { useToast } from '../components/Toast';
import { pageLabel } from '../lib/format';

export function CitationLinks({
  citations,
  onOpen,
}: {
  citations: Citation[];
  onOpen: (target: SourceTarget) => void;
}) {
  return (
    <div className="citation-links">
      {citations.map((citation, index) => (
        <button key={index} onClick={() => onOpen(citation)}>
          <BookOpen size={13} />
          {citation.filename} · {pageLabel(citation.page_number)}
          <ArrowUpRight size={12} />
        </button>
      ))}
    </div>
  );
}
export function Ask() {
  const { workspace, job, startJob, search, setSearch, answer, setAnswer } = useStudy(),
    { openUpload, openSamples } = useOutletContext<LayoutActions>(),
    toast = useToast();
  const [question, setQuestion] = useState(search?.question ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [source, setSource] = useState<SourceTarget | null>(null),
    [copied, setCopied] = useState(false);
  const owner = useRef(''),
    mounted = useRef(true);
  owner.current = `${workspace.id}:${workspace.revision}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ready = workspace.index.status === 'ready',
    working = !!job && ['queued', 'running'].includes(job.status);
  const aiReady =
    workspace.capabilities.ai_available &&
    workspace.settings.ai_consent &&
    workspace.capabilities.ai_requests_remaining > 0;
  async function find() {
    if (!question.trim() || busy) return;
    const version = owner.current;
    setBusy(true);
    setError('');
    setAnswer(null);
    setCopied(false);
    try {
      const result = await jsonRequest<SearchResult>('/search', 'POST', {
        question: question.trim(),
        limit: workspace.settings.result_limit,
      });
      if (mounted.current && owner.current === version) {
        setAnswer(null);
        setSearch(result);
      }
    } catch (reason) {
      if (mounted.current && owner.current === version) setError(errorMessage(reason));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        answer?.claims.length
          ? answer.claims
              .map(
                (claim) =>
                  `${claim.text}\n${claim.citations.map((c) => `${c.filename} (${pageLabel(c.page_number)}): “${c.quote}”`).join('\n')}`,
              )
              .join('\n\n')
          : (search?.passages
              .map((p) => `${p.filename} (${pageLabel(p.page_number)})\n${p.text}`)
              .join('\n\n') ?? ''),
      );
      setCopied(true);
      toast('Copied with source references.');
    } catch {
      toast('Clipboard access was unavailable. You can select and copy the text.', true);
    }
  }
  return (
    <div className="page-enter ask-page">
      <SectionHeading
        eyebrow="A LITTLE CURIOSITY GOES A LONG WAY"
        title="Big questions. Your notes have clues."
        description="Search by meaning, follow the sources, and connect the dots."
      />
      {!workspace.documents.length ? (
        <div className="surface">
          <EmptyState
            icon={<Library size={34} />}
            title="First, give your questions some context."
            description="Add your study material. PadhAI searches your own notes and shows where each passage comes from."
          >
            <Button onClick={openUpload}>
              Upload notes
              <ArrowRight size={16} />
            </Button>
            <Button variant="secondary" onClick={openSamples}>
              Explore a sample
            </Button>
          </EmptyState>
        </div>
      ) : (
        <>
          {!ready && (
            <div className="index-callout">
              <span className="callout-icon">
                <FileSearch size={25} />
              </span>
              <div>
                <h2>Make your notes searchable.</h2>
                <p>
                  Build a semantic index for your {workspace.stats.documents}{' '}
                  {workspace.stats.documents === 1 ? 'document' : 'documents'}. The first build can
                  take a little longer while the model loads.
                </p>
              </div>
              <Button
                busy={working && job?.kind === 'index'}
                disabled={working}
                onClick={() => void startJob('index').catch(() => {})}
              >
                Build search index
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          <form
            className="question-card"
            onSubmit={(event) => {
              event.preventDefault();
              void find();
            }}
          >
            <div className="question-label">
              <label htmlFor="study-question">
                <Sparkles size={17} />
                What are you curious about?
              </label>
              <Badge tone="green">Keyless semantic search</Badge>
            </div>
            <textarea
              id="study-question"
              placeholder="Ask a question, explore a concept, or find an idea in your notes…"
              maxLength={2000}
              rows={3}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  if (ready) void find();
                }
              }}
            />
            <div className="question-footer">
              <span>
                {question.length ? `${question.length} / 2,000` : 'Your words. Your sources.'}
              </span>
              <Button type="submit" busy={busy} disabled={!ready || !question.trim()}>
                <Search size={17} />
                Search notes
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
          {!search && (
            <div className="suggestions">
              <span>Need a starting point?</span>
              {[
                'What are the key concepts?',
                'How do these ideas relate?',
                'What examples are in my notes?',
              ].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    setQuestion(text);
                    document.getElementById('study-question')?.focus();
                  }}
                >
                  {text}
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          )}
          {error && <ErrorNotice message={error} />}
          {search && (
            <section className="search-results" aria-live="polite">
              <div className="section-row">
                <div>
                  <p className="eyebrow">
                    {search.passages.length ? 'EVIDENCE FROM YOUR NOTES' : 'NO MATCHING EVIDENCE'}
                  </p>
                  <h2>{search.question}</h2>
                </div>
                {!!search.passages.length && (
                  <Button variant="ghost" onClick={() => void copy()}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}Copy sources
                  </Button>
                )}
              </div>
              {!search.passages.length ? (
                <div className="surface">
                  <EmptyState
                    icon={<FileSearch size={33} />}
                    title="Your notes don’t have a strong match yet."
                    description="Try a more specific phrase, or add a document that covers this topic. PadhAI won’t invent missing evidence."
                  />
                </div>
              ) : (
                <>
                  {answer && (
                    <div className="answer-card">
                      <div className="section-row">
                        <h3>
                          <Sparkles size={18} />
                          AI-assisted answer
                        </h3>
                        <Badge tone={answer.claims.length ? 'green' : 'amber'}>
                          {answer.claims.length ? 'Source-checked' : 'Sources only'}
                        </Badge>
                      </div>
                      {answer.claims.length ? (
                        answer.claims.map((claim, index) => (
                          <div className="answer-claim" key={index}>
                            <p>{claim.text}</p>
                            <CitationLinks citations={claim.citations} onOpen={setSource} />
                          </div>
                        ))
                      ) : (
                        <p>{answer.message}</p>
                      )}
                      <p className="small-muted">
                        AI can make mistakes. Review the source quotes before relying on an answer.
                      </p>
                    </div>
                  )}
                  <div className="results-meta">
                    <span>
                      {search.passages.length} relevant{' '}
                      {search.passages.length === 1 ? 'passage' : 'passages'}
                    </span>
                    <span>Ordered by semantic relevance · original text</span>
                  </div>
                  <div className="passage-list">
                    {search.passages.map((passage, index) => (
                      <article className="passage-card" key={passage.chunk_id}>
                        <div className="passage-header">
                          <span className="source-number">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <div>
                            <strong>{passage.filename}</strong>
                            <span>{pageLabel(passage.page_number)} · Source passage</span>
                          </div>
                          <button
                            className="text-action"
                            onClick={() => setSource({ ...passage, quote: passage.text })}
                          >
                            View source
                            <ArrowUpRight size={15} />
                          </button>
                        </div>
                        <p className="passage-text">{passage.text}</p>
                      </article>
                    ))}
                  </div>
                  {!answer && (
                    <div className="ai-upgrade">
                      <Sparkles size={22} />
                      <div>
                        <h3>Bring the evidence together.</h3>
                        <p>
                          {!workspace.capabilities.ai_available
                            ? 'AI summaries are not enabled on this server. Your semantic search works without an API key.'
                            : !workspace.settings.ai_consent
                              ? 'Choose whether to share relevant excerpts with the AI provider in Settings.'
                              : !workspace.capabilities.ai_requests_remaining
                                ? 'The AI allowance has been used. You can keep searching your notes.'
                                : 'Generate a source-checked answer using these notes. This uses one AI request.'}
                        </p>
                      </div>
                      {aiReady ? (
                        <Button
                          variant="secondary"
                          disabled={working || busy}
                          busy={working && job?.kind === 'answer'}
                          onClick={() =>
                            void startJob('answer', {
                              question: search.question,
                              limit: workspace.settings.result_limit,
                            }).catch(() => {})
                          }
                        >
                          <Send size={16} />
                          Generate answer
                        </Button>
                      ) : (
                        <ButtonLink to="/settings#ai" variant="secondary">
                          AI settings
                          <ArrowRight size={15} />
                        </ButtonLink>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {!search && (
            <div className="search-principles">
              <div>
                <Search size={20} />
                <h3>Meaning over keywords</h3>
                <p>Ask naturally. Local embeddings find related ideas in your material.</p>
              </div>
              <div>
                <BookOpen size={20} />
                <h3>Always a way back</h3>
                <p>Every result opens the original text, with page references for PDFs.</p>
              </div>
            </div>
          )}
        </>
      )}
      <SourceSheet target={source} onClose={() => setSource(null)} />
    </div>
  );
}
