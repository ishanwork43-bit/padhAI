import { useEffect, useState } from 'react';
import {
  Check,
  Database,
  KeyRound,
  Laptop,
  Moon,
  Save,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import { useStudy } from '../lib/study';
import { useAI } from '../lib/ai-access';
import { errorMessage, jsonRequest } from '../lib/api';
import { bytes } from '../lib/format';
import { useTheme } from '../lib/theme';
import { Badge, Button, ErrorNotice, Modal, SectionHeading } from '../components/ui';
import { AIAvailability } from '../components/AIControls';
import { useToast } from '../components/Toast';
export function Settings() {
  const { workspace, refresh, invalidateNotes, reset } = useStudy(),
    ai = useAI(),
    toast = useToast(),
    [theme, setTheme] = useTheme();
  const [name, setName] = useState(workspace.name),
    [limit, setLimit] = useState(workspace.settings.result_limit),
    [consent, setConsent] = useState(workspace.settings.ai_consent),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [accessCode, setAccessCode] = useState(''),
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
  async function unlock() {
    try {
      await ai.unlock(accessCode.trim());
      setAccessCode('');
      toast('Private AI unlocked for this browser session.');
    } catch {
      setAccessCode('');
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
          : 'All local notes and study results deleted.',
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
        description="Control your study space, private AI access, and the data you choose to share."
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
            <p>A space that feels like yours.</p>
          </div>
          <div className="surface settings-panel">
            <div className="field">
              <label htmlFor="workspace-name">Workspace name</label>
              <input
                id="workspace-name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="result-limit">Search results</label>
              <select
                id="result-limit"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {[3, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} passages
                  </option>
                ))}
                {![3, 5, 8, 10].includes(limit) && <option value={limit}>{limit} passages</option>}
              </select>
              <small>You may see fewer results when evidence is limited.</small>
            </div>
          </div>
        </section>
        <section id="ai" className="settings-section">
          <div className="settings-intro">
            <h2>AI & privacy</h2>
            <p>Local search stays keyless. Groq generation is private and optional.</p>
          </div>
          <div className="surface settings-panel">
            <div className="settings-status">
              <span className="feature-icon">
                <ShieldCheck size={21} />
              </span>
              <div>
                <strong>Local semantic search</strong>
                <p>PDF processing, embeddings, search, and source previews run in your browser.</p>
              </div>
              <Badge tone="green">On this device</Badge>
            </div>
            <div className="settings-status">
              <span className="feature-icon purple">
                <KeyRound size={21} />
              </span>
              <div>
                <strong>Groq explanations, summaries & quizzes</strong>
                <p>
                  Private access protects a limited free allowance. Your provider API key is never
                  entered into this website.
                </p>
              </div>
            </div>
            <label className="consent-control">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                <strong>Allow selected excerpts to be sent to Groq</strong>
                <small>
                  Only when I press a generation button. The reviewed text, source labels, and my
                  question pass through PadhAI’s Netlify Function. Groq receives the source text and
                  request; PDFs and search vectors stay local. Groq applies its own privacy and
                  retention policies.
                </small>
              </span>
            </label>
            <p className="small-muted">
              Save this choice below. Turning sharing off prevents new generations and discards
              pending results. It cannot recall a request already sent to Groq.
            </p>
          </div>
        </section>
        <div className="settings-save">
          {error && <ErrorNotice message={error} />}
          <Button type="submit" busy={busy} disabled={!dirty || !name.trim()}>
            <Save size={16} />
            Save preferences
          </Button>
        </div>
      </form>
      <section className="settings-section">
        <div className="settings-intro">
          <h2>Private AI access</h2>
          <p>This is a project invitation, separate from your Groq API key.</p>
        </div>
        <div className="surface settings-panel">
          {!ai.status?.authenticated ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void unlock();
              }}
            >
              <div className="field">
                <label htmlFor="private-access-code">Private access code</label>
                <input
                  id="private-access-code"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={128}
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  placeholder="Enter the invitation from the project owner"
                />
              </div>
              <Button type="submit" disabled={!accessCode.trim()} busy={ai.busy}>
                <KeyRound size={16} />
                Unlock private AI
              </Button>
            </form>
          ) : (
            <>
              <p>
                <Check size={16} />
                Your private session expires {new Date(ai.status.expires_at!).toLocaleString()}.
              </p>
              <Button
                variant="secondary"
                busy={ai.busy}
                onClick={() => void ai.lock().catch(() => {})}
              >
                Lock private AI
              </Button>
            </>
          )}
          <AIAvailability />
          <p className="small-muted">
            Up to 20 shared requests per UTC day, a conservative token budget, and a one-minute
            cooldown. Large requests or Groq’s own limits may reduce availability. No automatic
            retries or unlimited AI.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-intro">
          <h2>Appearance</h2>
          <p>Choose what helps you focus.</p>
        </div>
        <div className="surface settings-panel">
          <div className="theme-options">
            {[
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'system', label: 'System', icon: Laptop },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={theme === value ? 'selected' : ''}
                aria-pressed={theme === value}
                onClick={() => setTheme(value as typeof theme)}
              >
                <Icon size={20} />
                <span>{label}</span>
                {theme === value && <Check size={15} />}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section id="data" className="settings-section">
        <div className="settings-intro">
          <h2>Your data</h2>
          <p>Stored in this browser profile. Keep your originals.</p>
        </div>
        <div className="surface settings-panel">
          <div className="settings-status">
            <span className="feature-icon">
              <Database size={21} />
            </span>
            <div>
              <strong>
                {workspace.stats.documents} notes · {bytes(workspace.stats.bytes)}
              </strong>
              <p>
                {bytes(workspace.limits.max_workspace_bytes)} original-file allowance ·{' '}
                {workspace.limits.max_documents} notes
              </p>
            </div>
          </div>
          <progress
            value={workspace.stats.bytes}
            max={workspace.limits.max_workspace_bytes}
            aria-label="Workspace upload allowance used"
          />
          <dl className="privacy-details">
            <div>
              <dt>Stored locally</dt>
              <dd>
                Extracted pages, filenames, preferences, vectors, summaries, quizzes, scores, and
                activity use IndexedDB. Original file bytes are discarded after extraction. Anyone
                using this browser profile can access its notes and quiz answer keys; this is a
                practice tool, not a secure exam system.
              </dd>
            </div>
            <div>
              <dt>Optional AI processing</dt>
              <dd>
                Only reviewed excerpts leave this device after consent and an explicit generation
                request. PadhAI does not persist or log study content on its Function. Netlify
                stores hashed session identifiers, expiry, counters, and request IDs for abuse
                prevention; platform and provider policies still apply.
              </dd>
            </div>
            <div>
              <dt>Persistence & recovery</dt>
              <dd>
                Refresh keeps saved notes and results. Browser eviction, clearing site data, private
                browsing, or another device/origin can lose access. There is no account backup or
                cloud sync.
              </dd>
            </div>
            <div>
              <dt>Deletion</dt>
              <dd>
                Deleting a note removes its text and clears the index, summaries, and quizzes,
                including scores. Clearing notes removes all study material and activity. Reset also
                removes workspace preferences and sharing consent. In-flight results cannot restore
                deleted notes. Previously sent provider requests cannot be recalled.
              </dd>
            </div>
          </dl>
          <div className="danger-actions">
            <div>
              <strong>Clear all notes</strong>
              <p>Remove documents, vectors, summaries, quizzes, and activity.</p>
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
              <p>Also remove preferences and passage-sharing consent.</p>
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
              ? 'All locally saved notes, search vectors, summaries, quizzes, scores, and activity will be removed.'
              : 'All local study material, preferences, and sharing consent will be removed. A new empty workspace will open.'}
          </p>
          {deleteError && <ErrorNotice message={deleteError} />}
        </div>
        <div className="modal-footer">
          <Button variant="secondary" disabled={deleting} onClick={() => setAction(null)}>
            Keep my workspace
          </Button>
          <Button variant="danger" busy={deleting} onClick={() => void remove()}>
            {action === 'notes' ? 'Delete all notes' : 'Reset workspace'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
