import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from '../lib/theme';
import { initI18n } from '../lib/i18n';
import '../styles.css';

void initTheme();
void initI18n();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
