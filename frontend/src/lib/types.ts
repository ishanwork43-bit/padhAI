export interface Note {
  id: string;
  filename: string;
  type: string;
  byte_size: number;
  page_count: number;
  chunk_count: number;
  character_count: number;
  warnings: string[];
  created_at: string;
}
export interface Passage {
  chunk_id: string;
  document_id: string;
  filename: string;
  page_number: number | null;
  start_char: number;
  end_char: number;
  text: string;
  similarity: number;
}
export interface Citation {
  source_id: string;
  document_id: string;
  filename: string;
  page_number: number | null;
  start_char: number;
  end_char: number;
  quote: string;
}
export interface SearchResult {
  question: string;
  revision: number;
  mode: 'passages' | 'no_evidence';
  passages: Passage[];
}
export interface AnswerResult {
  question: string;
  mode: string;
  message: string;
  passages: Passage[];
  claims: { text: string; citations: Citation[] }[];
}
export interface Score {
  correct: number;
  total: number;
  unanswered: number;
  percentage: number;
  correctness: boolean[];
}
export interface QuizSummary {
  id: string;
  count: number;
  difficulty: string;
  created_at: string;
  attempt_number: number;
  submitted: boolean;
  score: Score | null;
}
export interface Quiz extends QuizSummary {
  questions: {
    question: string;
    options: string[];
    correct_index?: number;
    explanation?: string;
    citations?: Citation[];
  }[];
  answers: (number | null)[] | null;
  can_retake: boolean;
}
export interface Job {
  id: string;
  kind: 'index' | 'answer' | 'quiz';
  status: 'queued' | 'running' | 'completed' | 'failed';
  phase: string;
  revision: number;
  result: AnswerResult | { quiz_id: string } | { indexed_chunks: number } | null;
  error: { code: string; message: string } | null;
}
export interface Workspace {
  id: string;
  name: string;
  revision: number;
  created_at: string;
  expires_at: string;
  settings: { result_limit: number; ai_consent: boolean };
  capabilities: {
    semantic_search: boolean;
    ai_available: boolean;
    ai_requests_remaining: number;
    ai_model: string | null;
  };
  limits: {
    max_upload_bytes: number;
    max_documents: number;
    max_workspace_bytes: number;
    max_characters: number;
  };
  stats: {
    documents: number;
    chunks: number;
    bytes: number;
    characters: number;
    completed_quizzes: number;
  };
  index: { status: 'empty' | 'not_indexed' | 'indexing' | 'ready'; indexed_chunks: number };
  active_job: Pick<Job, 'id' | 'kind' | 'status' | 'phase'> | null;
  documents: Note[];
  quizzes: QuizSummary[];
  activity: { id: number; kind: string; label: string; created_at: string }[];
}
export interface Preview extends Note {
  page: {
    index: number;
    page_number: number | null;
    text: string;
    offset: number;
    total_characters: number;
    truncated: boolean;
  };
}
