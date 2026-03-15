import { createRoot } from 'react-dom/client';
import { StreamerApp } from './StreamerApp';
import '../i18n/i18n';
import './streamer.css';

const root = createRoot(document.getElementById('root')!);
root.render(<StreamerApp />);
