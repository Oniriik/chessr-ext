import { createRoot } from 'react-dom/client';
import { BillingApp } from './BillingApp';
import '../i18n/i18n';
import './billing.css';

const root = createRoot(document.getElementById('root')!);
root.render(<BillingApp />);
