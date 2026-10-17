'use client';
import { useLoad } from '@/lib/api';
import { Badge, Button, Card, ErrorNotice, Icon } from './ui';

export function ConnectionStatus() {
  const load = useLoad<{ external_submissions_enabled: boolean; connectors: { key: string; enabled: boolean; is_demo: boolean; description: string; unavailable_reason?: string }[] }>('/integrations');
  return <Card className="stack"><div className="section-heading"><div><h3>Employer connections</h3><p className="muted">Each role shows whether it supports automatic applications or uses an employer website.</p></div><Icon name="building" size={22} /></div><ErrorNotice error={load.error} />
    {load.data?.connectors.map(connector => <div className="connection-row" key={connector.key}><div><strong>{connector.is_demo ? 'Demo employer' : connector.key === 'webhook' ? 'Employer integration' : 'Supported employer forms'}</strong><p className="muted">{connector.description}</p>{!connector.enabled && <small className="muted">{connector.unavailable_reason === 'external_submissions_disabled' ? 'Live submissions are currently disabled.' : 'This connection needs server setup.'}</small>}</div><Badge tone={connector.enabled ? 'success' : 'warning'}>{connector.is_demo ? 'Simulation' : connector.enabled ? 'Configured' : 'Needs setup'}</Badge></div>)}
    <Button variant="ghost" onClick={load.reload}><Icon name="refresh" size={16} />Refresh connection status</Button>
  </Card>;
}
