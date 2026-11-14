import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  Layers3,
  ListChecks,
  Plus,
  Sparkles,
  Upload,
  Search,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import { useStudy } from '../lib/study';
import { Badge, Button, ButtonLink, SectionHeading } from '../components/ui';
import type { LayoutActions } from '../components/AppLayout';
import { NoteCard } from '../components/NoteCard';
import { SourceSheet } from '../components/SourceSheet';
import type { SourceTarget } from '../components/SourceSheet';
import { relativeTime } from '../lib/format';

export function Dashboard() {
  const { workspace, startJob, job } = useStudy();
  const { openUpload, openSamples } = useOutletContext<LayoutActions>();
  const [preview, setPreview] = useState<SourceTarget | null>(null);
  const hasNotes = workspace.stats.documents > 0,
    ready = workspace.index.status === 'ready',
    busy = !!job && ['queued', 'running'].includes(job.status);
  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="A LITTLE FOCUS GOES A LONG WAY"
        title="Make room for understanding."
        description="Your notes, your questions, your next little breakthrough."
      />
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <Badge tone="green">
            <Sparkles size={13} />
            YOUR NEXT STUDY SESSION
          </Badge>
          <h2>
            {!hasNotes
              ? 'A fresh page.\nA clearer mind.'
              : ready
                ? 'Your notes are ready.\nWhat are you curious about?'
                : 'Good notes deserve\na great way to explore them.'}
          </h2>
          <p>
            {!hasNotes
              ? 'Bring in your lecture notes, chapter summaries, and revision sheets. We’ll help you find the connections.'
              : ready
                ? 'Ask a question in your own words. Find the relevant passage, then go deeper with the original source.'
                : 'Build a search index to connect ideas across your material. Your first index may take a little longer.'}
          </p>
          <div className="hero-actions">
            {!hasNotes ? (
              <Button onClick={openUpload}>
                <Plus size={17} />
                Add your first notes
              </Button>
            ) : ready ? (
              <ButtonLink to="/ask">
                Ask your notes
                <ArrowRight size={17} />
              </ButtonLink>
            ) : (
              <Button busy={busy} onClick={() => void startJob('index').catch(() => {})}>
                <Search size={17} />
                Make notes searchable
              </Button>
            )}
            {!hasNotes ? (
              <button className="text-action" onClick={openSamples}>
                Try sample notes
                <ArrowRight size={15} />
              </button>
            ) : (
              <Link className="text-action" to="/notes">
                See my notes
                <ArrowRight size={15} />
              </Link>
            )}
          </div>
        </div>
        <div className="dashboard-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="art-document">
            <span className="art-doc-tab" />
            <BookOpen size={45} strokeWidth={1.3} />
            <span className="art-line" />
            <span className="art-line short" />
            <span className="art-highlight" />
          </div>
          <div className="art-bubble">
            <Sparkles size={24} />
          </div>
          <span className="art-caption">one idea at a time.</span>
        </div>
      </section>
      <div className="stats-grid">
        <article className="stat-card">
          <div>
            <span>Your documents</span>
            <strong>
              {workspace.stats.documents}
              <small> / {workspace.limits.max_documents}</small>
            </strong>
            <p>
              {hasNotes
                ? 'Your knowledge, brought together.'
                : 'Your library is ready for its first note.'}
            </p>
          </div>
          <span className="stat-icon">
            <FileText size={20} />
          </span>
        </article>
        <article className="stat-card">
          <div>
            <span>Searchable passages</span>
            <strong>{workspace.index.indexed_chunks}</strong>
            <p>
              {ready
                ? 'Connected and ready to explore.'
                : workspace.stats.chunks
                  ? `${workspace.stats.chunks} passages ready to index.`
                  : 'Add notes to build your knowledge base.'}
            </p>
          </div>
          <span className="stat-icon lavender">
            <Layers3 size={20} />
          </span>
        </article>
        <article className="stat-card">
          <div>
            <span>Quizzes completed</span>
            <strong>{workspace.stats.completed_quizzes}</strong>
            <p>
              {workspace.stats.completed_quizzes
                ? 'Practice that puts ideas into place.'
                : 'A little practice goes a long way.'}
            </p>
          </div>
          <span className="stat-icon peach">
            <ListChecks size={20} />
          </span>
        </article>
      </div>
      <div className="dashboard-lower">
        <section>
          <div className="section-row">
            <div>
              <h2>Recently added</h2>
              <p>Pick up a thought where you left it.</p>
            </div>
            {hasNotes && (
              <Link to="/notes" className="text-action">
                All notes
                <ArrowRight size={15} />
              </Link>
            )}
          </div>
          {hasNotes ? (
            <div className="recent-notes">
              {workspace.documents.slice(0, 3).map((note) => (
                <NoteCard
                  note={note}
                  key={note.id}
                  onPreview={() => setPreview({ document_id: note.id })}
                />
              ))}
            </div>
          ) : (
            <button className="empty-library-card" onClick={openUpload}>
              <span className="empty-library-icon">
                <Upload size={27} />
              </span>
              <strong>A home for everything you’re learning.</strong>
              <span>Drop in a PDF, text file, or Markdown note to get started.</span>
              <span className="text-action">
                Add notes
                <ArrowRight size={15} />
              </span>
            </button>
          )}
          {!!workspace.activity.length && (
            <section className="activity-section">
              <div className="section-row">
                <h2>Your recent activity</h2>
              </div>
              <div className="activity-list">
                {workspace.activity.slice(0, 4).map((event) => (
                  <div className="activity-row" key={event.id}>
                    <span className="activity-icon">
                      {event.kind === 'upload' ? (
                        <Upload size={15} />
                      ) : event.kind === 'delete' ? (
                        <Trash2 size={15} />
                      ) : event.kind === 'index' ? (
                        <Search size={15} />
                      ) : (
                        <ListChecks size={15} />
                      )}
                    </span>
                    <span>{event.label}</span>
                    <time dateTime={event.created_at}>{relativeTime(event.created_at)}</time>
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>
        <aside className="study-flow-card">
          <div className="section-row">
            <h2>Your study flow</h2>
            <Sparkles size={17} />
          </div>
          <p className="small-muted">Small steps. Clearer thinking.</p>
          {[
            {
              title: 'Bring your notes together',
              description: hasNotes
                ? `${workspace.stats.documents} documents in your workspace`
                : 'Add material you want to understand',
              done: hasNotes,
              to: '/notes',
            },
            {
              title: 'Make the ideas searchable',
              description: ready ? 'Your search index is ready' : 'Build your index in Ask PadhAI',
              done: ready,
              to: '/ask',
            },
            {
              title: 'Put your understanding to work',
              description: workspace.capabilities.ai_available
                ? 'Create a quiz from your notes'
                : 'AI quizzes are optional',
              done: workspace.stats.completed_quizzes > 0,
              to: '/quiz',
            },
          ].map((step, index) => (
            <Link to={step.to} className="flow-step" key={step.title}>
              <span className={`flow-number ${step.done ? 'flow-done' : ''}`}>
                {step.done ? <Check size={14} /> : index + 1}
              </span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </span>
              <ArrowUpRight size={14} />
            </Link>
          ))}
          <div className="flow-footnote">
            <BookOpen size={16} />
            <p>
              The best starting point?
              <br />
              One topic you’re curious about.
            </p>
          </div>
        </aside>
      </div>
      <SourceSheet target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
