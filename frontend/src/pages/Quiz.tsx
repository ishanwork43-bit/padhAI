import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronLeft,
  ListChecks,
  RotateCcw,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { useStudy } from '../lib/study';
import { errorMessage, jsonRequest, request } from '../lib/api';
import type { Quiz as QuizData } from '../lib/types';
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  ErrorNotice,
  Modal,
  SectionHeading,
  Skeleton,
} from '../components/ui';
import { SourceSheet } from '../components/SourceSheet';
import type { SourceTarget } from '../components/SourceSheet';
import { CitationLinks } from './Ask';
import { date } from '../lib/format';

export function Quiz() {
  const { workspace, startJob, job, refresh } = useStudy(),
    [params, setParams] = useSearchParams(),
    client = useQueryClient();
  const [count, setCount] = useState(5),
    [difficulty, setDifficulty] = useState('medium'),
    [answers, setAnswers] = useState<(number | null)[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false),
    [source, setSource] = useState<SourceTarget | null>(null);
  const id = params.get('id'),
    key = ['quiz', workspace.id, workspace.revision, id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => request<QuizData>(`/quizzes/${id}`),
    enabled: !!id,
    retry: false,
  });
  const quiz = query.data,
    working = !!job && ['queued', 'running'].includes(job.status);
  useEffect(() => {
    setAnswers(quiz?.answers ?? Array(quiz?.count ?? 0).fill(null));
    setError('');
    setConfirm(false);
  }, [quiz?.id, quiz?.attempt_number, quiz?.submitted]);
  // Draft choices stay in memory only; submitted attempts are stored by the server.
  useEffect(() => {
    if (!quiz || quiz.submitted || !answers.some((x) => x !== null)) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [answers, quiz]);
  async function submit() {
    if (!quiz) return;
    setBusy(true);
    setError('');
    try {
      const result = await jsonRequest<QuizData>(`/quizzes/${quiz.id}/submit`, 'POST', {
        attempt_number: quiz.attempt_number,
        answers,
      });
      client.setQueryData(key, result);
      setConfirm(false);
      await refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function retake() {
    if (!quiz) return;
    setBusy(true);
    setError('');
    try {
      const result = await jsonRequest<QuizData>(`/quizzes/${quiz.id}/retake`, 'POST');
      client.setQueryData(key, result);
      await refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  const canGenerate =
    workspace.capabilities.ai_available &&
    workspace.settings.ai_consent &&
    workspace.capabilities.ai_requests_remaining > 0 &&
    workspace.documents.length > 0;
  const answered = answers.filter((x) => x !== null).length;
  return (
    <div className="page-enter quiz-page">
      <SectionHeading
        eyebrow="TURN KNOWING INTO UNDERSTANDING"
        title="A little practice. A lot of clarity."
        description="Test yourself on your own notes, then learn from the evidence."
      />
      {id ? (
        <>
          <button className="text-action back-action" onClick={() => setParams({})}>
            <ChevronLeft size={15} />
            All quizzes
          </button>
          {query.isPending ? (
            <Skeleton className="loading-hero" />
          ) : query.error ? (
            <ErrorNotice message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : (
            quiz && (
              <>
                {quiz.submitted && quiz.score ? (
                  <div className="quiz-score">
                    <span className="score-icon">
                      <Trophy size={30} />
                    </span>
                    <div>
                      <p className="eyebrow">PRACTICE, REFLECT, REPEAT</p>
                      <h2>
                        {quiz.score.correct} out of {quiz.score.total} correct.
                      </h2>
                      <p>
                        {quiz.score.unanswered ? `${quiz.score.unanswered} left unanswered. ` : ''}
                        Review the explanations and source passages below.
                      </p>
                    </div>
                    <div className="score-percentage">
                      {Math.round(quiz.score.percentage)}
                      <span>%</span>
                    </div>
                  </div>
                ) : (
                  <div className="quiz-progress">
                    <div>
                      <Badge tone="purple">{quiz.difficulty}</Badge>
                      <span>
                        Attempt {quiz.attempt_number} · {answered} of {quiz.count} answered
                      </span>
                    </div>
                    <progress max={quiz.count} value={answered} aria-label="Questions answered" />
                    <p>
                      Choices stay in this page until you submit. Leaving the page clears
                      unsubmitted choices.
                    </p>
                  </div>
                )}
                <div className="quiz-questions">
                  {quiz.questions.map((question, index) => (
                    <fieldset className="quiz-question" key={index}>
                      <legend>
                        <span>QUESTION {String(index + 1).padStart(2, '0')}</span>
                        {question.question}
                      </legend>
                      <div className="quiz-options">
                        {question.options.map((option, optionIndex) => {
                          const selected = (quiz.answers ?? answers)[index] === optionIndex,
                            correct = quiz.submitted && question.correct_index === optionIndex,
                            wrong = quiz.submitted && selected && !correct;
                          return (
                            <label
                              key={optionIndex}
                              className={`quiz-option ${selected ? 'option-selected' : ''} ${correct ? 'option-correct' : ''} ${wrong ? 'option-wrong' : ''}`}
                            >
                              <input
                                type="radio"
                                name={`question-${index}`}
                                value={optionIndex}
                                checked={selected}
                                disabled={quiz.submitted || busy}
                                onChange={() =>
                                  setAnswers((old) =>
                                    old.map((value, i) => (i === index ? optionIndex : value)),
                                  )
                                }
                              />
                              <span className="option-letter">
                                {String.fromCharCode(65 + optionIndex)}
                              </span>
                              <span>{option}</span>
                              {correct && <Check size={18} />}
                            </label>
                          );
                        })}
                      </div>
                      {!quiz.submitted && answers[index] !== null && (
                        <button
                          className="text-action clear-answer"
                          disabled={busy}
                          onClick={() =>
                            setAnswers((old) => old.map((value, i) => (i === index ? null : value)))
                          }
                        >
                          Clear choice
                        </button>
                      )}
                      {quiz.submitted && (
                        <div className="quiz-explanation">
                          <h3>
                            <BookOpen size={16} />
                            Why this answer?
                          </h3>
                          <p>{question.explanation}</p>
                          <CitationLinks citations={question.citations ?? []} onOpen={setSource} />
                        </div>
                      )}
                    </fieldset>
                  ))}
                </div>
                {error && <ErrorNotice message={error} />}
                <div className="quiz-submit-bar">
                  {quiz.submitted ? (
                    <>
                      <span>
                        Attempt {quiz.attempt_number} saved · retakes use the same questions
                      </span>
                      <Button
                        variant="secondary"
                        disabled={!quiz.can_retake}
                        busy={busy}
                        onClick={() => void retake()}
                      >
                        <RotateCcw size={16} />
                        {quiz.can_retake ? 'Practice again' : 'Retake limit reached'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <span>
                        {answered} of {quiz.count} answered
                      </span>
                      <Button
                        busy={busy}
                        onClick={() => (answered < quiz.count ? setConfirm(true) : void submit())}
                      >
                        <CheckCheck size={17} />
                        Submit quiz
                      </Button>
                    </>
                  )}
                </div>
              </>
            )
          )}
        </>
      ) : (
        <>
          <div className="quiz-create-grid">
            <section className="surface quiz-builder">
              <div className="section-row">
                <span className="feature-icon purple">
                  <ListChecks size={24} />
                </span>
                <Badge tone="purple">From your notes</Badge>
              </div>
              <h2>Make room for an “aha”.</h2>
              <p>
                Generate a practice quiz with evidence-backed explanations. Answers are revealed
                after submission.
              </p>
              <div className="field">
                <label htmlFor="quiz-count">Questions</label>
                <select
                  id="quiz-count"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  <option value={5}>5 questions · a quick check-in</option>
                  <option value={10}>10 questions · a deeper dive</option>
                  <option value={20}>20 questions · a full practice</option>
                </select>
              </div>
              <fieldset className="difficulty-field">
                <legend>Difficulty</legend>
                <div className="segmented">
                  {['easy', 'medium', 'hard'].map((value) => (
                    <button
                      key={value}
                      aria-pressed={difficulty === value}
                      onClick={() => setDifficulty(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>
              <Button
                className="full-width"
                disabled={!canGenerate || working}
                busy={working && job?.kind === 'quiz'}
                onClick={() => void startJob('quiz', { count, difficulty }).catch(() => {})}
              >
                <Sparkles size={17} />
                Create my quiz
                <ArrowRight size={16} />
              </Button>
              <p className="small-muted">
                Each generation uses one AI request. Up to 10 quizzes are kept; the oldest is
                removed when the limit is reached.
              </p>
            </section>
            <aside className="quiz-aside">
              <span className="eyebrow">STUDY WITH INTENTION</span>
              <h2>
                A quiz that starts
                <br />
                where you are.
              </h2>
              <div>
                <Check size={17} />
                <p>Questions grounded in your uploaded material.</p>
              </div>
              <div>
                <Check size={17} />
                <p>Source quotes for every explanation.</p>
              </div>
              <div>
                <Check size={17} />
                <p>Retake the same quiz without another AI request.</p>
              </div>
              {!canGenerate && (
                <div className="quiz-availability">
                  <h3>
                    {!workspace.documents.length
                      ? 'Add a little context first.'
                      : !workspace.capabilities.ai_available
                        ? 'AI quizzes are currently off.'
                        : !workspace.settings.ai_consent
                          ? 'Your notes, your choice.'
                          : 'AI allowance used.'}
                  </h3>
                  <p>
                    {!workspace.documents.length
                      ? 'Upload your notes to begin.'
                      : !workspace.capabilities.ai_available
                        ? 'This server runs keyless semantic search. A server administrator can enable optional AI generation.'
                        : !workspace.settings.ai_consent
                          ? 'Enable sharing excerpts with the AI provider in Settings to create a quiz.'
                          : 'You can retake saved quizzes or keep exploring your notes with semantic search.'}
                  </p>
                  <ButtonLink
                    variant="secondary"
                    to={
                      !workspace.documents.length
                        ? '/notes'
                        : !workspace.capabilities.ai_available
                          ? '/ask'
                          : '/settings#ai'
                    }
                  >
                    {!workspace.documents.length
                      ? 'Go to My Notes'
                      : !workspace.capabilities.ai_available
                        ? 'Explore your notes'
                        : 'Open settings'}
                    <ArrowRight size={15} />
                  </ButtonLink>
                </div>
              )}
            </aside>
          </div>
          <div className="section-row saved-quiz-heading">
            <h2>Your practice collection</h2>
            <Badge>{workspace.quizzes.length} quizzes</Badge>
          </div>
          {workspace.quizzes.length ? (
            <div className="quiz-collection">
              {workspace.quizzes.map((item) => (
                <button
                  key={item.id}
                  className="saved-quiz"
                  onClick={() => setParams({ id: item.id })}
                >
                  <span className="feature-icon purple">
                    <ListChecks size={23} />
                  </span>
                  <div>
                    <strong>
                      {item.count}-question {item.difficulty} quiz
                    </strong>
                    <span>
                      {date(item.created_at)} · Attempt {item.attempt_number}
                    </span>
                  </div>
                  <Badge tone={item.submitted ? 'green' : 'neutral'}>
                    {item.score ? `${item.score.correct}/${item.score.total}` : 'Ready to practice'}
                  </Badge>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <div className="surface">
              <EmptyState
                icon={<ListChecks size={30} />}
                title="Your practice collection starts here."
                description="Generated quizzes will appear here so you can revisit them during this workspace’s lifetime."
              />
            </div>
          )}
        </>
      )}
      <SourceSheet target={source} onClose={() => setSource(null)} />
      <Modal
        open={confirm}
        busy={busy}
        onClose={() => setConfirm(false)}
        title="Submit with unanswered questions?"
        description={`${(quiz?.count ?? 0) - answered} questions are unanswered and will count as incorrect.`}
      >
        <div className="modal-body">
          <p>You can return to your choices or submit now to see the explanations.</p>
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>
            Keep practicing
          </Button>
          <Button busy={busy} onClick={() => void submit()}>
            Submit anyway
          </Button>
        </div>
      </Modal>
    </div>
  );
}
