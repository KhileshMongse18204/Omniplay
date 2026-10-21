import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, MotionConfig } from 'motion/react';
import { App } from './App';
import './index.css';

// Motion's feature bundle (springs, drag, layout animations) loads as a separate chunk after first paint;
// the `m.*` components render as plain elements until it arrives, so it never blocks the page.
// reducedMotion="user" turns off transforms for people who ask their OS for less motion.
const motionFeatures = () => import('./motion-features').then((mod) => mod.default);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LazyMotion features={motionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </LazyMotion>
  </StrictMode>,
);
