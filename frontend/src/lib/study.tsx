import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { APIError, errorMessage, jsonRequest, loadWorkspace, request, resetSession } from './api';
import type { AnswerResult, Job, SearchResult, Workspace } from './types';
import { useToast } from '../components/Toast';
import { Button, Brand, ErrorNotice, Skeleton } from '../components/ui';
import { Clock3, WifiOff } from 'lucide-react';

interface StudyContextValue {
  workspace: Workspace;
  refresh: () => Promise<void>;
  invalidateNotes: () => Promise<void>;
  job: Job | undefined;
  startJob: (kind: 'index' | 'answer' | 'quiz', payload?: unknown) => Promise<void>;
  search: SearchResult | null;
  setSearch: (value: SearchResult | null) => void;
  answer: AnswerResult | null;
  setAnswer: (value: AnswerResult | null) => void;
  reset: () => Promise<void>;
}
const StudyContext = createContext<StudyContextValue | null>(null);
export function useStudy() {
  const value = useContext(StudyContext);
  if (!value) throw new Error('Study provider missing');
  return value;
}

export function StudyProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient(),
    toast = useToast(),
    navigate = useNavigate(),
    location = useLocation();
  const [expired, setExpired] = useState(false),
    [watchedJob, setWatchedJob] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchResult | null>(null),
    [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [starting, setStarting] = useState<'index' | 'answer' | 'quiz' | null>(null);
  const inWorkspace = ['/dashboard', '/notes', '/ask', '/quiz', '/settings'].includes(
    location.pathname,
  );
  const currentPath = useRef(location.pathname);
  currentPath.current = location.pathname;
  const channel = useRef<BroadcastChannel | null>(null);
  const handled = useRef(new Set<string>());
  const previous = useRef<{ id: string; revision: number } | null>(null);
  const workspaceQuery = useQuery({
    queryKey: ['workspace'],
    queryFn: loadWorkspace,
    enabled: !expired && inWorkspace,
    retry: false,
    staleTime: 15000,
    refetchInterval: 30000,
  });
  const workspace = workspaceQuery.data;
  const jobId = watchedJob ?? workspace?.active_job?.id;
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => request<Job>(`/jobs/${jobId}`),
    enabled: !!jobId && !expired,
    retry: false,
    refetchInterval: (query) =>
      query.state.error || ['completed', 'failed'].includes(query.state.data?.status ?? '')
        ? false
        : 1200,
  });
  const job = jobQuery.data;
  const clearTransient = () => {
    setSearch(null);
    setAnswer(null);
    setWatchedJob(null);
    client.removeQueries({ queryKey: ['quiz'] });
    client.removeQueries({ queryKey: ['preview'] });
    client.removeQueries({ queryKey: ['job'] });
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['workspace'] });
  };
  useEffect(() => {
    const end = () => {
      setExpired(true);
      client.clear();
      setSearch(null);
      setAnswer(null);
      setWatchedJob(null);
    };
    window.addEventListener('padhai:session-expired', end);
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('padhai-workspace');
      channel.current.onmessage = (event) => {
        clearTransient();
        if (event.data === 'reset') {
          resetSession();
          client.removeQueries({ queryKey: ['workspace'] });
          previous.current = null;
        }
        void refresh();
      };
    }
    return () => {
      window.removeEventListener('padhai:session-expired', end);
      channel.current?.close();
    };
  }, [client]);
  useEffect(() => {
    if (
      workspace &&
      previous.current &&
      (previous.current.id !== workspace.id || previous.current.revision !== workspace.revision)
    )
      clearTransient();
    if (workspace) previous.current = { id: workspace.id, revision: workspace.revision };
  }, [workspace?.id, workspace?.revision]);
  useEffect(() => {
    if (!job || !['completed', 'failed'].includes(job.status) || handled.current.has(job.id))
      return;
    handled.current.add(job.id);
    setWatchedJob(null);
    void refresh();
    if (job.status === 'failed') {
      toast(job.error?.message ?? 'This operation could not finish.', true);
      return;
    }
    if (job.kind === 'answer' && job.result && 'claims' in job.result) {
      // A background answer must never replace a newer question's evidence.
      if (search && search.question !== job.result.question) return;
      setAnswer(job.result);
      setSearch({
        question: job.result.question,
        revision: job.revision,
        mode: job.result.passages.length ? 'passages' : 'no_evidence',
        passages: job.result.passages,
      });
      toast('Your answer is ready. Review its source quotes.');
    }
    if (job.kind === 'quiz' && job.result && 'quiz_id' in job.result) {
      toast('Your practice quiz is ready.');
      if (currentPath.current === '/quiz') navigate(`/quiz?id=${job.result.quiz_id}`);
    }
    if (job.kind === 'index') toast('Your notes are ready to search.');
  }, [job, toast, navigate]);
  useEffect(() => {
    if (jobQuery.error && jobId) {
      setWatchedJob(null);
      void refresh();
      if (!(jobQuery.error instanceof APIError && jobQuery.error.status === 404))
        toast(errorMessage(jobQuery.error), true);
    }
  }, [jobQuery.error]);

  async function startJob(kind: 'index' | 'answer' | 'quiz', payload?: unknown) {
    if (starting || (job && ['queued', 'running'].includes(job.status))) return;
    setStarting(kind);
    try {
      const created = await jsonRequest<Job>(
        kind === 'index' ? '/index' : kind === 'answer' ? '/answers' : '/quizzes',
        'POST',
        payload,
      );
      setWatchedJob(created.id);
      client.setQueryData(['job', created.id], created);
      await refresh();
    } catch (error) {
      toast(errorMessage(error), true);
      throw error;
    } finally {
      setStarting(null);
    }
  }
  async function invalidateNotes() {
    clearTransient();
    channel.current?.postMessage('notes-changed');
    await refresh();
  }
  async function reset() {
    await jsonRequest('/session', 'DELETE');
    resetSession();
    client.clear();
    clearTransient();
    previous.current = null;
    setExpired(false);
    channel.current?.postMessage('reset');
    await client.fetchQuery({ queryKey: ['workspace'], queryFn: loadWorkspace });
    navigate('/dashboard');
  }
  async function restart() {
    resetSession();
    client.clear();
    previous.current = null;
    setExpired(false);
  }
  if (!inWorkspace) return <>{children}</>;
  if (expired)
    return (
      <div className="connection-screen">
        <Brand />
        <div className="connection-card">
          <Clock3 size={34} />
          <h1>Your workspace session ended.</h1>
          <p>
            It may have expired or been deleted in another tab. Start a fresh workspace to continue.
          </p>
          <Button onClick={() => void restart()}>Start a fresh workspace</Button>
        </div>
      </div>
    );
  if (workspaceQuery.isPending)
    return (
      <div className="app-loading" aria-label="Opening your workspace">
        <div className="loading-sidebar">
          <Brand light />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
        <div className="loading-main">
          <Skeleton className="loading-heading" />
          <Skeleton className="loading-hero" />
          <div className="loading-grid">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
          <p role="status">Opening your study space…</p>
        </div>
      </div>
    );
  if (workspaceQuery.error || !workspace)
    return (
      <div className="connection-screen">
        <Brand />
        <div className="connection-card">
          <WifiOff size={34} />
          <h1>Let's reconnect your study space.</h1>
          <p>Your workspace needs a connection to the study service.</p>
          <ErrorNotice message={errorMessage(workspaceQuery.error)} />
          <Button busy={workspaceQuery.isFetching} onClick={() => void workspaceQuery.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  const busyJob: Job | undefined =
    starting && !job
      ? {
          id: 'starting',
          kind: starting,
          status: 'queued',
          phase: 'queued',
          revision: workspace.revision,
          result: null,
          error: null,
        }
      : job;
  return (
    <StudyContext.Provider
      value={{
        workspace,
        refresh,
        invalidateNotes,
        job: busyJob,
        startJob,
        search,
        setSearch,
        answer,
        setAnswer,
        reset,
      }}
    >
      {children}
    </StudyContext.Provider>
  );
}
