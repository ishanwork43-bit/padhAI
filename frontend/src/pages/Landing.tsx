import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  FileText,
  Github,
  Layers3,
  ListChecks,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand, ButtonLink } from '../components/ui';
export function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#built-for-focus">Built for focus</a>
          <a
            href="https://github.com/ishanwork43-bit/padhAI"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="PadhAI on GitHub"
          >
            <Github size={20} />
          </a>
        </nav>
        <ButtonLink to="/dashboard">
          Open workspace
          <ArrowUpRight size={16} />
        </ButtonLink>
      </header>
      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <span className="landing-eyebrow">
              <span className="status-dot" /> A CALMER WAY TO LEARN
            </span>
            <h1>
              Less searching.
              <br />
              More <span className="serif-word">understanding.</span>
            </h1>
            <p>
              Your notes hold the answers. Bring them together, ask better questions, and turn “I’ve
              read this” into “I get it.”
            </p>
            <div className="hero-buttons">
              <ButtonLink to="/dashboard">
                Find your study flow
                <ArrowRight size={18} />
              </ButtonLink>
              <a className="hero-how" href="#how-it-works">
                See how it works
                <ArrowDown size={15} />
              </a>
            </div>
            <div className="hero-reassurance">
              <span>
                <Check size={15} />
                No API key to search
              </span>
              <span>
                <Check size={15} />
                Your own notes
              </span>
              <span>
                <Check size={15} />
                Sources included
              </span>
            </div>
          </div>
          <div className="landing-art" aria-label="Your study flow: notes, search, and practice">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-spark spark-one">✳</div>
            <div className="art-spark spark-two">✦</div>
            <Link to="/notes" className="art-note">
              <span className="art-note-top">
                <FileText size={24} />
                <span>01 / COLLECT</span>
              </span>
              <h3>
                Good notes.
                <br />A great starting point.
              </h3>
              <div className="art-lines">
                <i />
                <i />
                <i />
              </div>
              <span className="art-note-bottom">
                PDF · TXT · Markdown
                <ArrowUpRight size={17} />
              </span>
            </Link>
            <Link to="/ask" className="art-search">
              <span>
                <Search size={19} />
                02 / CONNECT
              </span>
              <strong>Follow your curiosity.</strong>
              <span className="art-search-bottom">
                Every idea leads back to a source.
                <ArrowUpRight size={18} />
              </span>
            </Link>
            <Link to="/quiz" className="art-quiz">
              <span className="quiz-art-icon">
                <ListChecks size={22} />
              </span>
              <div>
                <span>03 / PRACTICE</span>
                <strong>Make it stick.</strong>
              </div>
              <ArrowUpRight size={18} />
            </Link>
            <div className="art-caption">
              <span className="hand-arrow">↗</span> A little more clarity, every day.
            </div>
          </div>
        </section>
        <div className="landing-strip">
          <span>MADE FOR THE MOMENT IT CLICKS</span>
          <div>
            <BookOpen size={19} />
            Your material
          </div>
          <span className="strip-plus">+</span>
          <div>
            <Search size={19} />
            Meaningful search
          </div>
          <span className="strip-plus">+</span>
          <div>
            <Sparkles size={19} />A curious mind
          </div>
        </div>
        <section id="how-it-works" className="landing-section">
          <div className="landing-section-heading">
            <div>
              <p className="eyebrow">FROM SCATTERED TO CONNECTED</p>
              <h2>
                One space.
                <br />
                Your whole study flow.
              </h2>
            </div>
            <p>Spend less time switching tabs and more time making sense of what matters.</p>
          </div>
          <div className="landing-features">
            {[
              {
                n: '01',
                icon: Layers3,
                title: 'Bring your notes together.',
                body: 'Upload readable PDFs, text files, or Markdown. One personal library, ready for your next question.',
                to: '/notes',
                cta: 'Meet your library',
              },
              {
                n: '02',
                icon: Search,
                title: 'Ask. Explore. Connect.',
                body: 'Search by meaning, not just keywords. Read relevant passages and open the original source in place.',
                to: '/ask',
                cta: 'Follow the evidence',
              },
              {
                n: '03',
                icon: ListChecks,
                title: 'Put ideas into practice.',
                body: 'When optional AI is enabled, turn your notes into quizzes with explanations and source quotes.',
                to: '/quiz',
                cta: 'Explore Quiz Mode',
              },
            ].map(({ n, icon: Icon, title, body, to, cta }) => (
              <article key={n}>
                <div className="feature-top">
                  <Icon size={26} />
                  <span>{n}</span>
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
                <Link className="text-action" to={to}>
                  {cta}
                  <ArrowRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        </section>
        <section id="built-for-focus" className="landing-trust">
          <div>
            <span className="eyebrow">A THOUGHTFUL LITTLE STUDY COMPANION</span>
            <h2>
              Clear sources.
              <br />
              Clearer thinking.
            </h2>
            <p>
              Keyless semantic search is at the heart of PadhAI. Optional AI adds generation, with
              your choice and your sources kept in view.
            </p>
            <ButtonLink to="/dashboard" variant="secondary">
              Make space for learning
              <ArrowUpRight size={16} />
            </ButtonLink>
          </div>
          <div className="trust-points">
            <article>
              <BookOpen size={23} />
              <div>
                <h3>Evidence you can actually read</h3>
                <p>
                  Original passages, PDF page references, and a source preview alongside your work.
                </p>
              </div>
            </article>
            <article>
              <ShieldCheck size={23} />
              <div>
                <h3>A workspace with boundaries</h3>
                <p>
                  A private browser session, limited retention, and controls to delete your notes at
                  any time.
                </p>
              </div>
            </article>
            <article>
              <Sparkles size={23} />
              <div>
                <h3>Honest about what’s possible</h3>
                <p>
                  Search works without a paid key. AI generation is clearly optional, and missing
                  evidence stays missing.
                </p>
              </div>
            </article>
          </div>
        </section>
        <section className="landing-final">
          <span className="final-spark">✳</span>
          <p className="eyebrow">YOUR NEXT “AHA” STARTS HERE</p>
          <h2>
            A fresh page.
            <br />A clearer perspective.
          </h2>
          <ButtonLink to="/dashboard">
            Open your study space
            <ArrowRight size={18} />
          </ButtonLink>
          <p>Bring a note. Start with a question.</p>
        </section>
      </main>
      <footer className="landing-footer">
        <Brand />
        <span>Padhai ka smarter way.</span>
        <a
          href="https://github.com/ishanwork43-bit/padhAI"
          target="_blank"
          rel="noopener noreferrer"
        >
          Built in the open
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </div>
  );
}
