import { useEffect, useState } from 'react';
import {
  Check,
  Database,
  Laptop,
  Moon,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import { useStudy } from '../lib/study';
import { errorMessage, jsonRequest } from '../lib/api';
import { bytes } from '../lib/format';
import { useTheme } from '../lib/theme';
import { Badge, Button, ErrorNotice, Modal, SectionHeading } from '../components/ui';
import { useToast } from '../components/Toast';
export function Settings() {
  const { workspace, refresh, invalidateNotes, reset } = useStudy(),
    toast = useToast(),
    [theme, setTheme] = useTheme();
  const [name, setName] = useState(workspace.name),
    [limit, setLimit] = useState(workspace.settings.result_limit),
    [consent, setConsent] = useState(workspace.settings.ai_consent),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [action, setAction] = useState<'notes' | 'workspace' | null>(null),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState('');
  useEffect(() => {
    setName(workspace.name);
    setLimit(workspace.settings.result_limit);
    setConsent(workspace.settings.ai_consent);
  }, [workspace.name, workspace.settings.result_limit, workspace.settings.ai_consent]);
  const dirty =
    name !== workspace.name ||
    limit !== workspace.settings.result_limit ||
    consent !== workspace.settings.ai_consent;
  async function save() {
    setBusy(true);
    setError('');
    try {
      await jsonRequest('/workspace', 'PATCH', {
        name: name.trim(),
        result_limit: limit,
        ai_consent: consent,
      });
      await refresh();
      toast('Workspace preferences saved.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setDeleting(true);
    setDeleteError('');
    try {
      if (action === 'workspace') await reset();
      else {
        await jsonRequest('/documents', 'DELETE');
        await invalidateNotes();
      }
      setAction(null);
      toast(
        action === 'workspace'
          ? 'A fresh workspace is ready.'
          : 'All notes and study results deleted.',
      );
    } catch (reason) {
      setDeleteError(errorMessage(reason));
    } finally {
      setDeleting(false);
    }
  }
  return (
    <div className="page-enter settings-page">
      <SectionHeading
        eyebrow="MAKE YOURSELF AT HOME"
        title="Your space. Your preferences."
        description="A few thoughtful controls for the way you learn."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="settings-section">
          <div className="settings-intro">
            <h2>Workspace</h2>
            <p>Keep things familiar, from your workspace name to your search results.</p>
          </div>
          <div className="surface settings-panel">
            <div className="field">
              <label htmlFor="workspace-name">Workspace name</label>
              <input
                id="workspace-name"
                maxLength={60}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <small>Personal to this browser’s workspace.</small>
            </div>
            <div className="field">
              <label htmlFor="result-count">Passages per search</label>
              <select
                id="result-count"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {[3, 5, 8, 10].map((value) => (
                  <option value={value} key={value}>
                    {value} passages
                  </option>
                ))}
                {![3, 5, 8, 10].includes(limit) && <option value={limit}>{limit} passages</option>}
              </select>
              <small>You may see fewer results when the evidence is limited.</small>
            </div>
          </div>
        </section>
        <section id="ai" className="settings-section">
          <div className="settings-intro">
            <h2>AI & search</h2>
            <p>Semantic search is keyless. Generated answers and quizzes are optional.</p>
          </div>
          <div className="surface settings-panel">
            <div className="settings-status">
              <span className="feature-icon">
                <ShieldCheck size={21} />
              </span>
              <div>
                <strong>Local semantic search</strong>
                <p>
                  Embeddings run on the study server. No paid provider receives your search
                  requests.
                </p>
              </div>
              <Badge tone="green">Available</Badge>
            </div>
            <div className="settings-divider" />
            <div className="settings-status">
              <span className="feature-icon purple">
                <Sparkles size={21} />
              </span>
              <div>
                <strong>AI generation</strong>
                <p>
                  {workspace.capabilities.ai_available
                    ? `${workspace.capabilities.ai_model} · ${workspace.capabilities.ai_requests_remaining} requests remaining in the current allowance.`
                    : 'Not enabled on this server. Only the server administrator can configure a provider key.'}
                </p>
              </div>
              <Badge tone={workspace.capabilities.ai_available ? 'green' : 'neutral'}>
                {workspace.capabilities.ai_available ? 'Available' : 'Off'}
              </Badge>
            </div>
            <label className="consent-control">
              <input
                type="checkbox"
                checked={consent}
                disabled={!workspace.capabilities.ai_available && !consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                <strong>Allow excerpts to be sent to OpenAI for generation</strong>
                <small>
                  Only when you request an answer or quiz. Requests include relevant note text and
                  filenames. Provider processing policies apply. Failed generation also uses an
                  allowance slot.
                </small>
              </span>
            </label>
            <p className="small-muted">
              Keys stay on the backend. This interface never asks for or stores an API key.
            </p>
          </div>
        </section>
        {error && <ErrorNotice message={error} />}
        <div className="settings-save">
          <span>
            {dirty ? 'You have unsaved preferences.' : 'Your preferences are up to date.'}
          </span>
          <Button type="submit" disabled={!dirty || !name.trim()} busy={busy}>
            <Save size={16} />
            Save preferences
          </Button>
        </div>
      </form>
      <section className="settings-section">
        <div className="settings-intro">
          <h2>Appearance</h2>
          <p>Find your focus, day or night.</p>
        </div>
        <div className="surface settings-panel theme-options">
          {(
            [
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'system', label: 'System', icon: Laptop },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>
              <Icon size={22} />
              <span>{label}</span>
              {theme === value && <Check size={14} />}
            </button>
          ))}
        </div>
      </section>
      <section id="data" className="settings-section">
        <div className="settings-intro">
          <h2>Data & privacy</h2>
          <p>A temporary workspace with clear boundaries.</p>
        </div>
        <div className="surface settings-panel">
          <div className="storage-heading">
            <Database size={20} />
            <strong>
              {bytes(workspace.stats.bytes)} of {bytes(workspace.limits.max_workspace_bytes)}
            </strong>
            <span>
              {workspace.stats.documents} / {workspace.limits.max_documents} notes
            </span>
          </div>
          <progress
            className="storage-progress"
            value={workspace.stats.bytes}
            max={workspace.limits.max_workspace_bytes}
            aria-label="Workspace upload allowance used"
          />
          <p className="small-muted">
            Allowance is measured by original upload size; stored text may differ.
          </p>
          <dl className="privacy-details">
            <div>
              <dt>What is stored</dt>
              <dd>
                Extracted text, filenames, document metadata, preferences, and generated study
                results are stored on the backend. Original files are discarded after processing.
                The search index lives in server memory.
              </dd>
            </div>
            <div>
              <dt>Who can access it</dt>
              <dd>
                This browser holds a private, HttpOnly workspace cookie. There is no account or
                recovery link. Other visitors get separate workspaces. The service operator can
                access server storage.
              </dd>
            </div>
            <div>
              <dt>Automatic expiry</dt>
              <dd>
                {new Date(workspace.expires_at).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                . The expiry is fixed; continuing to study does not extend it. Expired data is
                removed on access or by the cleanup loop, normally within 30 seconds while the
                server runs.
              </dd>
            </div>
            <div>
              <dt>When you delete</dt>
              <dd>
                Text, associated study results, and the active search index are removed. In-flight
                work cannot save deleted results. Provider requests already sent cannot be recalled;
                host backups follow the operator’s retention policy. Keep your own original notes.
              </dd>
            </div>
          </dl>
          <div className="danger-actions">
            <div>
              <strong>Clear all notes</strong>
              <p>Remove documents, quizzes, answers, and activity.</p>
            </div>
            <Button
              variant="danger"
              disabled={!workspace.stats.documents}
              onClick={() => {
                setDeleteError('');
                setAction('notes');
              }}
            >
              <Trash2 size={15} />
              Clear notes
            </Button>
          </div>
          <div className="danger-actions">
            <div>
              <strong>Start a fresh workspace</strong>
              <p>Delete this entire workspace, including preferences.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteError('');
                setAction('workspace');
              }}
            >
              Reset workspace
            </Button>
          </div>
        </div>
      </section>
      <Modal
        open={!!action}
        busy={deleting}
        onClose={() => setAction(null)}
        title={action === 'notes' ? 'Delete all your notes?' : 'Delete this workspace?'}
        description="This cannot be undone. Keep copies of your original files."
      >
        <div className="modal-body">
          <p>
            {action === 'notes'
              ? 'All extracted documents, quizzes, answer results, and activity will be removed.'
              : 'All notes, study results, activity, and preferences will be deleted. A new empty workspace will open.'}
          </p>
          {deleteError && <ErrorNotice message={deleteError} />}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" disabled={deleting} onClick={() => setAction(null)}>
            Keep my workspace
          </Button>
          <Button variant="danger" busy={deleting} onClick={() => void remove()}>
            Delete {action === 'notes' ? 'all notes' : 'workspace'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
