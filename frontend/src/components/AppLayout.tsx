import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  Library,
  ListChecks,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Plus,
  Settings2,
  ShieldCheck,
  Sprout,
  X,
} from 'lucide-react';
import { useStudy } from '../lib/study';
import { Brand, Button, Modal } from './ui';
import { SampleDialog, UploadDialog } from './UploadDialog';
const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/notes', label: 'My Notes', icon: Library },
  { to: '/ask', label: 'Ask PadhAI', icon: MessageSquareText },
  { to: '/quiz', label: 'Quiz Mode', icon: ListChecks },
];
export interface LayoutActions {
  openUpload: () => void;
  openSamples: () => void;
}
export function AppLayout() {
  const { workspace, job } = useStudy(),
    location = useLocation(),
    navigate = useNavigate();
  const [upload, setUpload] = useState(false),
    [samples, setSamples] = useState(false),
    [mobile, setMobile] = useState(false),
    [help, setHelp] = useState(false);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/ask');
        setTimeout(() => document.getElementById('study-question')?.focus(), 80);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [navigate]);
  const pageName = links.find((link) => link.to === location.pathname)?.label ?? 'Settings';
  const nav = (
    <>
      <div className="sidebar-brand">
        <Brand light />
      </div>
      <p className="sidebar-label">YOUR STUDY SPACE</p>
      <nav className="app-navigation" aria-label="Workspace navigation">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
          >
            <Icon size={19} />
            <span>{label}</span>
            {to === '/notes' && workspace.stats.documents > 0 && (
              <span className="nav-count">{workspace.stats.documents}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-tip">
          <Sprout size={21} />
          <p>
            A little progress.
            <br />A clearer understanding.
          </p>
          <button onClick={() => setHelp(true)}>
            Make the most of PadhAI <ArrowUpRight size={13} />
          </button>
        </div>
        <NavLink className="nav-item nav-settings" to="/settings">
          <Settings2 size={18} />
          <span>Settings</span>
        </NavLink>
        <div className="workspace-card">
          <span className="workspace-avatar">
            <BookOpen size={20} />
          </span>
          <div>
            <strong>{workspace.name}</strong>
            <span>Personal study workspace</span>
          </div>
          <Link to="/settings" aria-label="Workspace settings">
            <ChevronRight size={17} />
          </Link>
        </div>
      </div>
    </>
  );
  const jobBusy = job && ['queued', 'running'].includes(job.status);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">{nav}</aside>
      <Modal
        open={mobile}
        onClose={() => setMobile(false)}
        title="Your study space"
        description="Navigate PadhAI."
      >
        <div className="mobile-navigation">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink to={to} key={to}>
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
          <NavLink to="/settings">
            <Settings2 size={19} />
            Settings
          </NavLink>
        </div>
      </Modal>
      <div className="app-main">
        <header className="app-topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="topbar-workspace">Your workspace</span>
            <ChevronRight size={14} />
            <span className="topbar-current">{pageName}</span>
          </div>
          <div className="topbar-right">
            <span className="connection-pill">
              <span className="status-dot" />
              Semantic search
            </span>
            <button
              className="icon-button help-button"
              aria-label="How PadhAI works"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={19} />
            </button>
            <Button className="topbar-upload" onClick={() => setUpload(true)}>
              <Plus size={16} />
              Add notes
            </Button>
          </div>
        </header>
        {jobBusy && (
          <div className="job-banner" role="status">
            <LoaderCircle size={17} className="spin" />
            <span>
              {job.kind === 'index'
                ? job.phase === 'loading_model'
                  ? 'Preparing your search model…'
                  : 'Building your search index…'
                : job.kind === 'quiz'
                  ? 'Creating your practice quiz…'
                  : 'Checking the evidence for your answer…'}
            </span>
            <span className="job-hint">You can keep exploring your workspace.</span>
          </div>
        )}
        <main id="main-content" className="workspace-content">
          <Outlet
            context={
              {
                openUpload: () => setUpload(true),
                openSamples: () => setSamples(true),
              } satisfies LayoutActions
            }
          />
        </main>
        <footer className="app-footer">
          <span>
            <ShieldCheck size={13} />
            Your notes belong to this workspace.
          </span>
          <Link to="/settings#data">Storage & privacy</Link>
          <span className="footer-tagline">Padhai ka smarter way.</span>
        </footer>
      </div>
      <UploadDialog open={upload} onClose={() => setUpload(false)} />
      <SampleDialog open={samples} onClose={() => setSamples(false)} />
      <Modal
        open={help}
        onClose={() => setHelp(false)}
        title="A good study session starts here"
        description="Three small steps, all in one workspace."
      >
        <div className="modal-body help-steps">
          <div>
            <span>01</span>
            <section>
              <h3>Bring your notes</h3>
              <p>
                Add readable PDF, TXT, or Markdown documents. Try a sample if you want a quick
                start.
              </p>
            </section>
          </div>
          <div>
            <span>02</span>
            <section>
              <h3>Find the evidence</h3>
              <p>
                Build your index in Ask PadhAI, then search in your own words. Open source cards to
                read the original passage.
              </p>
            </section>
          </div>
          <div>
            <span>03</span>
            <section>
              <h3>Practice with purpose</h3>
              <p>
                When AI is enabled, create quizzes from your notes. Explanations appear after you
                submit. Retakes use the same questions.
              </p>
            </section>
          </div>
          <div className="help-shortcut">
            <kbd>⌘ / Ctrl</kbd>
            <kbd>K</kbd>
            <span>Jump to Ask PadhAI</span>
          </div>
        </div>
        <div className="modal-footer">
          <Button
            variant="secondary"
            onClick={() => {
              setHelp(false);
              setSamples(true);
            }}
          >
            Try sample notes
          </Button>
          <Button onClick={() => setHelp(false)}>Got it</Button>
        </div>
      </Modal>
    </div>
  );
}
