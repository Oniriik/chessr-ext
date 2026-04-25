'use client';

import { ExternalLink } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';

const BULLBOARD_URL = process.env.NEXT_PUBLIC_BULLBOARD_URL || '/bullboard/';

export default function QueuesPage() {
  return (
    <AdminShell title="Queues">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
          BullMQ : suggestion (Komodo) · analysis (Stockfish) · maia (Maia 2 native).
        </p>
        <a href={BULLBOARD_URL} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
          Open in new tab <ExternalLink size={11} />
        </a>
      </div>

      <div style={{
        flex: 1, border: '1px solid var(--border)', borderRadius: 10,
        overflow: 'hidden', minHeight: 480,
      }}>
        <iframe
          src={BULLBOARD_URL}
          style={{ width: '100%', height: '100%', border: 'none', background: '#0a0a14' }}
          title="Bull Board"
        />
      </div>
    </AdminShell>
  );
}
