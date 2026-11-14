import { Route, Routes } from 'react-router-dom';
import { StudyProvider } from './lib/study';
import { AppLayout } from './components/AppLayout';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Notes } from './pages/Notes';
import { Ask } from './pages/Ask';
import { Quiz } from './pages/Quiz';
import { Settings } from './pages/Settings';
import { Brand, ButtonLink } from './components/ui';
export function App() {
  return (
    <StudyProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="notes" element={<Notes />} />
          <Route path="ask" element={<Ask />} />
          <Route path="quiz" element={<Quiz />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route
          path="*"
          element={
            <div className="connection-screen">
              <Brand />
              <div className="connection-card">
                <p className="eyebrow">404 · A LITTLE OFF TRACK</p>
                <h1>This page isn’t in your notes.</h1>
                <p>Let’s get you back to your study space.</p>
                <ButtonLink to="/dashboard">Back to dashboard</ButtonLink>
              </div>
            </div>
          }
        />
      </Routes>
    </StudyProvider>
  );
}
