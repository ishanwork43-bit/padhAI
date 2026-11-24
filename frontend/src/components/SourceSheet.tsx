import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { request, errorMessage } from '../lib/api';
import type { Preview } from '../lib/types';
import { useStudy } from '../lib/study';
import { Badge, Button, ErrorNotice, Modal, Skeleton } from './ui';
export interface SourceTarget {
  document_id: string;
  page_number?: number | null;
  start_char?: number;
  quote?: string;
}
export function SourceSheet({
  target,
  onClose,
}: {
  target: SourceTarget | null;
  onClose: () => void;
}) {
  const { workspace } = useStudy();
  const [page, setPage] = useState(0),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    setPage(Math.max(0, (target?.page_number ?? 1) - 1));
    setOffset(Math.max(0, (target?.start_char ?? 0) - 300));
  }, [target]);
  const query = useQuery({
    queryKey: ['preview', workspace.id, workspace.revision, target?.document_id, page, offset],
    enabled: !!target,
    queryFn: () =>
      request<Preview>(`/documents/${target!.document_id}?page=${page}&offset=${offset}`),
    retry: false,
  });
  const doc = query.data;
  function highlighted(text: string) {
    if (!target?.quote || !text.includes(target.quote)) return text;
    const parts = text.split(target.quote);
    return parts.map((part, index) => (
      <span key={index}>
        {part}
        {index < parts.length - 1 && <mark>{target.quote}</mark>}
      </span>
    ));
  }
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={doc?.filename ?? 'Source preview'}
      description="Read the original extracted text behind your results."
      sheet
    >
      <div className="source-toolbar">
        <Badge>
          <FileText size={13} />
          {doc?.type.toUpperCase() ?? 'NOTE'}
        </Badge>
        {doc && (
          <span className="small-muted">
            {doc.chunk_count} passages · {doc.character_count.toLocaleString()} characters
          </span>
        )}
      </div>
      <div className="source-body">
        {query.isPending ? (
          <>
            <Skeleton className="preview-line" />
            <Skeleton className="preview-line" />
            <Skeleton className="preview-block" />
          </>
        ) : query.error ? (
          <ErrorNotice message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : doc ? (
          <>
            <div className="source-page-heading">
              <h3>
                {doc.page.page_number === null ? 'Text document' : `Page ${doc.page.page_number}`}
              </h3>
              <span className="small-muted">
                {page + 1} / {doc.page_count}
              </span>
            </div>
            {doc.page.text ? (
              <div className="source-text">{highlighted(doc.page.text)}</div>
            ) : (
              <p className="small-muted">This page contains no extractable text.</p>
            )}
            {!!doc.warnings.length && (
              <div className="notice notice-neutral">
                {doc.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            {(offset > 0 || doc.page.truncated) && (
              <div className="excerpt-controls">
                <span className="small-muted">
                  Characters {offset + 1}–{offset + doc.page.text.length} of{' '}
                  {doc.page.total_characters.toLocaleString()}
                </span>
                <div>
                  <Button
                    variant="ghost"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 12000))}
                  >
                    Previous excerpt
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={offset + doc.page.text.length >= doc.page.total_characters}
                    onClick={() => setOffset(offset + 12000)}
                  >
                    Next excerpt
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
      {doc && (
        <div className="modal-footer">
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() => {
              setPage(page - 1);
              setOffset(0);
            }}
          >
            <ChevronLeft size={16} />
            Previous page
          </Button>
          <span className="small-muted">
            {page + 1} of {doc.page_count}
          </span>
          <Button
            variant="secondary"
            disabled={page + 1 >= doc.page_count}
            onClick={() => {
              setPage(page + 1);
              setOffset(0);
            }}
          >
            Next page
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </Modal>
  );
}
